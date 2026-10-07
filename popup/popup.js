// popup/popup.js
import { getAllPages, clearAll } from '../lib/storage.js';

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

btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    // Must be the first await so the click's user gesture is still valid.
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!granted) {
      statusEl.textContent = 'Access to open tabs was not granted, so nothing was read.';
      return;
    }
    statusEl.textContent = 'Reading open tabs...';
    const res = await chrome.runtime.sendMessage({ type: 'WRAP_UP' });
    if (!res?.ok) throw new Error(res?.error || 'Unknown error');
    const { saved, skipped, failed } = res.summary;
    statusEl.textContent =
      `Saved ${saved}, skipped ${skipped}, failed ${failed.length}.` +
      failed.map((f) => `\n- ${f.url}: ${f.error}`).join('');
    await refreshList();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

$('clear').addEventListener('click', async () => {
  await clearAll();
  statusEl.textContent = 'Database cleared.';
  await refreshList();
});

refreshList();