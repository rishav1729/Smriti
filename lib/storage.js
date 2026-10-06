// lib/storage.js
// IndexedDB wrapper. ALL database reads/writes go through this file.
// Vectors (chunk.embedding, node.centroidEmbedding) are stored as Float32Array.

const DB_NAME = 'smriti';
const DB_VERSION = 1;

let dbPromise = null;

// ---------- internals ----------

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      const pages = db.createObjectStore('pages', { keyPath: 'id', autoIncrement: true });
      pages.createIndex('url', 'url', { unique: true });
      pages.createIndex('visitedAt', 'visitedAt');

      const chunks = db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
      chunks.createIndex('pageId', 'pageId');

      const nodes = db.createObjectStore('nodes', { keyPath: 'id', autoIncrement: true });
      nodes.createIndex('lastUpdatedAt', 'lastUpdatedAt');

      const edges = db.createObjectStore('edges', { keyPath: ['sourceNodeId', 'targetNodeId'] });
      edges.createIndex('sourceNodeId', 'sourceNodeId');
      edges.createIndex('targetNodeId', 'targetNodeId');
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

// Wrap an IDBRequest in a promise.
const p = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// Resolve when a transaction commits (so writes are durable before we return).
const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });

async function tx(stores, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(stores, mode);
}

// Coerce any numeric array-like to Float32Array (no-op if already one).
function toF32(v) {
  if (v == null) return v;
  return v instanceof Float32Array ? v : Float32Array.from(v);
}

// ---------- pages ----------

/** Insert or update a page, keyed by URL. Returns the page id. */
export async function savePage(page) {
  const t = await tx(['pages'], 'readwrite');
  const store = t.objectStore('pages');
  const existing = await p(store.index('url').get(page.url));

  const record = {
    ...existing,
    ...page,
    id: existing?.id, // keep id stable on re-visit
    visitedAt: page.visitedAt ?? Date.now(),
    chunkIds: page.chunkIds ?? existing?.chunkIds ?? [],
  };
  if (record.id === undefined) delete record.id; // let autoIncrement assign

  const id = await p(store.put(record));
  await done(t);
  return id;
}

export async function getPage(id) {
  const t = await tx(['pages']);
  return p(t.objectStore('pages').get(id));
}

export async function getPageByUrl(url) {
  const t = await tx(['pages']);
  return p(t.objectStore('pages').index('url').get(url));
}

export async function getAllPages() {
  const t = await tx(['pages']);
  return p(t.objectStore('pages').getAll());
}

/** Delete a page and all its chunks. Does NOT touch nodes (caller's job). */
export async function deletePage(id) {
  const t = await tx(['pages', 'chunks'], 'readwrite');
  const chunkStore = t.objectStore('chunks');
  const keys = await p(chunkStore.index('pageId').getAllKeys(id));
  keys.forEach((k) => chunkStore.delete(k));
  t.objectStore('pages').delete(id);
  await done(t);
}

// ---------- chunks ----------

/**
 * Replace all chunks for a page. chunks = [{ text, embedding }].
 * Updates page.chunkIds in the same transaction. Returns the new chunk ids.
 */
export async function saveChunks(pageId, chunks) {
  const t = await tx(['chunks', 'pages'], 'readwrite');
  const chunkStore = t.objectStore('chunks');
  const pageStore = t.objectStore('pages');

  const oldKeys = await p(chunkStore.index('pageId').getAllKeys(pageId));
  oldKeys.forEach((k) => chunkStore.delete(k));

  const ids = [];
  for (const c of chunks) {
    const id = await p(
      chunkStore.add({ pageId, text: c.text, embedding: toF32(c.embedding) })
    );
    ids.push(id);
  }

  const page = await p(pageStore.get(pageId));
  if (!page) {
    t.abort();
    throw new Error(`saveChunks: page ${pageId} not found`);
  }
  page.chunkIds = ids;
  pageStore.put(page);

  await done(t);
  return ids;
}

export async function getChunksByPage(pageId) {
  const t = await tx(['chunks']);
  return p(t.objectStore('chunks').index('pageId').getAll(pageId));
}

/** All chunks (with embeddings). Used for search; fine at personal scale. */
export async function getAllChunks() {
  const t = await tx(['chunks']);
  return p(t.objectStore('chunks').getAll());
}

// ---------- nodes (graph concepts / clusters) ----------

/** Insert or update a node. Returns the node id. */
export async function saveNode(node) {
  const now = Date.now();
  const record = {
    ...node,
    centroidEmbedding: toF32(node.centroidEmbedding),
    pageIds: node.pageIds ?? [],
    createdAt: node.createdAt ?? now,
    lastUpdatedAt: now,
  };
  if (record.id === undefined) delete record.id;

  const t = await tx(['nodes'], 'readwrite');
  const id = await p(t.objectStore('nodes').put(record));
  await done(t);
  return id;
}

export async function getNode(id) {
  const t = await tx(['nodes']);
  return p(t.objectStore('nodes').get(id));
}

export async function getAllNodes() {
  const t = await tx(['nodes']);
  return p(t.objectStore('nodes').getAll());
}

/** Delete a node and any edges touching it. */
export async function deleteNode(id) {
  const t = await tx(['nodes', 'edges'], 'readwrite');
  const edgeStore = t.objectStore('edges');
  const [out, inc] = await Promise.all([
    p(edgeStore.index('sourceNodeId').getAllKeys(id)),
    p(edgeStore.index('targetNodeId').getAllKeys(id)),
  ]);
  [...out, ...inc].forEach((k) => edgeStore.delete(k));
  t.objectStore('nodes').delete(id);
  await done(t);
}

// ---------- edges (optional node-to-node relations) ----------

export async function saveEdge({ sourceNodeId, targetNodeId, weight }) {
  const t = await tx(['edges'], 'readwrite');
  t.objectStore('edges').put({ sourceNodeId, targetNodeId, weight });
  await done(t);
}

/** All edges where the node is source or target. */
export async function getEdgesForNode(nodeId) {
  const t = await tx(['edges']);
  const store = t.objectStore('edges');
  const [out, inc] = await Promise.all([
    p(store.index('sourceNodeId').getAll(nodeId)),
    p(store.index('targetNodeId').getAll(nodeId)),
  ]);
  return [...out, ...inc];
}

// ---------- maintenance ----------

/** Wipe everything. Handy while developing. */
export async function clearAll() {
  const names = ['pages', 'chunks', 'nodes', 'edges'];
  const t = await tx(names, 'readwrite');
  names.forEach((n) => t.objectStore(n).clear());
  await done(t);
}