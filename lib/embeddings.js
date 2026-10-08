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

/** texts[] -> Float32Array[] (384-dim, L2-normalized) */
export async function embedTexts(texts) {
  if (!texts.length) return [];
  await ensureOffscreen();
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const res = await send({ type: 'EMBED', texts: texts.slice(i, i + BATCH_SIZE) });
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