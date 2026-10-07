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
    const MAX_CHARS = 200_000; // hard cap per page so one huge page can't bloat the DB
  
    const clean = (s) =>
      (s || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
  
    let article = null;
    let method = 'fallback';
  
    // Preferred: Readability. It mutates the DOM it is given, so always clone.
    if (typeof Readability === 'function') {
      try {
        article = new Readability(document.cloneNode(true)).parse();
        if (article && article.textContent && article.textContent.trim().length > 200) {
          method = 'readability';
        } else {
          article = null;
        }
      } catch (_) {
        article = null;
      }
    }
  
    // Fallback: visible body text (apps, dashboards, short pages).
    const text = clean(method === 'readability' ? article.textContent : document.body?.innerText);
  
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
      extractedAt: Date.now(),
    };
  })();