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
`2026-10-06 — session 1`

## Current phase
Bottom-up build, step 1 of 7 complete (`lib/storage.js` written). Next: step 2,
content extraction.

## What's working right now
- `lib/storage.js` is written (IndexedDB wrapper: pages, chunks, nodes, edges;
  vectors stored as Float32Array). **Not yet run or tested in the browser.**
- Project docs and sync SOP are set up (see ARCHITECTURE.md → "Sync SOP").
- Nothing else exists yet. `manifest.json` references files that have not been
  created (service worker, popup, extractor, icons), so the extension will not
  load until those exist.

## What's broken / in progress
- Nothing known broken. `storage.js` is untested: a quick save/read round trip
  from the service worker console is still to do once the service worker exists.

## Files touched this session
- `lib/storage.js` (new, complete; interface documented in ARCHITECTURE.md →
  "Interfaces", so its source is not pasted below. Paste it from VS Code only
  if we need to edit it.)
- `ARCHITECTURE.md` (updated: Float32Array schema, Interfaces section, Sync SOP,
  pending decisions, build order, MVP checkbox)
- `PROJECT_STATE.md` (this file)

## Decisions made this session
- Vectors stored as `Float32Array` (deviates from the original "stored as array"
  note; ARCHITECTURE.md updated).
- Sync SOP adopted: VS Code/git is the source of truth; the Project knowledge
  base holds only ARCHITECTURE.md, PROJECT_STATE.md and manifest.json; finished
  modules are documented as signatures in the Interfaces section.
- `savePage` upserts on unique `url`; `saveChunks` replaces a page's chunks and
  updates `page.chunkIds` in one transaction.

## Next immediate step
Build `content/extractor.js` and vendor `lib/readability.js`. Decide the
manifest change below first, since it determines how the extractor is injected.

## Open questions / blockers
- **Manifest content script:** switch from `<all_urls>` auto-injection to
  on-demand `chrome.scripting.executeScript` on "Wrap up session"? (Recommended:
  more privacy-consistent, fits the batch design. Awaiting your call.)
- **Manifest `web_accessible_resources`:** remove `models/*` and `lib/*` exposure?
  (Recommended; can wait until embeddings work.)
- Optional: want a small test snippet for storage.js round trip?

---

## Full current file contents

No source files need to be pasted for the next step. `lib/storage.js` is stable
and covered by the Interfaces section of ARCHITECTURE.md. `manifest.json` is
unchanged from the Project knowledge base copy.
