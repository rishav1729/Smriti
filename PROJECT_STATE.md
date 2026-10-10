# Smriti — Session Handoff

> HOW TO USE THIS FILE:
> 1. Update this file yourself at the end of every work session (or ask me
>    to "update the handoff doc" before you close the chat — I'll fill it
>    in based on what we did).
> 2. When you start a NEW chat, paste this whole file as your first
>    message, plus the current content of any files listed under
>    "Files to paste next session."
> 3. I have zero memory of past chats — this file + the actual code files
>    are the only continuity between sessions. Treat it as the source of truth.

---

## Last updated
`2026-10-10 — end of session 4`

## Current phase
Bottom-up build, steps 1–8 done and tested in Chrome: pages are extracted,
embedded, clustered into nodes, and every node now has a label (local always,
Groq optionally). README written. Next: step 9, the `graph-view/` list/search
view (the main v1 feature still missing), then the pre-publish checklist.

## What's working right now (all tested in Chrome unless marked)
- `lib/storage.js` (s1, **extended s4**): IndexedDB wrapper; page upsert,
  chunks as `Float32Array`. `deletePage(id)` now also removes the page id from
  every node in the same transaction, deletes nodes left empty (with their
  edges), and returns the ids of surviving nodes that lost the page.
- `content/extractor.js` + vendored `lib/readability.js` (s1, fixed s3):
  Readability used only if >= 200 chars AND >= 30% of `innerText` length,
  otherwise falls back to `innerText`.
- **Embeddings (s2):** `offscreen/offscreen.js` runs transformers.js with the
  quantized all-MiniLM-L6-v2 from local files, in an offscreen document.
  `lib/embeddings.js`: `chunkText`, `embedTexts`, `embedPage`, `cosine`,
  `closeOffscreen`. 384-dim, L2-normalized (cosine = dot).
- **Clustering (s3, extended s4):** `lib/clustering.js`. Page = mean of chunk
  vectors; `assign` at `THRESHOLD` 0.50, then `mergeNodes` at `MERGE_THRESHOLD`
  0.52. New in s4: `removePage(pageId)`, `pruneNodes()`, `rankPages(node)`;
  `clusterNewPages()` now calls `pruneNodes()` first.
- **Summarizer (s4, NEW):** `lib/summarizer.js`. Local label always (title of
  the node's most central page). Optional Groq naming for groups of 2+ pages
  only, model `openai/gpt-oss-20b`, batches of 5 groups, sends titles + first
  150 chars of up to 4 pages (links/emails/6+ digit numbers scrubbed, groups
  sent as 1..n). Only nodes whose page set changed (or multi-page nodes still
  carrying a local label after cloud was turned on) are (re)named. Runs as the
  last wrap-up stage ("naming") in its own try/catch, and on demand via the
  `SUMMARIZE` message ("Name groups now" button).
- **Wrap-up (s2, extended s3/s4):** extract -> save page -> chunk+embed ->
  `saveChunks` -> `clusterNewPages()` -> `summarizeNodes()`. Skips thin pages
  (< 300 chars), asleep/loading tabs, unchanged pages with chunks. Offscreen doc
  closed in `finally`. Clustering and naming errors are caught separately
  (`summary.clusterError`, `summary.nameError`).
- **Status via storage (s3):** progress/result in `chrome.storage.local` key
  `wrapUpStatus`; popup never waits on the reply. `running` flag blocks a
  second wrap-up (also blocks `SUMMARIZE`).
- `popup/` (s4 updated): wrap-up button + live status; **Groups list** (label,
  page count, ", Groq" tag, hover = summary); **Group names** section (Groq
  toggle, key field, privacy text, "Name groups now"); saved-pages list;
  "Clear all (dev)" (keeps settings).
- **Manifest (s4 CHANGED):** `https://api.groq.com/*` added to
  `optional_host_permissions` (requested at runtime when the toggle is ticked);
  description rewritten ("Groups your open tabs by topic, on your device.
  Optional AI naming sends only short, anonymized snippets.").
- **README.md (s4, NEW)** written and ready to commit (privacy section, tech
  highlights, setup, roadmap, credits).
- Build tooling (s2): `npm run build`, `npm run download-model`; Node on D:,
  npm cache on `D:\npm-cache`.
- GitHub repo: https://github.com/rishav1729/Smriti (reference only; Claude
  cannot read its file contents).

## Test results this session (s4)
- `pruneNodes()` → `{updated: 0, removed: 0}` (no stale ids existed).
- `removePage(id)` on a singleton page → `{nodesUpdated: 0}`, group list fine
  (this exercised the "node deleted because empty" path).
- **NOT YET VERIFIED:** `removePage` on a page from a multi-page group (the
  path that recomputes the surviving node's centroid). Test snippet for the
  service worker console:
  ```js
  const n = (await storage.getAllNodes()).find(n => n.pageIds.length > 1)
  const before = n.pageIds.length
  const r = await clustering.removePage(n.pageIds[n.pageIds.length - 1])
  const after = await storage.getNode(n.id)
  console.log(r, before, after.pageIds.length, after.centroidEmbedding.length)
  // pass = {nodesUpdated: 1}, N, N-1, 384  (deletes one page permanently)
  ```
- Groq naming end to end: **"Named 0 groups locally, 3 with Groq."** on 13
  groups / 25 saved pages. Groups named: "Indian exam prep" (10 pages),
  "Vertex AI Agent Builder" (3), "Claude AI usage" (2). The 10 singleton groups
  keep their page title as label (by design). Model `llama-3.1-8b-instant` was
  not in the user's Groq dashboard model list; switched to `openai/gpt-oss-20b`
  (list showed gpt-oss-120b, gpt-oss-20b, qwen/qwen3.8-27b).

## Measured results (s3) — the data behind the thresholds
- 35-page then 46-page sample of real browsing (exam prep, Kore.ai/LangChain,
  web3 security, data engineering, random outliers).
- **Page-level vs chunk-level:** page-level (mean vector) wins. Max-chunk
  similarity gave random false matches (e.g. ChatGPT x an Idioms YouTube video
  0.649) because one generic chunk matches anything.
- **Page-to-page scores:** >= 0.60 almost always same topic; 0.45–0.55 is a
  mixed zone with no clean gap; < 0.45 mostly unrelated.
- **Assignment threshold sweep (46 pages):**
  | threshold | groups | alone | wrong merges |
  |---|---|---|---|
  | 0.55 | 34 | 28 | none |
  | 0.50 | 30 | 24 | none  <- chosen |
  | 0.45 | 24 | 18 | yes (Pressure Washer + DataDriven in exam group; weak Data Science x Solidity pair) |
- **Merge threshold:** group pairs that should merge scored 0.553–0.602; the
  next pair down was 0.493, then unrelated pairs <= 0.487. -> 0.52.
- Result at 0.50 / 0.52 on 46 pages: exam-prep group of 14, Kore.ai/LangChain/AI
  group of 6, two web3 pairs, 22 singletons, no wrong merges.
- Decision on model size: no bigger model needed. Remaining misses come from
  short/low-text pages, not model quality.

## What's broken / known issues
- **Changed pages are not re-grouped.** A re-embedded page stays in its old
  node (and its node's summaryKey does not change, so the label is not
  refreshed). `reclusterAll()` fixes it manually. Note: `reclusterAll()` also
  throws away all labels; run "Name groups now" afterwards (cloud labels are
  re-requested, using Groq quota).
- **Nothing in the UI calls `removePage` yet.** The cleanup exists and is wired
  into storage, but there is no delete button; do it before/with the search
  view if users should be able to remove pages.
- **Singleton labels are raw page titles**, some noisy ("command line - What is
  the equivalent fo…", bare "YouTube"). The search view must cope (show URL/site
  name next to it).
- **Web3 pages split** (Cyfrin/Shieldify pair, Web3 certification pair, and
  Cyfrin Login / remix / Solidity cheat sheet alone). Short pages have little
  text. DEFERRED experiment: title-in-embedding (see "Deferred").
- On small sets (14 pages) some related pages stay alone. More pages may fix it.
- Kore.ai release notes: 88k chars, capped at 60 chunks, ~80% never embedded.
- Google Search pages, tiny pages (Speedtest, Groq console, Inshorts, "Thank
  you" pages) and YouTube feed/home pages add noise; blocklist or higher
  minimum undecided.
- Titles: IIT Kanpur page has title `""`; display helpers (and the summarizer)
  fall back to the URL hostname. Readability strips site-name suffixes.
- `readabilityChars` / `bodyChars` diagnostics are returned by the extractor
  but not saved.
- Transient "Receiving end does not exist" embed error happened once (model
  still starting up); the page is retried at the next wrap-up.
- If the service worker is killed mid-run, `wrapUpStatus` stays `running`; the
  popup treats it as interrupted after 3 minutes.
- One run said "Saved 8" but listed 7 pages (probably duplicate URLs; low
  priority).
- Groq model names change over time; if naming returns "Groq request failed
  (400/404)", check the model list in the Groq console and edit `GROQ_MODEL`
  in `lib/summarizer.js`.
- Groq free-tier 429s: naming stops for that run, local labels stay, next run
  retries.
- Generated files are gitignored, so a fresh clone needs `npm install`,
  `npm run download-model`, `npm run build`.

## PRE-PUBLISH CHECKLIST (do NOT forget before making the repo public / publishing)
1. Remove the four dev hooks in `background/service-worker.js`
   (`globalThis.embeddings/.storage/.clustering/.summarizer` and the
   `// DEV ONLY` comment).
2. Remove the "Clear all (dev)" button from `popup/popup.html` and its handler
   in `popup/popup.js` (or move it behind a confirm in a settings area).
3. README: add one line that the Groq key is stored unencrypted in
   `chrome.storage.local` on the user's device (revocable in the Groq console).
4. README: pick and add a license (currently "License to be decided"), and add
   a screenshot/GIF at the commented spot near the top.
5. Test the README setup steps from a fresh clone
   (`npm install`, `npm run download-model`, `npm run build`, load unpacked).
6. Re-check manifest description length (<= 132 chars) and replace placeholder
   icons.
7. Re-read the privacy claims in README, manifest and popup against what the
   code actually sends (only titles + 150-char scrubbed excerpts of up to 4
   pages per multi-page group, only when the toggle is on).

## Files touched this session
- New: `lib/summarizer.js`, `README.md`
- Edited: `lib/storage.js` (deletePage cleans nodes), `lib/clustering.js`
  (removePage, pruneNodes, rankPages, refreshCentroid helper, prune in
  clusterNewPages), `background/service-worker.js` (naming stage, SUMMARIZE
  message, summarizer dev hook), `popup/popup.html`, `popup/popup.css`,
  `popup/popup.js` (groups list, Groq settings, Name groups now),
  `manifest.json` (Groq optional host permission, new description)
- Docs: `ARCHITECTURE.md`, `PROJECT_STATE.md`
- Not touched: `lib/embeddings.js`, `offscreen/*`, `content/extractor.js`,
  `lib/readability.js`

## Decisions made this session
- Page-level cleanup is atomic in storage (membership removal, empty-node
  deletion); vector math (centroid refresh) stays in clustering, so storage
  keeps no ML logic.
- `clusterNewPages()` prunes stale ids first (self-healing).
- Local label is always produced; Groq naming is strictly opt-in, default off.
- Only groups of 2+ pages are ever sent to Groq; singletons keep their title.
- What leaves the machine: titles (100 chars) + 150-char excerpts of up to 4
  pages per group, scrubbed (links, emails, 6+ digit numbers), groups numbered
  1..n; no URLs, no full text, no database ids.
- Re-naming is driven by `node.summaryKey` (sorted pageIds) and
  `node.labelSource` ('local' | 'cloud').
- Page text is untrusted model input: output is validated/trimmed and shown
  only via `textContent`.
- Groq key stored in `chrome.storage.local` (plaintext, extension-only);
  documented in README.
- Model: `openai/gpt-oss-20b` (a constant, easy to change).
- Title-in-embedding experiment DEFERRED to the next version (see below).

## Deferred (do not lose)
- **Title-in-embedding experiment** (decided s4: leave for the next version).
  Idea: prepend the page title to the text passed to `embedPage` to help short
  pages (web3 split, small-set singletons). How to test: change the embedded
  text, run `reclusterAll()` + `showClusters()`, keep only if groups improve
  without wrong merges. Needs `lib/embeddings.js` and `service-worker.js`.

## Next immediate step (session 5)
1. **Build `graph-view/` (graph.html / graph.js / graph.css): list/search view
   over nodes.** Opens as a tab (`chrome.tabs.create({ url:
   chrome.runtime.getURL('graph-view/graph.html') })`) from a button in the
   popup. Minimum: group list with labels, page counts, expandable page lists
   (title, site, link), and a search box.
2. **Semantic search design to settle first:** the query must be embedded with
   MiniLM, which only runs in the offscreen document. Plan: the search page
   sends a message to the service worker (e.g. `SEARCH`/`EMBED_QUERY`), which
   embeds via `embeddings.embedTexts([query])`, ranks, and replies; close the
   offscreen doc afterwards. Expect a few seconds of model start-up on the first
   search. Decide: rank by page vector (consistent with clustering) vs best
   chunk (better snippets, but chunk-level gave false matches in clustering);
   suggested: rank pages by page vector, then show the best-matching chunk as
   the snippet; also a plain keyword match on titles as a fast fallback.
3. Optional small additions with it: a delete-page button wired to
   `clustering.removePage`, and showing site name/URL next to noisy singleton
   labels.
4. Then: verify the untested `removePage` multi-page path (snippet above),
   work through the PRE-PUBLISH CHECKLIST, commit.
5. Later (v2): title-in-embedding, blocklist, re-grouping changed pages, long
   page cap, stretch goals in ARCHITECTURE.md.

## Files to paste next session
Paste only the files about to be edited. For step 1–3 above:
`background/service-worker.js`, `lib/embeddings.js`, `lib/storage.js`,
`lib/clustering.js` (for ranking helpers), `popup/popup.html` and
`popup/popup.js` (for the "open search" button). Do NOT paste
`lib/summarizer.js` unless changing it.

## Open questions / blockers
- Blocklist for low-value sites (Google Search, YouTube feed, tiny pages)?
- Should changed/re-embedded pages be re-assigned automatically (and their
  node relabeled)?
- Search ranking: page-level vs chunk-level snippets (see above).
- Which license for the repo.
- README credits are done (transformers.js, onnxruntime-web, all-MiniLM-L6-v2,
  Readability).
- Interview-worthy so far: on-demand injection with runtime-granted host
  permissions (privacy design), transactional chunk replacement in storage,
  Readability on a cloned DOM with fallback; s2: on-device WASM embeddings under
  MV3 lifecycle limits (offscreen doc, creation lock, ready-retry), locally
  bundled model with CDN WASM path overridden, normalized vectors so similarity
  is a dot product, idempotent wrap-up; s3: gating Readability against an
  independent `innerText` baseline, choosing page-level matching and two
  thresholds from measured score distributions, merge pass for centroid
  dilution, wrap-up status in `chrome.storage.local` because MV3 popups die on
  focus loss; **s4:** privacy-minimizing optional cloud step (local-first
  fallback, data minimization, scrubbing, anonymized group ids, runtime-granted
  permission), treating page text as untrusted input to an LLM (validated
  output, textContent only), change-detection keys so re-naming costs nothing,
  atomic node cleanup in storage with vector math kept in clustering. Routine:
  popup UI, settings form, batching loop, icons, IndexedDB CRUD, the chunker,
  npm scripts, manifest edits.

---

## Full current file contents

No source files are pasted here. Paste from VS Code only the files we are about
to edit. Replace the Project knowledge base copies of `ARCHITECTURE.md`,
`PROJECT_STATE.md` **and `manifest.json` (it changed this session)** with the
updated versions. Commit `README.md` to the repo.