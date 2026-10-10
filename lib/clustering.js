// lib/clustering.js
// Groups saved pages into "nodes" by topic similarity.
// Each page = one vector (average of its chunk vectors).
// Each node = a group of pages + a centroid (the average vector of its pages).
//
// Two steps:
//   1. assign: each page joins its best node if score >= THRESHOLD, else starts a new node
//   2. merge:  groups whose averages score >= MERGE_THRESHOLD are combined

import {
  getAllPages, getChunksByPage, getAllNodes, saveNode, deleteNode,
} from './storage.js';

export const THRESHOLD = 0.50;       // page joins a node if its score is at least this
export const MERGE_THRESHOLD = 0.52; // two nodes merge if their averages score at least this

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function normalize(v) {
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

function centroidOf(vectors) {
  const sum = new Float32Array(vectors[0].length);
  for (const v of vectors) for (let i = 0; i < sum.length; i++) sum[i] += v[i];
  return normalize(sum);
}

async function pageVector(pageId) {
  const chunks = await getChunksByPage(pageId);
  if (!chunks.length) return null;
  return centroidOf(chunks.map(c => c.embedding));
}

function makeVecGetter() {
  const cache = new Map();
  return async (id) => {
    if (!cache.has(id)) cache.set(id, await pageVector(id));
    return cache.get(id);
  };
}

// Step 1: put each page into its best node, or start a new one.
async function assign(pages, nodes, threshold, vec) {
  for (const page of pages) {
    const v = await vec(page.id);
    if (!v) continue; // page has no chunks yet

    let best = null, bestScore = -1;
    for (const n of nodes) {
      const s = dot(v, n.centroidEmbedding);
      if (s > bestScore) { best = n; bestScore = s; }
    }

    if (best && bestScore >= threshold) {
      best.pageIds.push(page.id);
      const members = (await Promise.all(best.pageIds.map(vec))).filter(Boolean);
      best.centroidEmbedding = centroidOf(members);
      best.dirty = true;
    } else {
      nodes.push({ label: '', summary: '', pageIds: [page.id], centroidEmbedding: v, dirty: true });
    }
  }
}

// Step 2: merge the most similar pair of nodes, again and again, until no pair
// is similar enough. Returns the saved nodes that disappeared.
async function mergeNodes(nodes, mergeThreshold, vec) {
  const removed = [];
  while (nodes.length > 1) {
    let bi = -1, bj = -1, bestScore = -1;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const s = dot(nodes[i].centroidEmbedding, nodes[j].centroidEmbedding);
        if (s > bestScore) { bestScore = s; bi = i; bj = j; }
      }
    }
    if (bestScore < mergeThreshold) break;

    let keep = nodes[bi], drop = nodes[bj];
    if (keep.id == null && drop.id != null) [keep, drop] = [drop, keep]; // keep the saved one

    keep.pageIds = [...keep.pageIds, ...drop.pageIds];
    const members = (await Promise.all(keep.pageIds.map(vec))).filter(Boolean);
    keep.centroidEmbedding = centroidOf(members);
    keep.dirty = true;

    nodes.splice(nodes.indexOf(drop), 1);
    if (drop.id != null) removed.push(drop);
  }
  return removed;
}

async function saveDirty(nodes) {
  for (const n of nodes) {
    if (!n.dirty) continue;
    const { dirty, ...node } = n;
    await saveNode(node);
  }
}

// Add only pages that are not in any node yet. Used after each wrap-up.
export async function clusterNewPages(threshold = THRESHOLD, mergeThreshold = MERGE_THRESHOLD) {
  const nodes = await getAllNodes();
  const assigned = new Set(nodes.flatMap(n => n.pageIds));
  const fresh = (await getAllPages())
    .filter(p => p.chunkIds?.length && !assigned.has(p.id))
    .sort((a, b) => a.visitedAt - b.visitedAt);
  const vec = makeVecGetter();
  await assign(fresh, nodes, threshold, vec);
  const removed = await mergeNodes(nodes, mergeThreshold, vec);
  await saveDirty(nodes);
  for (const n of removed) await deleteNode(n.id);
  return { newPages: fresh.length, nodes: nodes.length, merged: removed.length };
}

// Throw away all nodes and rebuild from scratch. Use after changing a threshold.
export async function reclusterAll(threshold = THRESHOLD, mergeThreshold = MERGE_THRESHOLD) {
  for (const n of await getAllNodes()) await deleteNode(n.id);
  const pages = (await getAllPages())
    .filter(p => p.chunkIds?.length)
    .sort((a, b) => a.visitedAt - b.visitedAt);
  const nodes = [];
  const vec = makeVecGetter();
  await assign(pages, nodes, threshold, vec);
  const before = nodes.length;
  await mergeNodes(nodes, mergeThreshold, vec);
  await saveDirty(nodes);
  return { pages: pages.length, groupsBeforeMerge: before, nodes: nodes.length };
}

// Print the groups so you can check them by eye.
export async function showClusters() {
  const pages = new Map((await getAllPages()).map(p => [p.id, p]));
  const nodes = (await getAllNodes()).sort((a, b) => b.pageIds.length - a.pageIds.length);
  const multi = nodes.filter(n => n.pageIds.length > 1);
  const single = nodes.filter(n => n.pageIds.length === 1);
  multi.forEach((n, i) => {
    console.log(`GROUP ${i + 1} (${n.pageIds.length} pages)`);
    console.table(n.pageIds.map(id => ({
      title: (pages.get(id)?.title || pages.get(id)?.url || '?').slice(0, 60),
    })));
  });
  console.log(`Alone (${single.length}):`,
    single.map(n => (pages.get(n.pageIds[0])?.title || '?').slice(0, 40)));
}

// Tuning helper: shows the most similar pairs of saved groups.
// Run reclusterAll(0.50, 1) first (1 means nothing merges).
export async function showMergeCandidates(top = 15) {
  const pages = new Map((await getAllPages()).map(p => [p.id, p]));
  const nodes = await getAllNodes();
  const name = n => {
    const p = pages.get(n.pageIds[0]);
    const t = (p?.title && p.title !== '""' ? p.title : p?.url || '?').slice(0, 28);
    return n.pageIds.length > 1 ? `${t} (+${n.pageIds.length - 1})` : t;
  };
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    pairs.push({
      a: name(nodes[i]), b: name(nodes[j]),
      score: +dot(nodes[i].centroidEmbedding, nodes[j].centroidEmbedding).toFixed(3),
    });
  }
  pairs.sort((x, y) => y.score - x.score);
  console.table(pairs.slice(0, top));
}