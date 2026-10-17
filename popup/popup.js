// popup/popup.js
// The popup can be closed at any time (Chrome closes it when you click away).
// So it never waits for the wrap-up result: it shows whatever the service
// worker last wrote to chrome.storage.local, and updates live while open.
import { getAllPages, getAllNodes } from '../lib/storage.js';
import { SETTINGS_KEY, GROQ_ORIGIN } from '../lib/summarizer.js';

const STATUS_KEY = 'wrapUpStatus';
const STALE_MS = 3 * 60 * 1000; // a "running" status not updated for 3 min = worker died

const $ = (id) => document.getElementById(id);
const btn = $('wrap');
const nameBtn = $('name');
const clearBtn = $('clear');
const removeKeyBtn = $('removekey');
const statusEl = $('status');
const cloudEl = $('cloud');
const keyEl = $('key');

// ---------- lists ----------

async function refreshList() {
  const pages = (await getAllPages()).sort((a, b) => b.visitedAt - a.visitedAt);
  $('count').textContent = pages.length;
  const list = $('list');
  list.replaceChildren();
  for (const p of pages.slice(0, 50)) {
    const li = document.createElement('li');
    li.textContent = p.title || p.url; // textContent, never innerHTML (page titles are untrusted)
    const small = document.createElement('small');
    small.textContent = ` ${(p.content?.length ?? 0).toLocaleString()} chars, ${p.method ?? '?'}`;
    li.append(small);
    list.append(li);
  }
}

async function refreshGroups() {
  const nodes = (await getAllNodes()).sort((a, b) => b.pageIds.length - a.pageIds.length);
  $('gcount').textContent = nodes.length;
  const list = $('groups');
  list.replaceChildren();
  for (const n of nodes.slice(0, 30)) {
    const li = document.createElement('li');
    li.textContent = n.label || '(unnamed)'; // labels can come from a model: textContent only
    if (n.summary) li.title = n.summary;
    const small = document.createElement('small');
    small.textContent =
      ` ${n.pageIds.length} page${n.pageIds.length === 1 ? '' : 's'}` +
      (n.labelSource === 'cloud' ? ', Groq' : '');
    li.append(small);
    list.append(li);
  }
}

const refreshAll = () => Promise.all([refreshList(), refreshGroups()]);

// ---------- status ----------

function formatSummary(s) {
  const lines = [
    `Done. Saved ${s.saved} (new embeddings: ${s.embedded}, unchanged: ${s.unchanged}).`,
    `Skipped ${s.skipped}, too short ${s.thin}, asleep/loading ${s.asleep}.`,
  ];
  if (s.clustered) {
    lines.push(
      `Groups: ${s.clustered.nodes} total (${s.clustered.newPages} new pages grouped, ${s.clustered.merged} merged).`
    );
  }
  if (s.droppedSearch) {
    lines.push(
      `Dropped ${s.droppedSearch} search-result page${s.droppedSearch === 1 ? '' : 's'} (not related to other pages).`
    );
  }
  if (s.clusterError) lines.push(`Grouping failed: ${s.clusterError}`);
  if (s.named) lines.push(formatNamed(s.named));
  if (s.nameError) lines.push(`Naming failed: ${s.nameError}`);
  if (s.failed.length) {
    lines.push(`Problems (${s.failed.length}):`);
    for (const f of s.failed) lines.push(`- ${f.url}: ${f.error}`);
  }
  return lines.join('\n');
}

function formatNamed(r) {
  let line = `Named ${r.local} group${r.local === 1 ? '' : 's'} locally, ${r.cloud} with Groq.`;
  if (r.note) line += ` ${r.note}`;
  return line;
}

function render(st) {
  if (!st) {
    statusEl.textContent = 'Ready.';
    btn.disabled = false;
    return;
  }
  if (st.state === 'running') {
    if (Date.now() - st.updatedAt > STALE_MS) {
      statusEl.textContent = 'The last wrap-up was interrupted. Run it again.';
      btn.disabled = false;
      return;
    }
    statusEl.textContent =
      `Working: ${st.stage} (tab ${Math.min(st.done + 1, st.total)} of ${st.total}).\n` +
      'You can close this popup and come back.';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  statusEl.textContent =
    st.state === 'done' ? formatSummary(st.summary) : `Error: ${st.error}`;
}

// ---------- settings (Groq opt-in) ----------

async function readSettings() {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return { cloudSummaries: false, groqKey: '', ...(got[SETTINGS_KEY] || {}) };
}

async function saveSettings(patch) {
  const cur = await readSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...cur, ...patch } });
}

function showKeyState(hasKey) {
  keyEl.value = '';
  keyEl.placeholder = hasKey ? 'Key saved (paste to replace)' : 'Groq API key';
}

cloudEl.addEventListener('change', async () => {
  if (cloudEl.checked) {
    // Must be the first await so the click's user gesture is still valid.
    const ok = await chrome.permissions.request({ origins: [GROQ_ORIGIN] });
    if (!ok) {
      cloudEl.checked = false;
      statusEl.textContent = 'Access to api.groq.com was not granted, so cloud naming stays off.';
      return;
    }
  }
  await saveSettings({ cloudSummaries: cloudEl.checked });
});

keyEl.addEventListener('change', async () => {
  const k = keyEl.value.trim();
  if (!k) return;
  await saveSettings({ groqKey: k });
  showKeyState(true);
});

removeKeyBtn.addEventListener('click', async () => {
  const s = await readSettings();
  if (!s.groqKey) {
    statusEl.textContent = 'No Groq key is saved.';
    return;
  }
  if (!confirm('Remove the saved Groq key and turn off cloud naming?')) return;
  await saveSettings({ groqKey: '', cloudSummaries: false });
  cloudEl.checked = false;
  showKeyState(false);
  statusEl.textContent = 'Groq key removed. Cloud naming is off.';
});

nameBtn.addEventListener('click', async () => {
  nameBtn.disabled = true;
  statusEl.textContent = 'Naming groups...';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'SUMMARIZE' });
    statusEl.textContent = res?.ok ? formatNamed(res.result) : `Error: ${res?.error ?? 'no reply'}`;
  } catch {
    statusEl.textContent = 'Naming was interrupted. Try again.';
  }
  nameBtn.disabled = false;
  await refreshGroups();
});

// ---------- wrap-up ----------

btn.addEventListener('click', async () => {
  // Must be the first await so the click's user gesture is still valid.
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if (!granted) {
    statusEl.textContent = 'Access to open tabs was not granted, so nothing was read.';
    return;
  }
  btn.disabled = true;
  statusEl.textContent = 'Starting...';
  // Don't wait for the result: progress arrives through storage updates below.
  chrome.runtime.sendMessage({ type: 'WRAP_UP' }).then((res) => {
    if (res && !res.ok) statusEl.textContent = `Error: ${res.error}`;
  }).catch(() => { /* popup closed or worker restarted: status comes from storage */ });
});

// Opens the full-page search/list view in a tab (no extra permission needed).
$('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('graph-view/graph.html') });
  window.close();
});

// ---------- delete all data ----------

clearBtn.addEventListener('click', async () => {
  if (!confirm(
    'Delete all saved pages, groups and search data from this device?\n\n' +
    'This cannot be undone. Your Groq settings are kept.'
  )) return;

  clearBtn.disabled = true;
  statusEl.textContent = 'Deleting...';
  try {
    // The service worker does the write: it owns the `running` guard, so this
    // can never interleave with a wrap-up.
    const res = await chrome.runtime.sendMessage({ type: 'CLEAR_ALL' });
    statusEl.textContent = res?.ok ? 'All saved data deleted.' : `Error: ${res?.error ?? 'no reply'}`;
  } catch {
    statusEl.textContent = 'Deleting was interrupted. Try again.';
  }
  clearBtn.disabled = false;
  await refreshAll();
});

// Live updates while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STATUS_KEY]) {
    const st = changes[STATUS_KEY].newValue;
    render(st);
    if (st?.state !== 'running') refreshAll(); // lists only refresh when finished
  }
});

// On open: show the latest status (running, done, or error) and saved settings.
(async () => {
  const got = await chrome.storage.local.get(STATUS_KEY);
  render(got[STATUS_KEY]);
  const s = await readSettings();
  cloudEl.checked = s.cloudSummaries;
  showKeyState(!!s.groqKey);
  await refreshAll();
})();