// content/extractor.js
// Injected ON DEMAND (never auto-run) by the service worker, always AFTER
// lib/readability.js, in a single call:
//
//   chrome.scripting.executeScript({
//     target: { tabId },
//     files: ['lib/readability.js', 'content/extractor.js'],
//   });
//
// This is a classic script, not an ES module. It registers no listeners and
// does no messaging. The value of the final expression below is what
// executeScript returns in results[0].result (must be structured-cloneable).

(() => {
  const MAX_CHARS = 200_000;       // hard cap per page so one huge page can't bloat the DB
  const MIN_READABILITY_CHARS = 200; // Readability result shorter than this is ignored
  const MIN_READABILITY_RATIO = 0.3; // Readability text must be >= 30% of visible body text,
                                     // otherwise it probably grabbed a partial subtree
                                     // (app-style pages such as chat UIs)

  const clean = (s) =>
    (s || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  // Visible body text, computed once: used as the fallback AND as the
  // yardstick for judging whether Readability captured enough of the page.
  const bodyText = clean(document.body?.innerText);

  let article = null;
  let readabilityText = '';
  let method = 'fallback';

  // Preferred: Readability. It mutates the DOM it is given, so always clone.
  if (typeof Readability === 'function') {
    try {
      article = new Readability(document.cloneNode(true)).parse();
      readabilityText = clean(article?.textContent);

      const longEnough = readabilityText.length >= MIN_READABILITY_CHARS;
      // If the body is empty/tiny, the ratio is meaningless: trust Readability.
      const coversEnough =
        bodyText.length === 0 ||
        readabilityText.length / bodyText.length >= MIN_READABILITY_RATIO;

      if (article && longEnough && coversEnough) {
        method = 'readability';
      } else {
        article = null;
      }
    } catch (_) {
      article = null;
    }
  }

  const text = method === 'readability' ? readabilityText : bodyText;

  return {
    url: location.href,
    title: clean(article?.title || document.title),
    content: text.slice(0, MAX_CHARS),
    truncated: text.length > MAX_CHARS,
    excerpt: clean(article?.excerpt || ''),
    byline: clean(article?.byline || ''),
    siteName: article?.siteName || location.hostname,
    lang: document.documentElement.lang || '',
    method, // 'readability' | 'fallback'
    // Diagnostics for tuning the ratio (harmless extra fields):
    readabilityChars: readabilityText.length,
    bodyChars: bodyText.length,
    extractedAt: Date.now(),
  };
})();