// background/service-worker.js
// Orchestrator. Wrap-up = inject extractor into open tabs -> save pages
// -> chunk + embed each new/changed page -> save chunks.
// (Clustering / summarizing get wired in here in later steps.)
import * as embeddings from '../lib/embeddings.js';
import * as storage from '../lib/storage.js';

// DEV ONLY: dynamic import() is not allowed in service workers, so expose the
// modules on globalThis to test them from the service worker's DevTools
// console. Remove before publishing.
globalThis.embeddings = embeddings;
globalThis.storage = storage;

const MIN_CONTENT_CHARS = 300; // thin pages (login walls, app shells) aren't worth saving

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
  const summary = { saved: 0, embedded: 0, unchanged: 0, thin: 0, asleep: 0, skipped: 0, failed: [] };

  try {
    for (const tab of tabs) {
      // Only http(s); never touch incognito tabs (privacy).
      if (!tab.url || !/^https?:/.test(tab.url) || tab.incognito) {
        summary.skipped++;
        continue;
      }
            // Discarded (Memory Saver) or still-loading tabs have no live page to read.
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
          // keep existing chunk links in case savePage replaces the whole record
          ...(existing?.chunkIds && { chunkIds: existing.chunkIds }),
        });
        content = r.content;
        summary.saved++;
      } catch (err) {
        // e.g. Chrome Web Store, PDF viewer, or a tab we have no access to
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
        const chunks = await embeddings.embedPage(content);
        await storage.saveChunks(pageId, chunks);
        summary.embedded++;
      } catch (err) {
        // Page stays saved without chunks; the next wrap-up retries it.
        summary.failed.push({ url: tab.url, error: `embedding: ${String(err?.message || err)}` });
      }
    }
  } finally {
    // Free the model's memory; it reloads (a few seconds) on the next wrap-up.
    await embeddings.closeOffscreen();
  }
  return summary;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'WRAP_UP') {
    wrapUpSession()
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true; // keep the channel open for the async response
  }
});