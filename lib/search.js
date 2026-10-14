// lib/search.js
// Semantic search over saved pages (runs in the service worker).
// Ranking: PAGE vector (normalized mean of the page's chunk vectors, same as
// clustering). The best-matching CHUNK is used only as the display snippet, so
// one generic chunk can never pull an unrelated page up the ranking.

import { getAllPages, getAllChunks, getAllNodes } from './storage.js';
import { embedTexts } from './embeddings.js';

export const MIN_SCORE = 0.25;   // below this a page is not shown (tune on real queries)
export const MAX_RESULTS = 25;
const SNIPPET_CHARS = 240;

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/**
 * query -> [{ pageId, score, snippet, nodeId, nodeLabel, url, title, siteName }]
 * sorted by score, best first. Embeds the query via the offscreen document.
 */
export async function searchPages(query, { limit = MAX_RESULTS, minScore = MIN_SCORE } = {}) {
  const q = String(query || '').trim().slice(0, 500);
  if (!q) return [];

  const [qv] = await embedTexts([q]);
  const [chunks, pages, nodes] = await Promise.all([getAllChunks(), getAllPages(), getAllNodes()]);

  // One pass over chunks: sum the vectors per page, remember the best chunk.
  const byPage = new Map();
  for (const c of chunks) {
    let e = byPage.get(c.pageId);
    if (!e) {
      e = { sum: new Float32Array(c.embedding.length), best: -Infinity, bestText: '' };
      byPage.set(c.pageId, e);
    }
    for (let i = 0; i < e.sum.length; i++) e.sum[i] += c.embedding[i];
    const s = dot(qv, c.embedding);
    if (s > e.best) { e.best = s; e.bestText = c.text; }
  }

  const pageMap = new Map(pages.map((p) => [p.id, p]));
  const nodeOf = new Map();
  for (const n of nodes) for (const id of n.pageIds) nodeOf.set(id, n);

  const results = [];
  for (const [pageId, e] of byPage) {
    const page = pageMap.get(pageId);
    if (!page) continue; // orphan chunks
    let norm = 0;
    for (const x of e.sum) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    const score = dot(qv, e.sum) / norm; // = cosine with the normalized page vector
    if (score < minScore) continue;
    const node = nodeOf.get(pageId);
    results.push({
      pageId,
      score,
      snippet: e.bestText.slice(0, SNIPPET_CHARS),
      nodeId: node?.id ?? null,
      nodeLabel: node?.label || '',
      url: page.url,
      title: page.title || '',
      siteName: page.siteName || '',
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}