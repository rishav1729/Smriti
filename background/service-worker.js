// background/service-worker.js
// Orchestrator. Wrap-up = inject extractor into open tabs -> save pages
// -> chunk + embed each new/changed page -> save chunks -> cluster new pages
// -> name groups (local label, optional Groq).
// Progress and the final result are written to chrome.storage.local so the
// popup can show them even if it was closed and reopened mid-run.
//
// s5: also serves SEARCH (embed the query, rank pages) and DELETE_PAGE.
// The offscreen document is shared by wrap-up and search, so it is
// reference-counted: it is only closed when nobody is using it.
// s6: also serves CLEAR_ALL ("Delete all my data" in the popup).
import * as embeddings from '../lib/embeddings.js';
import * as storage from '../lib/storage.js';
import * as clustering from '../lib/clustering.js';
import * as summarizer from '../lib/summarizer.js';
import * as search from '../lib/search.js';

const MIN_CONTENT_CHARS = 300;
const STATUS_KEY = 'wrapUpStatus';
const SEARCH_IDLE_MS = 20 * 1000; // keep the model warm briefly for follow-up searches
let running = false;

// s7: low-value page rules.
// Skipped before reading (URL only): YouTube home, feed and search results.
function isLowValueUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtube.com') {
      const p = u.pathname;
      return p === '/' || p.startsWith('/feed/') || p === '/results';
    }
  } catch { /* bad URL: not low-value */ }
  return false;
}

// Search result pages are saved, but kept only if they group with a real page.
function isSearchUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (/^google\.[a-z.]+$/.test(host) || host === 'bing.com') return u.pathname === '/search';
    if (host === 'duckduckgo.com') return u.searchParams.has('q');
  } catch { /* ignore */ }
  return false;
}

// After grouping: delete search pages whose group contains no non-search page.
async function dropLoneSearchPages() {
  const searchIds = new Set(
    (await storage.getAllPages()).filter((p) => isSearchUrl(p.url)).map((p) => p.id)
  );
  if (!searchIds.size) return 0;
  let dropped = 0;
  for (const n of await storage.getAllNodes()) {
    if (n.pageIds.some((id) => !searchIds.has(id))) continue; // has a real page: keep
    for (const id of n.pageIds) {
      await clustering.removePage(id);
      dropped++;
    }
  }
  return dropped;
}

// ---------- shared offscreen document (wrap-up + search) ----------

let offscreenUsers = 0;
let idleTimer = null;

// If this worker was killed while an offscreen doc was open, that doc is
// orphaned. Close it once on startup; every handler waits for this first.
const startup = embeddings.closeOffscreen();

function acquireOffscreen() {
  offscreenUsers++;
  clearTimeout(idleTimer);
}

async function releaseOffscreen(delayMs) {
  offscreenUsers = Math.max(0, offscreenUsers - 1);
  if (offscreenUsers > 0) return; // someone else (wrap-up or another search) still needs it
  clearTimeout(idleTimer);
  if (delayMs <= 0) {
    await embeddings.closeOffscreen();
    return;
  }
  idleTimer = setTimeout(() => {
    if (offscreenUsers === 0) embeddings.closeOffscreen();
  }, delayMs);
}

const setStatus = (s) =>
  chrome.storage.local.set({ [STATUS_KEY]: { ...s, updatedAt: Date.now() } });

// Never let one stuck step wedge the `running` flag: every step that talks to
// a tab or runs a long job has a time limit and fails with a readable error.
const withTimeout = (promise, ms, label) => {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
};

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
  const [res] = await withTimeout(
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/readability.js', 'content/extractor.js'], // order matters
    }),
    30 * 1000,
    'Reading the tab'
  );
  return res?.result ?? null;
}

async function wrapUpSession() {
  await startup;
  const tabs = await chrome.tabs.query({});
  const startedAt = Date.now();
  const summary = {
    saved: 0, embedded: 0, unchanged: 0, thin: 0, asleep: 0, skipped: 0,
    failed: [],
    clustered: null,
    clusterError: null,
    named: null,
    nameError: null,
    droppedSearch: 0,    
  };

  acquireOffscreen();
  try {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      await setStatus({ state: 'running', stage: 'reading', done: i, total: tabs.length, startedAt });

      if (!tab.url || !/^https?:/.test(tab.url) || tab.incognito || isLowValueUrl(tab.url)) {
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
    // Closes the model's memory now, unless a search is still using it.
    await releaseOffscreen(0);
  }

  // 3. Cluster pages that are not in any group yet.
  try {
    await setStatus({ state: 'running', stage: 'grouping', done: tabs.length, total: tabs.length, startedAt });
    summary.clustered = await withTimeout(clustering.clusterNewPages(), 60 * 1000, 'Grouping');
    summary.droppedSearch = await withTimeout(dropLoneSearchPages(), 30 * 1000, 'Cleaning search pages');
  } catch (err) {
    summary.clusterError = String(err?.message || err);
  }

  // 4. Name groups: local label always, Groq only if the user turned it on.
  // Own try/catch: a naming failure must not lose the wrap-up result.
  try {
    await setStatus({ state: 'running', stage: 'naming', done: tabs.length, total: tabs.length, startedAt });
    summary.named = await withTimeout(summarizer.summarizeNodes(), 180 * 1000, 'Naming');
  } catch (err) {
    summary.nameError = String(err?.message || err);
  }

  return summary;
}

const errText = (err) => String(err?.message || err);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'WRAP_UP') {
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
        const error = errText(err);
        await setStatus({ state: 'error', error });
        try { sendResponse({ ok: false, error }); } catch { /* popup already closed */ }
      })
      .finally(() => { running = false; });
    return true; // keep the channel open for the async response
  }

  if (msg?.type === 'SUMMARIZE') {
    // "Name groups now": re-run naming without re-reading tabs.
    if (running) {
      sendResponse({ ok: false, error: 'A wrap-up is already running.' });
      return;
    }
    running = true;
    summarizer.summarizeNodes()
      .then((result) => { try { sendResponse({ ok: true, result }); } catch { /* popup closed */ } })
      .catch((err) => {
        try { sendResponse({ ok: false, error: errText(err) }); } catch { /* popup closed */ }
      })
      .finally(() => { running = false; });
    return true;
  }

  // s5: semantic search. Allowed while a wrap-up runs (the offscreen doc is
  // shared and reference-counted), so a search never gets its model closed
  // from under it.
  if (msg?.type === 'SEARCH') {
    (async () => {
      await startup;
      acquireOffscreen();
      try {
        const results = await search.searchPages(msg.query);
        try { sendResponse({ ok: true, results }); } catch { /* page closed */ }
      } catch (err) {
        try { sendResponse({ ok: false, error: errText(err) }); } catch { /* page closed */ }
      } finally {
        await releaseOffscreen(SEARCH_IDLE_MS);
      }
    })();
    return true;
  }

  // s5: delete a page everywhere (page, chunks, node membership, centroid).
  // Shares the `running` guard so it never interleaves with wrap-up writes.
  if (msg?.type === 'DELETE_PAGE') {
    if (running) {
      sendResponse({ ok: false, error: 'A wrap-up is running. Try again when it finishes.' });
      return;
    }
    if (!Number.isInteger(msg.pageId)) {
      sendResponse({ ok: false, error: 'Invalid page id.' });
      return;
    }
    running = true;
    clustering.removePage(msg.pageId)
      .then((result) => { try { sendResponse({ ok: true, result }); } catch { /* page closed */ } })
      .catch((err) => {
        try { sendResponse({ ok: false, error: errText(err) }); } catch { /* page closed */ }
      })
      .finally(() => { running = false; });
    return true;
  }

  // s6: "Delete all my data". Wipes pages, chunks, nodes and edges plus the
  // wrap-up status. Settings (Groq toggle and key) are kept. Same `running`
  // guard as DELETE_PAGE, so it never interleaves with a wrap-up.
  if (msg?.type === 'CLEAR_ALL') {
    if (running) {
      sendResponse({ ok: false, error: 'A wrap-up is running. Try again when it finishes.' });
      return;
    }
    running = true;
    (async () => {
      await storage.clearAll();
      await chrome.storage.local.remove(STATUS_KEY);
    })()
      .then(() => { try { sendResponse({ ok: true }); } catch { /* popup closed */ } })
      .catch((err) => {
        try { sendResponse({ ok: false, error: errText(err) }); } catch { /* popup closed */ }
      })
      .finally(() => { running = false; });
    return true;
  }
});