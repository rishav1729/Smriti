// background/service-worker.js
// Orchestrator. v0: wrap-up = inject extractor into open tabs -> save pages.
// (Embedding / clustering / summarizing get wired in here in later steps.)

import * as storage from '../lib/storage.js';

// DEV ONLY: dynamic import() is not allowed in service workers, so expose the
// storage module on globalThis to test it from the service worker's DevTools
// console. Remove before publishing.
globalThis.storage = storage;

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
  const summary = { saved: 0, skipped: 0, failed: [] };

  for (const tab of tabs) {
    // Only http(s); never touch incognito tabs (privacy).
    if (!tab.url || !/^https?:/.test(tab.url) || tab.incognito) {
      summary.skipped++;
      continue;
    }
    try {
      const r = await extractTab(tab);
      if (!r || !r.content) {
        summary.skipped++;
        continue;
      }
      await storage.savePage({
        url: normalizeUrl(r.url),
        title: r.title || tab.title || r.url,
        content: r.content,
        visitedAt: r.extractedAt,
        siteName: r.siteName,
        method: r.method,
        truncated: r.truncated,
      });
      summary.saved++;
    } catch (err) {
      // e.g. Chrome Web Store, PDF viewer, or a tab we have no access to
      summary.failed.push({
        url: tab.url,
        error: `${String(err?.message || err)} [discarded=${tab.discarded}, status=${tab.status}]`,
      });
    }
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