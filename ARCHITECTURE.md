# Smriti — Project Structure & Architecture Reference

This doc is the map of the whole project. Keep it updated as we build —
it's what lets us resume work in a fresh chat without re-explaining everything.

## Folder structure

```
smriti-project/
├── manifest.json                 # Extension config (Manifest V3)        [UPDATED s1]
├── ARCHITECTURE.md               # This file — system design reference
├── PROJECT_STATE.md              # Session handoff doc — update every session
│
├── background/
│   └── service-worker.js         # Orchestrator: routes messages, manages
│                                  # the embedding queue, talks to storage
│                                  # (v0: wrap-up -> inject -> save)      [v0 working, tested s1]
│
├── content/
│   └── extractor.js              # Injected ON DEMAND (never auto-run).
│                                  # Returns readable content via the
│                                  # executeScript result                  [working, tested s1]
│
├── popup/
│   ├── popup.html                # Extension toolbar popup UI            [v0 working, tested s1]
│   ├── popup.js                  # "Wrap up session" trigger, saved-pages list
│   └── popup.css
│
├── graph-view/                   # Full-page search/list view (opens as a tab)
│   ├── graph.html
│   ├── graph.js                  # Search UI, cluster list, results
│   └── graph.css
│
├── lib/
│   ├── embeddings.js             # Wraps transformers.js (WASM) — text → vector
│   │                              # Falls back from Chrome Gemini Nano if unavailable
│   ├── clustering.js             # Similarity-threshold clustering logic
│   ├── storage.js                # IndexedDB wrapper — all DB reads/writes go
│   │                              # through here, nowhere else            [working, tested s1]
│   ├── summarizer.js             # Cluster summary generation (Groq API /
│   │                              # Gemini Nano Summarizer API, with fallback)
│   └── readability.js            # Mozilla Readability (Apache-2.0), vendored
│                                  # from npm @mozilla/readability. Keep its
│                                  # license header. Credit in README.     [vendored s1]
│
├── models/                       # Local WASM embedding model files (if bundled)
│
└── icons/
    ├── icon16.png                # Placeholder icons (generated), replace later
    ├── icon48.png
    └── icon128.png
```

## Data flow (high level)

```
[Popup click]                    [Background Worker]              [Storage/IndexedDB]
"Wrap up session"
 1. permissions.request  ─────▶  service-worker.js
 2. sendMessage WRAP_UP              │ tabs.query → http(s), non-incognito
                                     │ executeScript(readability.js + extractor.js)
                                     ▼
                              page text (per tab)
                                     │
                                     ▼
                              embeddings.js (chunk + embed)       [not built]
                                     │
                                     ▼
                              clustering.js (compare to           [not built]
                              existing graph nodes)
                                     │
                                     ▼
                              storage.js ───────────────────▶  pages, chunks,
                                     │                          nodes, edges
                                     ▼
                              summarizer.js (only for             [not built]
                              session wrap-up, batched)
```

## IndexedDB schema (implemented in lib/storage.js, DB name `smriti`, version 1)

All vectors are stored as **Float32Array** (IndexedDB stores typed arrays
natively). storage.js converts plain arrays automatically on write.

**Object store: `pages`** — keyPath `id` (autoIncrement)
- `id`
- `url` (unique index; hash fragment stripped before saving)
- `title`
- `content` (extracted text, capped at 200k chars)
- `visitedAt` (timestamp; indexed)
- `chunkIds[]`
- extra fields written by the service worker (schemaless, not indexed):
  `siteName`, `method` ('readability' | 'fallback'), `truncated` (bool)

**Object store: `chunks`** — keyPath `id` (autoIncrement)
- `id`
- `pageId` (indexed)
- `text`
- `embedding` (Float32Array)

**Object store: `nodes`** (graph concepts/clusters) — keyPath `id` (autoIncrement)
- `id`
- `label` (e.g. "Redis Caching")
- `centroidEmbedding` (Float32Array)
- `pageIds[]`
- `summary`
- `createdAt`, `lastUpdatedAt` (lastUpdatedAt indexed; both set by storage.js)

**Object store: `edges`** (optional, if we build node-to-node relations)
— compound keyPath `[sourceNodeId, targetNodeId]`
- `sourceNodeId` (indexed)
- `targetNodeId` (indexed)
- `weight` (similarity score)

## Interfaces (exported function signatures / contracts of finished modules)

Later modules are written against these. If a signature changes, update here.

### lib/storage.js
```
savePage(page) → id                     // upsert by url; keeps id stable on re-visit
getPage(id) / getPageByUrl(url) / getAllPages()
deletePage(id)                          // also deletes its chunks (not nodes)
saveChunks(pageId, [{text, embedding}]) → chunkIds[]
                                        // replaces the page's existing chunks and
                                        // updates page.chunkIds, in one transaction
getChunksByPage(pageId) / getAllChunks()
saveNode(node) → id                     // upsert; sets createdAt, lastUpdatedAt
getNode(id) / getAllNodes()
deleteNode(id)                          // also deletes edges touching it
saveEdge({sourceNodeId, targetNodeId, weight})
getEdgesForNode(nodeId)                 // edges where node is source or target
clearAll()                              // dev only
```
All functions are async and exported as ES module named exports.

### content/extractor.js (classic script, not a module)
Injected only via
`chrome.scripting.executeScript({ target:{tabId}, files:['lib/readability.js','content/extractor.js'] })`
(order matters). No listeners, no messaging. Result is `results[0].result`:
```
{ url, title, content, truncated, excerpt, byline, siteName, lang,
  method: 'readability' | 'fallback', extractedAt }
```
Readability runs on a cloned DOM; falls back to `body.innerText` if the
Readability result is missing or under 200 chars.

### background/service-worker.js (message API)
```
chrome.runtime.sendMessage({ type: 'WRAP_UP' })
  → { ok: true, summary: { saved, skipped, failed: [{url, error}] } }
  | { ok: false, error }
```
Only http(s), non-incognito tabs are read. Pages are saved via `savePage`.
Dev hook: `globalThis.storage` exposes storage.js in the service worker
console (dynamic `import()` is not allowed in service workers). Remove before
publishing.

### popup/popup.js
Imports `lib/storage.js` directly for reads (`getAllPages`) and the dev `clearAll`:
extension pages share the extension's IndexedDB, so no message round trip is
needed. Writes still go through the service worker.

## Key design decisions (so we don't relitigate these every session)

1. **Batch ingestion, not continuous.** Embedding happens on session
   wrap-up (user-triggered) or idle-triggered, not on every page load.
   Passive "related content" nudge is a *lookup only* (cheap), separate
   from ingestion (expensive).
2. **Local embeddings first.** transformers.js (WASM, all-MiniLM-L6-v2)
   is the primary embedding engine — free, offline, no rate limits.
   Chrome's on-device Gemini Nano APIs used opportunistically if available.
3. **Cloud LLM (Groq free tier) is only for summarization**, not embedding,
   and only during batched wrap-up — never per-page, to respect free-tier
   rate limits.
4. **No auto-submit / no silent background network calls of page content.**
   Everything stays local; only anonymized short prompts (for summarization)
   may go to Groq, and only if the user has enabled that fallback.
5. **Vectors stored as Float32Array** (decided session 1) — about half the
   size of plain arrays and faster for similarity math.
6. **On-demand extraction** (decided session 1). No `content_scripts` in the
   manifest. The extractor is injected with `chrome.scripting.executeScript`
   only when the user clicks "Wrap up session". Consequence: tabs closed
   before wrap-up are not captured (a lightweight tab-URL log could address
   this later, v2).
7. **Runtime host access** (decided session 1). `<all_urls>` is in
   `optional_host_permissions`; the popup calls `chrome.permissions.request`
   on the first wrap-up click (must be the first await in the click handler,
   it requires a user gesture). `tabs` and `activeTab` permissions removed
   (not needed once host access is granted); re-add `tabs` only if
   `tab.url` comes back undefined. `web_accessible_resources` removed so
   websites cannot probe for the extension.

## Pending decisions

- Manifest questions from session 1 are resolved (decisions 6 and 7).
- Before/while building `embeddings.js` (recommendations, not yet agreed):
  1. Run inference in an offscreen document (`chrome.offscreen`), not the
     service worker (MV3 workers are killed after ~30s idle).
  2. Bundle all-MiniLM-L6-v2 files in `models/` and load locally; no CDN fetch
     at runtime (privacy promise).
  3. Chunking: ~200 words per chunk, small overlap, split on paragraph
     boundaries (MiniLM caps at ~256 tokens).
- Future: strategy for capturing closed tabs / reading history (v2).
- Future: chunking strategy (size, overlap) when building `embeddings.js`.

## Known issues / tuning (extractor)

- **Readability can pick a partial subtree on app-style pages** (e.g. a Claude
  chat page went from 9,567 chars via fallback to 1,009 via Readability).
  Options: gate with `isProbablyReaderable`, or fall back when Readability text
  is much shorter than `innerText`. Decide before cluster quality matters.
- **Thin pages get saved** (e.g. a 198-char JioHotstar page). Add a minimum
  content length filter (~300-500 chars).
- **Asleep/discarded or still-loading tabs** can fail injection with the
  misleading error "Extension manifest must request permission to access the
  respective host" (probable cause; woke tabs then saved fine). The service
  worker appends `[discarded=..., status=...]` to failure messages.
- **Titles:** Readability strips site-name suffixes (e.g. "Claude (AI)" rather
  than "Claude (AI) - Wikipedia"); it also dropped notification prefixes like
  "(76)" as a side effect.

## Sync SOP (VS Code ↔ chat ↔ Project knowledge base)

- **Source of truth:** VS Code / git repo. Chat and knowledge base are copies.
- **Knowledge base holds only:** `ARCHITECTURE.md`, `PROJECT_STATE.md`,
  `manifest.json`. No source code (goes stale, and stale is worse than absent).
- **Per session:** paste full current content of any file about to be edited
  (not diffs) → Claude replies with complete files → copy into VS Code and
  test → paste console errors verbatim → commit after each working chunk.
- **End of session:** Claude produces updated `PROJECT_STATE.md` (and
  `ARCHITECTURE.md` if design or interfaces changed). Save to repo, commit,
  and **replace the copies in the Project knowledge base** (including
  `manifest.json` when it changed, as it did in session 1).
- **Interfaces section** above replaces the need to paste finished modules
  into every chat. Paste a module's source only when it is being edited.
- What is pasted in chat always overrides the knowledge base if they disagree.
- Claude cannot read repo file contents from GitHub (automated access is
  blocked), so the repo link is a reference only.

## MVP feature scope (v1 — build this first)

- [x] Manual "Wrap up session" trigger from popup (v0 working, tested s1)
- [x] Content extraction from all open tabs (working, tested s1; see Known issues)
- [ ] Local embedding of extracted content
- [ ] Similarity-threshold clustering (new content vs. existing graph nodes)
- [x] IndexedDB storage of pages/chunks/nodes (lib/storage.js, tested s1)
- [ ] Cluster summary generation (Groq fallback if Nano unavailable)
- [ ] Search view (list-based, not visual graph) over accumulated nodes

## Build order (bottom-up)

1. `lib/storage.js` written
2. `content/extractor.js` + `lib/readability.js` written (vendor Readability manually)
3. Minimal `background/service-worker.js` + `popup/` + icons (v0, for testing 1 and 2)
4. Test 1–3 in Chrome (done, session 1)
5. `lib/embeddings.js` ← current step
6. `lib/clustering.js`
7. Extend service worker (embed, cluster) and popup
8. `lib/summarizer.js`, then `graph-view/`

## Stretch goals (v2, only after v1 is solid)

- [ ] Passive "related content" nudge on new page load
- [ ] Visual node-graph UI
- [ ] Duplicate/stale tab detection
- [ ] Actionability triage (read-later / reference / active-task)
- [ ] Capture tabs closed before wrap-up