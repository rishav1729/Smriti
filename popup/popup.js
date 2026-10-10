// popup/popup.js
// The popup can be closed at any time (Chrome closes it when you click away).
// So it never waits for the wrap-up result: it shows whatever the service
// worker last wrote to chrome.storage.local, and updates live while open.
import { getAllPages, clearAll } from '../lib/storage.js';

const STATUS_KEY = 'wrapUpStatus';
const STALE_MS = 3 * 60 * 1000; // a "running" status not updated for 3 min = worker died

const $ = (id) => document.getElementById(id);
const btn = $('wrap');
const statusEl = $('status');

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
  if (s.clusterError) lines.push(`Grouping failed: ${s.clusterError}`);
  if (s.failed.length) {
    lines.push(`Problems (${s.failed.length}):`);
    for (const f of s.failed) lines.push(`- ${f.url}: ${f.error}`);
  }
  return lines.join('\n');
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

$('clear').addEventListener('click', async () => {
  await clearAll();
  await chrome.storage.local.remove(STATUS_KEY);
  statusEl.textContent = 'Database cleared.';
  await refreshList();
});

// Live updates while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STATUS_KEY]) {
    const st = changes[STATUS_KEY].newValue;
    render(st);
    if (st?.state !== 'running') refreshList(); // list only refreshes when finished
  }
});

// On open: show the latest status (running, done, or error).
(async () => {
  const got = await chrome.storage.local.get(STATUS_KEY);
  render(got[STATUS_KEY]);
  await refreshList();
})();