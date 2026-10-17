# Smriti — Session Handoff

> HOW TO USE THIS FILE:
> 1. Update this file at the end of every work session (or ask Claude to
>    "update the handoff doc" before closing the chat).
> 2. When you start a NEW chat, paste this whole file as your first message,
>    plus the current content of any files listed under "Files to paste next
>    session."
> 3. Claude has zero memory of past chats. This file + the actual code files are
>    the only continuity between sessions. Treat it as the source of truth.

---

## Last updated
`2026-10-17 — end of session 7`

## Current phase
Bottom-up build, steps 1–11 done. v1 feature scope is complete and the
pre-publish checklist was finished in s6 (only an optional README screenshot/GIF
remains). **s7 added the low-value page filter**, ran and closed the
title-in-embedding experiment (no benefit, reverted), and parked the tab read
timeouts. **Decision: GitHub-only for now** (no Chrome Web Store work).
Next: small polish items (see "Next immediate step").

## What's working right now (all tested in Chrome unless marked)
- `lib/storage.js` (s1, extended s4): IndexedDB wrapper; page upsert, chunks as
  `Float32Array`. `deletePage(id)` also removes the page id from every node in
  the same transaction, deletes nodes left empty (with their edges), returns the
  ids of surviving nodes that lost the page. `clearAll()` used by `CLEAR_ALL`.
  Not changed in s7.
- `content/extractor.js` + vendored `lib/readability.js` (s1, fixed s3):
  Readability used only if >= 200 chars AND >= 30% of `innerText` length,
  otherwise falls back to `innerText`. Not changed in s7.
- **Embeddings (s2, extended s5):** `offscreen/offscreen.js` runs
  transformers.js with the quantized all-MiniLM-L6-v2 from local files, in an
  offscreen document. `lib/embeddings.js`: `chunkText`, `embedTexts`,
  `embedPage`, `cosine`, `closeOffscreen`. 384-dim, L2-normalized. One queue,
  120 s timeout per batch. Not changed in s7.
- **Clustering (s3, extended s4):** `lib/clustering.js`. Page = mean of chunk
  vectors; `assign` at `THRESHOLD` 0.50, then `mergeNodes` at `MERGE_THRESHOLD`
  0.52. `removePage`, `pruneNodes`, `rankPages`; `clusterNewPages()` prunes
  first. Not changed in s7.
- **Summarizer (s4):** `lib/summarizer.js`. Local label always. Optional Groq
  naming for groups of 2+ pages only, model `openai/gpt-oss-20b`, batches of 5,
  titles + first 150 chars of up to 4 pages (scrubbed, groups sent as 1..n).
  Not changed in s7.
- **Search (s5):** `lib/search.js` `searchPages(query)`: page-vector ranking,
  best chunk only as snippet, `MIN_SCORE = 0.25`, `MAX_RESULTS = 25`.
- **Search/list view (s5):** `graph-view/graph.html/js/css`. Keyword matches
  while typing, semantic search on Enter, results grouped by node, Delete per
  page. Reads IndexedDB directly; embedding and writes go through the worker.
- **Wrap-up (s2, extended s3–s5, s7):** extract -> save page -> chunk+embed ->
  `saveChunks` -> `clusterNewPages()` -> **`dropLoneSearchPages()` (s7)** ->
  `summarizeNodes()`. Time limits: tab reading 30 s, grouping 60 s, search-page
  cleanup 30 s (same try/catch as grouping), naming 180 s.
- **Low-value page filter (s7, NEW, in `background/service-worker.js`):**
  - `isLowValueUrl(url)`: YouTube home (`/`), `/feed/*` and `/results` are
    skipped BEFORE reading (counted in `skipped`; no content touched). Watch
    pages (`/watch`) are still saved. Hosts `youtube.com`, `www.`, `m.`.
  - `isSearchUrl(url)`: Google (`google.<tld>/search`), Bing (`/search`),
    DuckDuckGo (`?q=`). These pages ARE read, saved and embedded.
  - `dropLoneSearchPages()`: after grouping, deletes (via
    `clustering.removePage`) every search page whose node contains NO
    non-search page. A search page that joined a group with a real page stays.
    Count goes to `summary.droppedSearch` (stored status only; the popup does
    not display it yet). It covers ALL saved search pages, not only new ones,
    so old lone search pages are cleaned at the next wrap-up.
  - Rationale: a search can be research context, so it is kept when related to
    other pages; relatedness is only known after embedding + grouping.
  - Tested s7: lone search page and YouTube home removed; a related search page
    stayed inside its group.
- **Shared offscreen doc (s5):** reference-counted by wrap-up and search; 20 s
  warm window after a search; orphan closed on worker start.
- **Service worker messages:** `WRAP_UP`, `SUMMARIZE` (guarded by `running`),
  `SEARCH` (unguarded), `DELETE_PAGE` (guarded), `CLEAR_ALL` (guarded).
- **"Delete all my data" (s6):** popup button; `confirm()` -> `CLEAR_ALL` ->
  `storage.clearAll()` + removes `wrapUpStatus`. Groq toggle and key are kept.
- **Status via storage (s3):** progress/result in `chrome.storage.local` key
  `wrapUpStatus`.
- README.md (rewritten s6), LICENSE (MIT), icons (s6). **README does not yet
  mention the s7 filter or the Groq rate limit.**
- **Manifest:** unchanged in s7 (description 105 chars, limit 132).
- Build tooling (s2): `npm run build`, `npm run download-model`.
- GitHub repo: https://github.com/rishav1729/Smriti (public; Claude cannot read
  its file contents).
- **Git (s7):** the filter is committed and pushed as `bd0197c` ("Skip YouTube
  home/feed pages; drop lone search-result pages after grouping"). The s6 and s7
  versions of this file and `ARCHITECTURE.md` were NOT committed before; commit
  them together (see Next immediate step).

## Test results this session (s7)
- **Tab read timeouts:** the user brought a previously timed-out tab to the
  front and wrap-up saved it; a second run with the tab left in the background
  ALSO saved it (Saved 10, no failures). So the Chrome-frozen-tab theory was NOT
  confirmed. The user's theory: a weak internet connection at the time left the
  heavy single-page apps (ChatGPT, NotebookLM, Claude chat) half-loaded while
  `status=complete`. Plausible, unproven, not reproducible. **PARKED**, no code
  change; if "timed out" appears again, note connection quality and how long the
  tab was in the background.
- **Low-value filter:** passed (see above). Final real-data run: 14 readable
  tabs read, 11 pages kept in 6 groups; the 3 missing pages were most likely
  lone search pages dropped (inferred from the count, `droppedSearch` was not
  inspected).
- **Title-in-embedding A/B (closed):** variant = prepend the page title (first
  150 chars) as its own paragraph before the body text passed to `embedPage`.
  Baseline (old data, 28 pages, 7 groups) had a 19-page exam-prep group with
  about 8 off-topic pages (a TV drama video, a streaming site twice, a chat
  titled like a job plan, a data-science cohort page, a data-engineer practice
  site, an AI chat page, an analytics tracker). That data could not be
  reproduced because "Delete all my data" loses pages from closed tabs, so the
  A/B used the 11 pages still open. With title and without title (title set to
  `''`, same tabs, fresh wipe each time): IDENTICAL groups (5 exam-ish pages,
  2 comic sites, 4 alone, 6 groups). Only Groq's group names differed. **Result:
  no measurable benefit at this size; reverted** (the embed line is back to
  `embeddings.embedPage(content)`; `pageTitle` leftovers were removed).
  Weakness: 11 pages cannot reproduce the original big-group problem. Re-test
  only with a larger set (30+ pages) if group quality becomes a concern again.
- **Gotchas learned (s7):**
  - "Delete all my data" really wipes saved pages; pages from tabs closed since
    the last wrap-up are gone for good. Wrap-up reads every tab in every window.
  - Saved pages persist after their tabs are closed; the popup count can exceed
    the number of open tabs.
  - "Unchanged: N" in the wrap-up summary means those pages were already stored
    (not re-embedded); use it to check a wipe really happened.
  - `chrome.storage` snippets fail on web-page consoles ("Cannot read
    properties of undefined (reading 'local')"); use the popup's or the search
    view's DevTools.
  - `git diff` opens a pager; press `q` to exit. The harmless
    "'credential-manager-core' is not a git command" line appears on push on
    this Windows setup; the push still succeeds.

## Test results (s6, kept)
- Public-repo audit clean (no `gsk_` in history; generated folders untracked;
  `.cursor/` ignored). Fresh-clone setup passed. Privacy check on real traffic:
  Groq off -> nothing external; on with 2+ page groups -> exactly one POST to
  `api.groq.com/openai/v1/chat/completions`. Singletons never go to Groq.
- Groq free tier observed: 8000 tokens/min, 1000 requests; one naming request
  about 1.2k tokens.

## Test results (s5, kept)
40 saved pages, 16 groups on real data. Keyword search instant; semantic cold a
few seconds, warm fast. Junk query -> 0 results; "how to prepare for govt exams"
style query -> 9–10 relevant pages at 25%–50%. Delete refused during a wrap-up.
A wrap-up hang was seen once (cause not pinned down); if it returns, run in the
worker console: `(await chrome.storage.local.get('wrapUpStatus')).wrapUpStatus`.

## Measured results (s3) — the data behind the thresholds
- Page-level (mean vector) beats max-chunk (one generic chunk caused false
  matches). Page-to-page scores: >= 0.60 same topic; 0.45–0.55 mixed; < 0.45
  mostly unrelated.
- Assignment sweep (46 pages): 0.55 -> 34 groups; **0.50 -> 30 groups, no wrong
  merges (chosen)**; 0.45 -> wrong merges. Merge pairs that should merge scored
  0.553–0.602; next pair down 0.493 -> `MERGE_THRESHOLD` 0.52.
- No bigger embedding model needed: remaining misses come from short pages.

## What's broken / known issues
- **Tab read timeouts (PARKED, s7):** a few heavy chat-app tabs once ended with
  "Reading the tab timed out after 30s [discarded=false, status=complete]".
  Not reproducible later; frozen-tab theory not confirmed; slow-internet theory
  plausible. No code change.
- **Search pages that stay open and unrelated** are re-read and re-embedded at
  every wrap-up, then dropped again (small cost, no data loss).
- **A search page whose related tabs are not open yet is dropped** (it gets
  another chance only if its tab is still open at a later wrap-up).
- **`droppedSearch` is not shown in the popup** (stored status only).
- **Groq free tier is 8000 tokens/min.** Many groups (5 per batch) could hit a
  429; the code stops remaining batches and keeps local labels. Candidate README
  limitation line.
- **"Delete all my data" keeps the Groq key (by design);** no "remove saved key"
  button yet.
- **Changed pages are not re-grouped** (`reclusterAll()` fixes it manually, then
  "Name groups now"; that re-uses Groq quota).
- **Labels drift:** a node is relabeled when its page set changes; Groq may
  phrase it differently.
- **Large mixed group:** in a big exam-prep group, off-topic low-text pages can
  end up inside. Title-in-embedding did not help on 11 pages (see s7); untested
  at 30+ pages.
- **Result rows show only the host**, so same-title, same-host pages look like
  duplicates. Planned small fix: show the URL path under each title.
- **Singleton labels in the popup Groups list are raw page titles** (some
  noisy). The search view lists singletons under "Other pages" with host/site.
- On small page sets, some related pages stay alone.
- A very long page (tens of thousands of chars) is capped at 60 chunks, so most
  of it is never embedded.
- Tiny pages and some low-text pages still add noise (YouTube home/feed and
  search pages are now handled by the s7 filter; other cases are not).
- Titles: a page can have title `""`; display helpers and the summarizer fall
  back to the URL hostname.
- `readabilityChars` / `bodyChars` diagnostics are not saved.
- **Stale `running` status** if the worker is killed or the extension reloaded
  mid-run (popup says "Working" until 3 minutes pass).
- **Timeouts do not cancel the underlying work.**
- **Search cost grows with the library** (loads all chunks per search); fine at
  personal scale.
- Delete/confirm use `confirm()`/`alert()` dialogs (inline UI is optional).
- One run said "Saved 8" but listed 7 pages (not reproduced).
- Transient "Receiving end does not exist" embed error once (model starting).
- Groq model names change over time; on "Groq request failed (400/404)" check
  the model list and edit `GROQ_MODEL` in `lib/summarizer.js`.
- Generated files are gitignored; a fresh clone needs `npm install`,
  `npm run download-model`, `npm run build` (verified s6).

## PRE-PUBLISH CHECKLIST (status, unchanged since s6)
All done except the OPTIONAL README screenshot/GIF (take it from a clean clone
with neutral tabs, not from real browsing). Re-check the README privacy section
if the summarizer or any `fetch` changes (decision 39).

## Files touched this session (s7)
- Edited: `background/service-worker.js` (low-value filter; committed as
  `bd0197c`). The title experiment's edits were fully reverted.
- Docs: `ARCHITECTURE.md`, `PROJECT_STATE.md` (uncommitted; include s6 + s7).
- Not touched: `lib/*`, `offscreen/*`, `content/extractor.js`, `graph-view/*`,
  `popup/*`, `manifest.json`, `README.md`, `LICENSE`.

## Decisions made this session
- **Search-result pages are saved, but kept only if they group with a real
  page** (not blanket-skipped): a search can be research context; relatedness
  is decided by the existing grouping threshold, so nothing new to tune.
- **YouTube home, `/feed/*`, `/results` and non-http(s) pages are skipped by URL
  before reading** (no content touched).
- **Title-in-embedding: tested and rejected** (identical groups on 11 pages);
  reverted. Only re-open with a 30+ page test set.
- **Tab read timeouts parked** without code (not reproducible).
- **GitHub-only for now;** Chrome Web Store, store listing and privacy policy
  are dropped from the next steps.
- **Docs are anonymized** (real page names and `D:\` paths replaced by generic
  wording) because the repo is public. Keep new examples generic.
- Working style (user preference): give ONE step at a time, and say exactly where
  each code edit goes (the line to find, and what to put after/instead).

## Deferred / ideas (do not lose)
- Re-test title-in-embedding on a larger set (30+ pages) only if needed.
- Re-grouping of changed pages; blocklist beyond YouTube/search; long-page chunk
  cap; the stretch goals in ARCHITECTURE.md.

## Next immediate step (session 8)
1. **Commit the docs:** `git add ARCHITECTURE.md PROJECT_STATE.md`, commit
   (suggested: "Update handoff docs for s6 and s7; anonymize page names"), push.
   Then replace the Project knowledge base copies of both files (`manifest.json`
   did not change).
2. **Small polish, in this order (one at a time):**
   a. URL path under each result title in the search view (`graph-view/graph.js`,
      maybe `graph.css`).
   b. "Remove saved Groq key" button (`popup/popup.html`, `popup/popup.js`).
   c. README lines: the Groq 8000 tokens/min limit, and the s7 filter behavior
      (YouTube home/feed skipped; lone search pages dropped).
   d. Optionally show `droppedSearch` in the popup summary (`popup/popup.js`).
3. **Optional:** README screenshot/GIF from a clean clone.
4. **v2 candidates:** more low-value rules; re-grouping changed pages; long-page
   chunk cap; then the stretch goals.

## Files to paste next session
Paste only the files about to be edited.
- Result-row polish: `graph-view/graph.js` (and `graph.css`).
- "Remove saved Groq key" / popup summary line: `popup/popup.html`,
  `popup/popup.js`.
- README lines: `README.md`.
Do NOT paste `lib/summarizer.js` unless changing it.

## Open questions / blockers
- None blocking. (Resolved s7: GitHub-only; anonymize docs = yes.)
- Interview-worthy so far: on-demand injection with runtime-granted host
  permissions (privacy design), transactional chunk replacement, Readability on
  a cloned DOM with fallback; s2: on-device WASM embeddings under MV3 lifecycle
  limits (offscreen document, creation lock, ready-retry), locally bundled model,
  normalized vectors so similarity is a dot product, idempotent wrap-up; s3:
  gating Readability against an `innerText` baseline, thresholds chosen from
  measured score distributions, merge pass for centroid dilution, status in
  `chrome.storage.local` because MV3 popups die on focus loss; s4: privacy-
  minimizing optional cloud step, treating page text as untrusted LLM input,
  change-detection keys, atomic node cleanup; s5: on-device semantic search,
  reference-counted shared model process, serialized inference plus timeouts,
  hybrid keyword + semantic ranking, a threshold validated on real queries; s6:
  verifying privacy claims against real network traffic, auditing a public
  repo's history for secrets, routing a destructive operation through a guarded
  worker, a fresh-clone test; **s7: deciding a filter design from the data flow
  (keep a search page only if it groups with others, reusing the existing
  threshold instead of a URL blocklist), a controlled A/B experiment that
  rejected a plausible-sounding change (title-in-embedding) and was reverted,
  and noticing that an experiment's test set could not reproduce the original
  problem.** Routine: popup UI, settings form, batching loop, icons, IndexedDB
  CRUD, the chunker, npm scripts, manifest edits, list/group UI and CSS, README
  edits.

---

## Full current file contents

No source files are pasted here. Paste from VS Code only the files we are about
to edit. Replace the Project knowledge base copies of `ARCHITECTURE.md` and
`PROJECT_STATE.md` with the updated versions.