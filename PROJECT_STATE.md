# Smriti — Session Handoff

> HOW TO USE THIS FILE:
> 1. Update this file yourself at the end of every work session (or ask me
>    to "update the handoff doc" before you close the chat — I'll fill it
>    in based on what we did).
> 2. When you start a NEW chat, paste this whole file as your first
>    message, plus the current content of any files listed under
>    "Files touched this session."
> 3. I have zero memory of past chats — this file + the actual code files
>    are the only continuity between sessions. Treat it as the source of truth.

---

## Last updated
`2026-10-07 — end of session 1`

## Current phase
Bottom-up build, steps 1–4 done and tested in Chrome. Next: step 5,
`lib/embeddings.js`.

## What's working right now (all tested in Chrome, session 1)
- `lib/storage.js`: IndexedDB wrapper. Round trip verified: page upsert,
  chunks stored as `Float32Array`, `page.chunkIds` updated, `deletePage`
  removes page and chunks.
- `content/extractor.js` + vendored `lib/readability.js` (90,944 bytes,
  Apache-2.0 header intact, downloaded from mozilla/readability main on
  2026-10-07). Wikipedia/doc pages report `readability`; app pages report
  `readability` or `fallback`.
- `background/service-worker.js` v0: WRAP_UP injects the extractor into open
  http(s), non-incognito tabs and saves via `savePage`. Dev hook
  `globalThis.storage` is still present (remove before publishing).
- `popup/` v0: permission request on click, wrap-up, saved-pages list,
  "Clear all (dev)".
- Re-running wrap-up upserts by URL (stored count stayed at 27 across runs).
- Placeholder icons, updated `manifest.json` (no content scripts, optional
  host permissions).
- GitHub repo: https://github.com/rishav1729/Smriti (reference only; Claude
  cannot read its file contents).

## What's broken / known issues
- Readability can grab a partial subtree on app-style pages (a Claude chat page
  dropped from 9,567 to 1,009 chars). Decide a gating rule (see ARCHITECTURE.md
  → Known issues).
- Thin pages are saved (e.g. 198 chars). Add a minimum-length filter.
- Asleep/discarded or still-loading tabs can fail injection with a misleading
  "must request permission" error; waking the tab and retrying fixed it.
- Node.js/npm is NOT installed on the dev machine (Windows, PowerShell).
  Matters for bundling transformers.js next.

## Files touched this session
- `lib/storage.js`, `lib/readability.js` (vendored), `content/extractor.js`
- `background/service-worker.js`, `popup/popup.html|js|css`
- `icons/icon16|48|128.png` (placeholders)
- `manifest.json` (removed `content_scripts`, `web_accessible_resources`,
  `tabs`, `activeTab`; `<all_urls>` is now an optional host permission)
- `ARCHITECTURE.md`, `PROJECT_STATE.md`

## Decisions made this session
- Vectors stored as `Float32Array`.
- Sync SOP adopted (ARCHITECTURE.md → Sync SOP). Knowledge base holds only
  ARCHITECTURE.md, PROJECT_STATE.md, manifest.json.
- On-demand extraction via `chrome.scripting.executeScript`; host access
  requested at runtime from the popup click; incognito and non-http(s) tabs are
  never read. Closed tabs are not captured (v2 idea).
- `savePage` upserts on unique `url`; `saveChunks` replaces a page's chunks and
  updates `page.chunkIds` in one transaction.
- Dynamic `import()` is not allowed in service workers, hence the dev-only
  `globalThis.storage` hook.

## Next immediate step
Build `lib/embeddings.js` and wire it into wrap-up. Decide first (my
recommendations, not yet agreed):
1. Run inference in an offscreen document (`chrome.offscreen`), not the service
   worker.
2. Bundle all-MiniLM-L6-v2 in `models/`, no CDN fetch at runtime.
3. Chunking: ~200 words, small overlap, paragraph boundaries.
Also needed: a way to get transformers.js into the repo. Either install Node.js
and bundle, or vendor a prebuilt dist file manually.
Small cleanups to bundle in: minimum content length filter, Readability gating.

## Open questions / blockers
- Offscreen document vs other approach for WASM inference (see above).
- How to vendor transformers.js and model files without Node (or install Node).
- Chunk size and overlap values.
- Interview-worthy so far: on-demand injection with runtime-granted host
  permissions (privacy design), transactional chunk replacement in storage,
  Readability on a cloned DOM with fallback. Routine: popup UI, icons,
  IndexedDB CRUD.

---

## Full current file contents

No source files are pasted here. Paste from VS Code only the files we are about
to edit. Replace the Project knowledge base copies of `ARCHITECTURE.md`,
`PROJECT_STATE.md` and `manifest.json` with the updated versions.