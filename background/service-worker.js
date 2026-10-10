// background/service-worker.js
// Orchestrator. Wrap-up = inject extractor into open tabs -> save pages
// -> chunk + embed each new/changed page -> save chunks -> cluster new pages.
// Progress and the final result are written to chrome.storage.local so the
// popup can show them even if it was closed and reopened mid-run.
import * as embeddings from '../lib/embeddings.js';
import * as storage from '../lib/storage.js';
import * as clustering from '../lib/clustering.js';

// DEV ONLY: remove before publishing.
globalThis.embeddings = embeddings;
globalThis.storage = storage;
globalThis.clustering = clustering;

const MIN_CONTENT_CHARS = 300;
const STATUS_KEY = 'wrapUpStatus';
let running = false;

const setStatus = (s) =>
  chrome.storage.local.set({ [STATUS_KEY]: { ...s, updatedAt: Date.now() } });

const normalizeUrl = (url) => {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
};

async function extractTab(tab) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['lib/readability.js', 'content/extractor.js'], // order matters
  });
  return res?.result ?? null;
}

async function wrapUpSession() {
  const tabs = await chrome.tabs.query({});
  const startedAt = Date.now();
  const summary = {
    saved: 0, embedded: 0, unchanged: 0, thin: 0, asleep: 0, skipped: 0,
    failed: [],
    clustered: null,
    clusterError: null,
  };

  try {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      await setStatus({ state: 'running', stage: 'reading', done: i, total: tabs.length, startedAt });

      if (!tab.url || !/^https?:/.test(tab.url) || tab.incognito) {
        summary.skipped++;
        continue;
      }
      if (tab.discarded || tab.status !== 'complete') {
        summary.asleep++;
        summary.failed.push({
          url: tab.url,
          error: tab.discarded
            ? 'Tab is asleep. Click it to wake it, then run wrap-up again.'
            : 'Tab is still loading. Run wrap-up again once it finishes.',
        });
        continue;
      }

      // 1. Extract + save the page
      let pageId, content, existing;
      try {
        const r = await extractTab(tab);
        if (!r || !r.content) {
          summary.skipped++;
          continue;
        }
        if (r.content.length < MIN_CONTENT_CHARS) {
          summary.thin++;
          continue;
        }
        const url = normalizeUrl(r.url);
        existing = await storage.getPageByUrl(url);
        pageId = await storage.savePage({
          url,
          title: r.title || tab.title || r.url,
          content: r.content,
          visitedAt: r.extractedAt,
          siteName: r.siteName,
          method: r.method,
          truncated: r.truncated,
          ...(existing?.chunkIds && { chunkIds: existing.chunkIds }),
        });
        content = r.content;
        summary.saved++;
      } catch (err) {
        summary.failed.push({
          url: tab.url,
          error: `${String(err?.message || err)} [discarded=${tab.discarded}, status=${tab.status}]`,
        });
        continue;
      }

      // 2. Embed, unless this exact content is already embedded
      if (existing && existing.content === content && existing.chunkIds?.length > 0) {
        summary.unchanged++;
        continue;
      }
      try {
        await setStatus({ state: 'running', stage: 'embedding', done: i, total: tabs.length, startedAt });
        const chunks = await embeddings.embedPage(content);
        await storage.saveChunks(pageId, chunks);
        summary.embedded++;
      } catch (err) {
        summary.failed.push({ url: tab.url, error: `embedding: ${String(err?.message || err)}` });
      }
    }
  } finally {
    await embeddings.closeOffscreen();
  }

  // 3. Cluster pages that are not in any group yet.
  try {
    await setStatus({ state: 'running', stage: 'grouping', done: tabs.length, total: tabs.length, startedAt });
    summary.clustered = await clustering.clusterNewPages();
  } catch (err) {
    summary.clusterError = String(err?.message || err);
  }

  return summary;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'WRAP_UP') return;

  if (running) {
    sendResponse({ ok: false, error: 'A wrap-up is already running.' });
    return;
  }
  running = true;
  wrapUpSession()
    .then(async (summary) => {
      await setStatus({ state: 'done', summary, finishedAt: Date.now() });
      try { sendResponse({ ok: true, summary }); } catch { /* popup already closed */ }
    })
    .catch(async (err) => {
      const error = String(err?.message || err);
      await setStatus({ state: 'error', error });
      try { sendResponse({ ok: false, error }); } catch { /* popup already closed */ }
    })
    .finally(() => { running = false; });
  return true; // keep the channel open for the async response
});