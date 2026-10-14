// graph-view/graph.js
// List/search view (v1). Runs as an extension page, so it reads IndexedDB
// directly for browsing and instant keyword matching. Anything that needs the
// embedding model (semantic search) or writes (delete) goes through the
// service worker, which owns the offscreen document and the `running` guard.
//
// Titles, labels, URLs and snippets come from web pages or a model:
// everything is rendered with textContent, never innerHTML.
import { getAllPages, getAllNodes } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const qEl = $('q');
const statusEl = $('status');
const resultsEl = $('results');
const groupsEl = $('groups');

const KEYWORD_BOOST = 0.1; // added to the semantic score when the title/URL also matches

let pages = new Map();   // id -> light page object (no full text)
let nodes = [];
let nodeOf = new Map();  // pageId -> node
let items = [];          // what the results area shows: [{ pageId, score, sem?, keyword?, snippet? }]
let searchSeq = 0;       // bumps on every new query so stale replies are ignored

// ---------- helpers ----------

const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

const setStatus = (t) => { statusEl.textContent = t; };

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const titleOf = (p) => (p.title && p.title !== '""' ? p.title : '') || hostOf(p.url) || p.url;

function safeHref(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}

const summaryText = () =>
  `${pages.size} saved page${pages.size === 1 ? '' : 's'} in ${nodes.length} group${nodes.length === 1 ? '' : 's'}.`;

// ---------- data ----------

async function load() {
  const [ps, ns] = await Promise.all([getAllPages(), getAllNodes()]);
  pages = new Map(ps.map((p) => [p.id, {
    id: p.id, url: p.url, title: p.title, siteName: p.siteName, visitedAt: p.visitedAt,
  }]));
  nodes = ns;
  nodeOf = new Map();
  for (const n of nodes) for (const id of n.pageIds) nodeOf.set(id, n);
}

// Instant fallback: every word must appear in the title, URL or site name.
function keywordMatches(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const p of pages.values()) {
    const hay = `${p.title || ''} ${p.url} ${p.siteName || ''}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) {
      out.push({ pageId: p.id, score: KEYWORD_BOOST, keyword: true });
    }
  }
  return out;
}

// ---------- rendering ----------

function pageRow(p, { snippet, sem, keyword } = {}) {
  const li = el('li', null, 'page');

  const head = el('div', null, 'page-head');
  const title = titleOf(p);
  const href = safeHref(p.url);
  if (href) {
    const a = el('a', title);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    head.append(a);
  } else {
    head.append(el('span', title));
  }
  const del = el('button', 'Delete', 'del');
  del.type = 'button';
  del.title = 'Remove this page from Smriti';
  del.addEventListener('click', () => deletePage(p.id));
  head.append(del);
  li.append(head);

  const host = hostOf(p.url);
  const meta = [host];
  if (p.siteName && p.siteName.toLowerCase() !== host.toLowerCase()) meta.push(p.siteName);
  if (sem != null) meta.push(`${Math.round(sem * 100)}% match`);
  if (keyword) meta.push('title/URL match');
  li.append(el('div', meta.filter(Boolean).join(' · '), 'meta'));

  if (snippet) li.append(el('p', `${snippet}...`, 'snippet'));
  return li;
}

function renderGroups() {
  groupsEl.replaceChildren();
  const multi = nodes
    .filter((n) => n.pageIds.length > 1)
    .sort((a, b) => b.pageIds.length - a.pageIds.length || (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0));

  const byRecent = (a, b) => (b.visitedAt || 0) - (a.visitedAt || 0);

  for (const n of multi) {
    const members = n.pageIds.map((id) => pages.get(id)).filter(Boolean).sort(byRecent);
    if (!members.length) continue;
    const d = el('details', null, 'group');
    if (n.summary) d.title = n.summary;
    const s = el('summary', n.label || titleOf(members[0]));
    s.append(el('small', ` ${members.length} pages${n.labelSource === 'cloud' ? ', Groq' : ''}`));
    const ul = el('ul');
    for (const p of members) ul.append(pageRow(p));
    d.append(s, ul);
    groupsEl.append(d);
  }

  // Single-page groups (and pages with no group yet) go in one list:
  // their "label" is just the page title, so a separate heading adds nothing.
  const grouped = new Set(multi.flatMap((n) => n.pageIds));
  const others = [...pages.values()].filter((p) => !grouped.has(p.id)).sort(byRecent);
  if (others.length) {
    const d = el('details', null, 'group');
    const s = el('summary', 'Other pages');
    s.append(el('small', ` ${others.length}`));
    const ul = el('ul');
    for (const p of others) ul.append(pageRow(p));
    d.append(s, ul);
    groupsEl.append(d);
  }

  if (!pages.size) {
    groupsEl.append(el('p', 'Nothing saved yet. Open the Smriti popup and click "Wrap up session".', 'empty'));
  }
}

// Results grouped by node: pages from the same multi-page group sit under its
// label; single-page nodes appear as standalone rows. Blocks are ordered by
// their best score.
function renderResults() {
  resultsEl.replaceChildren();
  const list = items.filter((i) => pages.has(i.pageId));
  if (!list.length) {
    resultsEl.append(el('p', 'No matching pages.', 'empty'));
    return;
  }

  const blocks = new Map();
  for (const it of list) {
    const n = nodeOf.get(it.pageId);
    const grouped = n && n.pageIds.length > 1;
    const key = grouped ? `n${n.id}` : `p${it.pageId}`;
    let b = blocks.get(key);
    if (!b) {
      b = { node: grouped ? n : null, items: [], best: -Infinity };
      blocks.set(key, b);
    }
    b.items.push(it);
    b.best = Math.max(b.best, it.score);
  }

  for (const b of [...blocks.values()].sort((x, y) => y.best - x.best)) {
    const sec = el('div', null, 'block');
    if (b.node) {
      const h = el('h3', b.node.label || '(unnamed)');
      h.append(el('small', ` ${b.items.length} of ${b.node.pageIds.length} pages`));
      if (b.node.summary) h.title = b.node.summary;
      sec.append(h);
    }
    const ul = el('ul');
    for (const it of b.items.sort((x, y) => y.score - x.score)) {
      ul.append(pageRow(pages.get(it.pageId), it));
    }
    sec.append(ul);
    resultsEl.append(sec);
  }
}

function showResults(on) {
  resultsEl.hidden = !on;
  groupsEl.hidden = on;
}

// ---------- search ----------

// Typing: instant keyword matches from IndexedDB, no model needed.
qEl.addEventListener('input', () => {
  searchSeq++; // cancels any semantic search still in flight
  const q = qEl.value.trim();
  if (!q) {
    showResults(false);
    setStatus(summaryText());
    return;
  }
  items = keywordMatches(q);
  showResults(true);
  renderResults();
  setStatus(`${items.length} title/URL match${items.length === 1 ? '' : 'es'}. Press Enter to search by meaning.`);
});

// Enter: semantic search through the service worker (embeds the query with MiniLM).
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = qEl.value.trim();
  if (!q) return;
  const seq = ++searchSeq;

  const kw = keywordMatches(q);
  items = kw;
  showResults(true);
  renderResults();
  setStatus('Searching by meaning... the first search takes a few seconds while the model starts.');

  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'SEARCH', query: q });
  } catch (err) {
    res = { ok: false, error: String(err?.message || err) };
  }
  if (seq !== searchSeq) return; // a newer query replaced this one

  if (!res?.ok) {
    setStatus(`Semantic search failed: ${res?.error ?? 'no reply'}. Showing keyword matches only.`);
    return;
  }

  const kwIds = new Set(kw.map((i) => i.pageId));
  const merged = [];
  const seen = new Set();
  for (const r of res.results) {
    const kwHit = kwIds.has(r.pageId);
    merged.push({
      pageId: r.pageId,
      sem: r.score,
      keyword: kwHit,
      score: r.score + (kwHit ? KEYWORD_BOOST : 0),
      snippet: r.snippet,
    });
    seen.add(r.pageId);
  }
  for (const k of kw) if (!seen.has(k.pageId)) merged.push(k); // title match the model scored low
  items = merged;
  renderResults();
  setStatus(`${merged.length} result${merged.length === 1 ? '' : 's'}.`);
});

// ---------- delete ----------

async function deletePage(id) {
  const p = pages.get(id);
  if (!p) return;
  if (!confirm(`Remove "${titleOf(p)}" from Smriti?\nIts saved text and embeddings are deleted from this device.`)) return;

  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'DELETE_PAGE', pageId: id });
  } catch (err) {
    res = { ok: false, error: String(err?.message || err) };
  }
  if (!res?.ok) {
    const msg = `Could not delete: ${res?.error ?? 'no reply'}`;
    setStatus(msg);
    alert(msg); // a refusal (e.g. wrap-up running) must be impossible to miss
    return;
  }
  await load();
  renderGroups();
  if (!resultsEl.hidden) renderResults(); // drops the deleted page (items are filtered by pages)
  setStatus('Page removed.');
}

// ---------- refresh when a wrap-up finishes while this tab is open ----------

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.wrapUpStatus) return;
  if (changes.wrapUpStatus.newValue?.state !== 'done') return;
  await load();
  renderGroups();
  if (!resultsEl.hidden) renderResults();
  else setStatus(summaryText());
});

// ---------- start ----------

(async () => {
  await load();
  renderGroups();
  setStatus(summaryText());
})();