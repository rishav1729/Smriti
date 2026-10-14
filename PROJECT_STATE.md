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
`2026-10-13 — end of session 5`

## Current phase
Bottom-up build, steps 1–9 done and tested in Chrome: pages are extracted,
embedded, clustered into nodes, labeled (local always, Groq optionally), and
**now searchable and browsable in a full-page view, with a delete button**.
The v1 feature scope is complete. Next: the pre-publish checklist, commit,
then v2 polish (see "Next immediate step").

## What's working right now (all tested in Chrome unless marked)
- `lib/storage.js` (s1, extended s4): IndexedDB wrapper; page upsert, chunks as
  `Float32Array`. `deletePage(id)` also removes the page id from every node in
  the same transaction, deletes nodes left empty (with their edges), and
  returns the ids of surviving nodes that lost the page. **Not changed in s5.**
- `content/extractor.js` + vendored `lib/readability.js` (s1, fixed s3):
  Readability used only if >= 200 chars AND >= 30% of `innerText` length,
  otherwise falls back to `innerText`.
- **Embeddings (s2, extended s5):** `offscreen/offscreen.js` runs
  transformers.js with the quantized all-MiniLM-L6-v2 from local files, in an
  offscreen document. `lib/embeddings.js`: `chunkText`, `embedTexts`,
  `embedPage`, `cosine`, `closeOffscreen`. 384-dim, L2-normalized (cosine =
  dot). **s5:** all embed batches go through one queue (never two at once) and
  each batch has a 120 s timeout; on a timeout/failure the offscreen doc is
  closed so the next call starts a fresh model.
- **Clustering (s3, extended s4):** `lib/clustering.js`. Page = mean of chunk
  vectors; `assign` at `THRESHOLD` 0.50, then `mergeNodes` at `MERGE_THRESHOLD`
  0.52. `removePage(pageId)`, `pruneNodes()`, `rankPages(node)`;
  `clusterNewPages()` prunes first. **`removePage` multi-page path verified in
  s5.** Not changed in s5.
- **Summarizer (s4):** `lib/summarizer.js`. Local label always (title of the
  node's most central page). Optional Groq naming for groups of 2+ pages only,
  model `openai/gpt-oss-20b`, batches of 5, titles + first 150 chars of up to 4
  pages (links/emails/6+ digit numbers scrubbed, groups sent as 1..n). A node is
  (re)named when its page set changed (`summaryKey`) or it is multi-page and
  still has a local label after cloud was turned on. Not changed in s5.
- **Search (s5, NEW):** `lib/search.js` `searchPages(query)`. Embeds the query
  (offscreen doc), ranks **pages by page vector** (normalized mean of chunk
  vectors, same as clustering), uses the **best-matching chunk only as the
  snippet** (240 chars). `MIN_SCORE = 0.25`, `MAX_RESULTS = 25`. Returns
  `{pageId, score, snippet, nodeId, nodeLabel, url, title, siteName}`.
- **Search/list view (s5, NEW):** `graph-view/graph.html/js/css`, opened from
  the popup's "Search & browse" button (`chrome.tabs.create` with the extension
  URL; no extra permission). Reads IndexedDB directly (like the popup). Typing =
  instant keyword matches (every word in title, URL or site name). Enter =
  semantic search through the service worker (`SEARCH`), merged with keyword
  hits (+0.1 boost when both match; keyword-only hits are appended). Results are
  grouped under the node label when the node has 2+ pages, otherwise shown as
  plain rows; each row shows host, site name, "NN% match" and snippet. Default
  view: multi-page groups as expandable sections, all other pages in one
  "Other pages" section. Delete button per page (confirm dialog -> `DELETE_PAGE`;
  a refused delete shows an alert + status). Refreshes when a wrap-up finishes.
  Sticky header so the status line is always visible. Titles/labels/URLs/
  snippets rendered with `textContent`; links only for http(s).
- **Wrap-up (s2, extended s3/s4/s5):** extract -> save page -> chunk+embed ->
  `saveChunks` -> `clusterNewPages()` -> `summarizeNodes()`. Skips thin pages
  (< 300 chars), asleep/loading tabs, unchanged pages with chunks. **s5:** tab
  reading (30 s), grouping (60 s) and naming (180 s) have time limits so a stuck
  step becomes a readable error instead of a stuck `running` flag; each status
  update also logs `[smriti] <state> <stage> done/total` to the worker console.
- **Shared offscreen doc (s5, NEW):** wrap-up and search both use it, so it is
  reference-counted. Wrap-up closes it when it finishes unless a search is in
  flight; a search leaves it open 20 s for follow-up searches (warm model), then
  closes it. On worker start, any orphaned offscreen doc is closed once.
- **Service worker messages (s5):** `WRAP_UP`, `SUMMARIZE` (both guarded by
  `running`), `SEARCH` (allowed during wrap-up; not guarded), `DELETE_PAGE`
  (refused while `running`; sets `running` while it works).
- **Status via storage (s3):** progress/result in `chrome.storage.local` key
  `wrapUpStatus`; popup never waits on the reply.
- `popup/`: wrap-up button + live status; **"Search & browse" button (s5)**;
  Groups list; Group names section (Groq toggle, key, privacy text, "Name groups
  now"); saved-pages list; "Clear all (dev)".
- **Manifest:** unchanged in s5 (last change: s4, Groq optional host
  permission + description).
- **README.md (s4)** written; not changed in s5 (could mention search in the
  roadmap).
- Build tooling (s2): `npm run build`, `npm run download-model`; Node on D:,
  npm cache on `D:\npm-cache`. `offscreen.js` did not change in s5, so no
  rebuild was needed.
- GitHub repo: https://github.com/rishav1729/Smriti (reference only; Claude
  cannot read its file contents).

## Test results this session (s5)
All run in Chrome on the user's real data (40 saved pages, 16 groups).
- View opens from the popup; groups, "Other pages", host/site name: pass.
- Keyword search (instant, as you type): pass.
- Semantic search cold (a few seconds) and warm (fast): pass.
- Threshold: "banana bread" -> 0 results; "how to prepare for govt exams" ->
  9–10 results, all exam-prep pages, 25%–50% match. `MIN_SCORE = 0.25` kept.
- Search during a running wrap-up: pass (10 results returned while a wrap-up
  was running).
- `removePage` on a page from a 20-page group: pass (group 20 -> 19, all three
  multi-page centroids still 384-dim). The singleton path was verified in s4.
- Delete singleton from "Other pages": pass. Delete refused during a wrap-up
  (alert shown, page stays): pass after the alert was added and a clean re-run.
- **Wrap-up hang (found in testing):** the first run ended "interrupted" and the
  retry said "A wrap-up is already running." After the embed queue + timeouts,
  the next wrap-up completed (25 -> 40 saved pages). **Root cause not
  pinned down** (concurrent search/wrap-up embeds are the leading suspect;
  reloading the extension mid-wrap-up also leaves the popup saying "Working"
  for up to 3 min, which looks the same). If it comes back, run in the worker
  console: `(await chrome.storage.local.get('wrapUpStatus')).wrapUpStatus` and
  read the `[smriti]` log lines.
- Gotcha for console tests: a service worker cannot message itself. Run
  `chrome.runtime.sendMessage(...)` tests from the **view tab's** DevTools, not
  the service worker console.

## Test results (s4, kept)
- `pruneNodes()` -> `{updated: 0, removed: 0}`.
- Groq naming end to end: "Named 0 groups locally, 3 with Groq." on 13 groups /
  25 saved pages ("Indian exam prep" 10, "Vertex AI Agent Builder" 3, "Claude AI
  usage" 2). Model `llama-3.1-8b-instant` was not in the user's Groq list;
  switched to `openai/gpt-oss-20b`.

## Measured results (s3) — the data behind the thresholds
- 35-page then 46-page sample of real browsing (exam prep, Kore.ai/LangChain,
  web3 security, data engineering, random outliers).
- **Page-level vs chunk-level:** page-level (mean vector) wins. Max-chunk
  similarity gave random false matches (e.g. ChatGPT x an Idioms YouTube video
  0.649) because one generic chunk matches anything. (This is why s5 ranks by
  page vector and uses chunks only for the snippet.)
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
  node (and its node's `summaryKey` does not change, so the label is not
  refreshed). `reclusterAll()` fixes it manually (it also throws away all
  labels; run "Name groups now" afterwards, which re-requests cloud labels and
  uses Groq quota).
- **Labels drift.** A node is relabeled whenever its page set changes (including
  after a delete), and Groq may phrase it differently ("Exam prep & cooking" ->
  "Geography Exam Prep" for the same 20-page group). The label is refreshed at
  the next wrap-up or "Name groups now", not at delete time.
- **Large mixed group.** The 20-page exam-prep group contains off-topic pages
  (a YouTube cooking video, "Recordings - OneDrive", bare "YouTube"). Low-text
  pages and YouTube pages merge loosely. Related to the deferred
  title-in-embedding experiment and the low-value-site blocklist.
- **Result rows show only the host**, so two pages with the same title and host
  look like duplicates (the user checked the BSSC pair: not real duplicates).
  Planned small fix: show the URL path under each title.
- **Singleton labels in the popup Groups list are still raw page titles** (some
  noisy: "command line - What is the equivalent fo…", bare "YouTube"). The search
  view avoids this by listing singletons under "Other pages" with host/site.
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
- **Stale `running` status.** If the worker is killed (or the extension is
  reloaded) mid-run, `wrapUpStatus` stays `running`; the popup says "Working"
  until 3 minutes pass, then "interrupted". The s5 timeouts reduce stuck runs
  but do not remove this.
- **Timeouts do not cancel the underlying work.** A timed-out grouping/naming
  step is reported as an error, but the operation may still finish in the
  background.
- **Search cost grows with the library.** Each search loads all chunks with
  embeddings and loops over them; fine at personal scale (hundreds of pages),
  revisit if it gets slow. The view also loads full page records
  (`getAllPages`) and keeps only light fields.
- Delete/confirm use browser `confirm()`/`alert()` dialogs (works; a nicer inline
  UI is optional polish).
- One run said "Saved 8" but listed 7 pages (not reproduced; low priority).
- Transient "Receiving end does not exist" embed error happened once (model
  still starting up); the page is retried at the next wrap-up.
- Groq model names change over time; if naming returns "Groq request failed
  (400/404)", check the model list in the Groq console and edit `GROQ_MODEL`
  in `lib/summarizer.js`. Free-tier 429s stop naming for that run.
- Generated files are gitignored, so a fresh clone needs `npm install`,
  `npm run download-model`, `npm run build`.

## PRE-PUBLISH CHECKLIST (do NOT forget before making the repo public / publishing)
1. Remove the four dev hooks in `background/service-worker.js`
   (`globalThis.embeddings/.storage/.clustering/.summarizer` and the
   `// DEV ONLY` comment).
2. Remove the "Clear all (dev)" button from `popup/popup.html` and its handler
   in `popup/popup.js` (or move it behind a confirm in a settings area).
3. **(s5)** Remove or quiet the `console.log('[smriti]', ...)` line in
   `setStatus` in `background/service-worker.js` (it logs stage names only,
   no page content, but it is debug output).
4. README: add one line that the Groq key is stored unencrypted in
   `chrome.storage.local` on the user's device (revocable in the Groq console).
5. README: pick and add a license (currently "License to be decided"), add a
   screenshot/GIF at the commented spot near the top, and mention the search view.
6. Test the README setup steps from a fresh clone
   (`npm install`, `npm run download-model`, `npm run build`, load unpacked).
7. Re-check manifest description length (<= 132 chars) and replace placeholder
   icons.
8. Re-read the privacy claims in README, manifest and popup against what the
   code actually sends. (s5: search is fully local; the query is embedded on the
   device and nothing new leaves the machine.)

## Files touched this session (s5)
- New: `lib/search.js`, `graph-view/graph.html`, `graph-view/graph.js`,
  `graph-view/graph.css`
- Edited: `background/service-worker.js` (SEARCH + DELETE_PAGE handlers,
  offscreen refcount + startup cleanup, timeouts, status log line),
  `lib/embeddings.js` (embed queue + 120 s timeout; the rest unchanged),
  `popup/popup.html` ("Search & browse" button), `popup/popup.js` (its handler)
- Docs: `ARCHITECTURE.md`, `PROJECT_STATE.md`
- Not touched: `lib/storage.js`, `lib/clustering.js`, `lib/summarizer.js`,
  `offscreen/*`, `content/extractor.js`, `lib/readability.js`, `manifest.json`,
  `popup/popup.css`, `README.md`

## Decisions made this session
- **Search ranking:** rank pages by page vector; best-matching chunk is only the
  display snippet (chunk-level ranking gave false matches in s3).
- **Hybrid results:** instant keyword matching on title/URL/site while typing;
  semantic search on Enter; keyword hits get +0.1 (`KEYWORD_BOOST`) and
  keyword-only hits are appended after the semantic ones.
- **`MIN_SCORE = 0.25`** validated on real queries (junk query -> nothing; real
  query -> only relevant pages).
- **Shared offscreen document is reference-counted** (wrap-up + search), with a
  20 s warm window after a search and an orphan cleanup on worker start.
- **One embed at a time + timeouts:** an embed queue in `lib/embeddings.js`, a
  120 s per-batch timeout that resets the offscreen doc, and time limits on tab
  reads, grouping and naming so `running` can never stay set because of a hang.
- **Search is not guarded by `running`; delete is.** A search only reads; a
  delete writes nodes/centroids and must not interleave with wrap-up writes.
- **The view reads IndexedDB directly, but embedding and all writes go through
  the service worker** (it owns the offscreen doc and the `running` guard).
- **Singletons are listed under "Other pages"** in the default view instead of
  as one group per page (their "label" is just the title).

## Deferred (do not lose)
- **Title-in-embedding experiment** (decided s4: leave for the next version).
  Idea: prepend the page title to the text passed to `embedPage` to help short
  pages (web3 split, small-set singletons, the loose YouTube pages in the big
  exam group). How to test: change the embedded text, run `reclusterAll()` +
  `showClusters()`, keep only if groups improve without wrong merges. Needs
  `lib/embeddings.js` and `service-worker.js`.

## Next immediate step (session 6)
1. **Commit session 5** (message drafted at the end of this session) and
   **replace the copies in the Project knowledge base** (`ARCHITECTURE.md`,
   `PROJECT_STATE.md`; `manifest.json` did not change).
2. **Work through the PRE-PUBLISH CHECKLIST** above (dev hooks, "Clear all
   (dev)", the `[smriti]` log line, README lines, fresh-clone test, icons).
3. **Small polish, optional:** show the URL path under each result title;
   inline delete confirmation instead of `confirm()`/`alert()`.
4. **v2 candidates, in rough order of value:** blocklist/minimum length for
   low-value pages (YouTube feed, Google Search, tiny pages); title-in-embedding
   experiment; re-grouping changed pages (and relabeling their node); long-page
   chunk cap; then the stretch goals in ARCHITECTURE.md.

## Files to paste next session
Paste only the files about to be edited.
- Pre-publish checklist: `background/service-worker.js`, `popup/popup.html`,
  `popup/popup.js`, `README.md`.
- Result-row polish: `graph-view/graph.js` (and `graph.css` if styling changes).
- Blocklist / title-in-embedding: `lib/embeddings.js`,
  `background/service-worker.js`, `lib/clustering.js`.
Do NOT paste `lib/summarizer.js` unless changing it.

## Open questions / blockers
- Blocklist for low-value sites (Google Search, YouTube feed, tiny pages)?
- Should changed/re-embedded pages be re-assigned automatically (and their
  node relabeled)?
- What caused the first s5 wrap-up hang (see test results)? Re-check if it
  recurs.
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
  focus loss; s4: privacy-minimizing optional cloud step (local-first
  fallback, data minimization, scrubbing, anonymized group ids, runtime-granted
  permission), treating page text as untrusted input to an LLM (validated
  output, textContent only), change-detection keys so re-naming costs nothing,
  atomic node cleanup in storage with vector math kept in clustering;
  **s5:** on-device semantic search (query embedded through the offscreen
  document under MV3 limits), a reference-counted shared model process with a
  warm window and orphan cleanup, serialized inference plus timeouts so one hang
  cannot wedge the extension, hybrid keyword + semantic ranking with chunks used
  only for snippets (a decision backed by the s3 measurements), a threshold
  validated on real queries. Routine: popup UI, settings form, batching loop,
  icons, IndexedDB CRUD, the chunker, npm scripts, manifest edits, the list/
  group UI and CSS, the delete button.

---

## Full current file contents

No source files are pasted here. Paste from VS Code only the files we are about
to edit. Replace the Project knowledge base copies of `ARCHITECTURE.md` and
`PROJECT_STATE.md` with the updated versions (`manifest.json` is unchanged this
session). Commit `README.md` changes when made.