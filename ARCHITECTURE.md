# Smriti — Project Structure & Architecture Reference

This doc is the map of the whole project. Keep it updated as we build —
it's what lets us resume work in a fresh chat without re-explaining everything.

## Folder structure

```
smriti-project/
├── manifest.json                 # Extension config (Manifest V3)
├── ARCHITECTURE.md               # This file — system design reference
├── PROJECT_STATE.md              # Session handoff doc — update every session
│
├── background/
│   └── service-worker.js         # Orchestrator: routes messages, manages
│                                  # the embedding queue, talks to storage
│
├── content/
│   └── extractor.js              # Injected into pages. Pulls readable
│                                  # content (Readability-style), sends to
│                                  # background worker via chrome.runtime
│
├── popup/
│   ├── popup.html                # Extension toolbar popup UI
│   ├── popup.js                  # "Wrap up session" trigger, quick search
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
│   │                              # through here, nowhere else            [DONE]
│   ├── summarizer.js             # Cluster summary generation (Groq API /
│   │                              # Gemini Nano Summarizer API, with fallback)
│   └── readability.js             # Third-party content extraction lib (vendored)
│
├── models/                       # Local WASM embedding model files (if bundled)
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Data flow (high level)

```
[Content Script]                [Background Worker]              [Storage/IndexedDB]
extractor.js  ── raw text ──▶  service-worker.js
                                     │
                                     ▼
                              embeddings.js (chunk + embed)
                                     │
                                     ▼
                              clustering.js (compare to
                              existing graph nodes)
                                     │
                                     ▼
                              storage.js ───────────────────▶  nodes, edges,
                                                                 chunks, vectors
                                     │
                                     ▼
                              summarizer.js (only for
                              session wrap-up, batched)
```

## IndexedDB schema (implemented in lib/storage.js, DB name `smriti`, version 1)

All vectors are stored as **Float32Array** (IndexedDB stores typed arrays
natively). storage.js converts plain arrays automatically on write.

**Object store: `pages`** — keyPath `id` (autoIncrement)
- `id`
- `url` (unique index)
- `title`
- `content` (extracted text, or reference to chunk ids)
- `visitedAt` (timestamp; indexed)
- `chunkIds[]`

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

## Interfaces (exported function signatures of finished modules)

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

## Pending decisions (flagged, NOT yet applied — need user's call)

- **Manifest: content script injection.** manifest.json currently injects
  `extractor.js` on `<all_urls>` at `document_idle`, i.e. on every page load.
  This conflicts with the batch/manual-trigger design and makes the permission
  prompt look broad. Proposal: remove the `content_scripts` block and inject
  `extractor.js` on demand via `chrome.scripting.executeScript` when the user
  clicks "Wrap up session". Decide when building `content/extractor.js`.
- **Manifest: `web_accessible_resources`.** Currently exposes `models/*` and
  `lib/*` to all pages, which lets any website probe for the extension. Likely
  unnecessary (service worker and extension pages can load these directly).
  Proposal: remove. Revisit when wiring up embeddings/model loading.

## Sync SOP (VS Code ↔ chat ↔ Project knowledge base)

- **Source of truth:** VS Code / git repo. Chat and knowledge base are copies.
- **Knowledge base holds only:** `ARCHITECTURE.md`, `PROJECT_STATE.md`,
  `manifest.json`. No source code (goes stale, and stale is worse than absent).
- **Per session:** paste full current content of any file about to be edited
  (not diffs) → Claude replies with complete files → copy into VS Code and
  test → paste console errors verbatim → commit after each working chunk.
- **End of session:** Claude produces updated `PROJECT_STATE.md` (and
  `ARCHITECTURE.md` if design or interfaces changed). Save to repo, commit,
  and **replace the copies in the Project knowledge base**.
- **Interfaces section** above replaces the need to paste finished modules
  into every chat. Paste a module's source only when it is being edited.
- What is pasted in chat always overrides the knowledge base if they disagree.

## MVP feature scope (v1 — build this first)

- [ ] Manual "Wrap up session" trigger from popup
- [ ] Content extraction from all open tabs
- [ ] Local embedding of extracted content
- [ ] Similarity-threshold clustering (new content vs. existing graph nodes)
- [x] IndexedDB storage of pages/chunks/nodes (lib/storage.js, session 1)
- [ ] Cluster summary generation (Groq fallback if Nano unavailable)
- [ ] Search view (list-based, not visual graph) over accumulated nodes

## Build order (bottom-up)

1. ~~`lib/storage.js`~~ done
2. `content/extractor.js` + `lib/readability.js`
3. `lib/embeddings.js`
4. `lib/clustering.js`
5. `background/service-worker.js`
6. `popup/`
7. `lib/summarizer.js`, then `graph-view/`

## Stretch goals (v2, only after v1 is solid)

- [ ] Passive "related content" nudge on new page load
- [ ] Visual node-graph UI
- [ ] Duplicate/stale tab detection
- [ ] Actionability triage (read-later / reference / active-task)
