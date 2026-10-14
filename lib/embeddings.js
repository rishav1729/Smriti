const OFFSCREEN_URL = 'offscreen/offscreen.html';
const BATCH_SIZE = 16;
let creating = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url],
  });
  if (existing.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['WORKERS'],
        justification: 'Run the local embedding model (WASM) longer than a service worker lives.',
      })
      .finally(() => { creating = null; });
  }
  await creating;
}

async function send(msg, retries = 10) {
  for (let i = 0; ; i++) {
    try {
      return await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
    } catch (e) {
      // offscreen script may not have registered its listener yet
      if (i >= retries) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

export async function closeOffscreen() {
  try { await chrome.offscreen.closeDocument(); } catch { /* none open */ }
}

// s5: wrap-up and search can both embed. The model session runs one request at
// a time, so every batch goes through this queue (a search can slip in between
// two wrap-up batches, but never overlaps one).
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {}); // a failed batch must not block the next one
  return run;
}

// A hung model must not hang the caller forever (the service worker's
// `running` flag would stay stuck). First batch includes model start-up.
const SEND_TIMEOUT_MS = 120 * 1000;
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/** texts[] -> Float32Array[] (384-dim, L2-normalized) */
export async function embedTexts(texts) {
  if (!texts.length) return [];
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await exclusive(async () => {
      await ensureOffscreen();
      try {
        return await withTimeout(send({ type: 'EMBED', texts: batch }), SEND_TIMEOUT_MS, 'Embedding');
      } catch (e) {
        await closeOffscreen(); // dead or hung model: the next call starts a fresh one
        throw e;
      }
    });
    if (!res?.ok) throw new Error(res?.error || 'Embedding failed');
    for (const v of res.vectors) out.push(new Float32Array(v));
  }
  return out;
}

/** Vectors are normalized, so cosine similarity is just the dot product. */
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Paragraph-aware chunks of ~targetWords with overlapWords carried between chunks. */
export function chunkText(text, { targetWords = 200, overlapWords = 30, maxChunks = 60 } = {}) {
  const step = targetWords - overlapWords;
  const units = [];
  for (const p of text.split(/\n+/)) {
    const words = p.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i += step) units.push(words.slice(i, i + step));
  }

  const chunks = [];
  let cur = [];
  let fresh = 0; // words added since the last chunk was cut
  for (const u of units) {
    if (fresh > 0 && cur.length + u.length > targetWords) {
      chunks.push(cur.join(' '));
      cur = cur.slice(-overlapWords);
      fresh = 0;
    }
    cur.push(...u);
    fresh += u.length;
  }
  if (fresh > 0) chunks.push(cur.join(' '));
  return chunks.slice(0, maxChunks);
}

/** Convenience: page text -> [{text, embedding}] ready for storage.saveChunks */
export async function embedPage(content, opts) {
  const texts = chunkText(content, opts);
  const vectors = await embedTexts(texts);
  return texts.map((text, i) => ({ text, embedding: vectors[i] }));
}