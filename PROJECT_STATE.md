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
`2026-10-17 — end of session 8`

## Current phase
**v1 IS CLOSED (s8).** All v1 features, the pre-publish checklist, the README
(with screenshots) and the last polish items are done and pushed. **There is no
v1.1:** anything not done is on the v2 backlog below. Next: session 9 = plan v2
(pick the first v2 item, one at a time).

## What's working right now (all tested in Chrome unless marked)
- `lib/storage.js` (s1, extended s4): IndexedDB wrapper; page upsert, chunks as
  `Float32Array`. `deletePage(id)` also removes the page id from every node in
  the same transaction, deletes nodes left empty (with their edges), returns the
  ids of surviving nodes that lost the page. `clearAll()` used by `CLEAR_ALL`.
  Not changed in s8.
- `content/extractor.js` + vendored `lib/readability.js` (s1, fixed s3):
  Readability used only if >= 200 chars AND >= 30% of `innerText` length,
  otherwise falls back to `innerText`. Not changed in s8.
- **Embeddings (s2, extended s5):** `offscreen/offscreen.js` runs
  transformers.js with the quantized all-MiniLM-L6-v2 from local files, in an
  offscreen document. `lib/embeddings.js`: `chunkText`, `embedTexts`,
  `embedPage`, `cosine`, `closeOffscreen`. 384-dim, L2-normalized. One queue,
  120 s timeout per batch. Not changed in s8.
- **Clustering (s3, extended s4):** `lib/clustering.js`. Page = mean of chunk
  vectors; `assign` at `THRESHOLD` 0.50, then `mergeNodes` at `MERGE_THRESHOLD`
  0.52. `removePage`, `pruneNodes`, `rankPages`; `clusterNewPages()` prunes
  first. Not changed in s8.
- **Summarizer (s4):** `lib/summarizer.js`. Local label always. Optional Groq
  naming for groups of 2+ pages only, model `openai/gpt-oss-20b`, batches of 5,
  titles + first 150 chars of up to 4 pages (scrubbed, groups sent as 1..n).
  Not changed in s8.
- **Search (s5):** `lib/search.js` `searchPages(query)`: page-vector ranking,
  best chunk only as snippet, `MIN_SCORE = 0.25`, `MAX_RESULTS = 25`.
- **Wrap-up (s2, extended s3–s5, s7):** extract -> save page -> chunk+embed ->
  `saveChunks` -> `clusterNewPages()` -> `dropLoneSearchPages()` ->
  `summarizeNodes()`. Time limits: tab reading 30 s, grouping 60 s, search-page
  cleanup 30 s, naming 180 s.
- **Low-value page filter (s7, in `background/service-worker.js`):**
  `isLowValueUrl` (YouTube home, `/feed/*`, `/results` skipped before reading),
  `isSearchUrl` + `dropLoneSearchPages()` (Google/Bing/DuckDuckGo search pages
  deleted after grouping if their node has no non-search page). **Verified on
  real data in s8:** the popup showed "Dropped 3 search-result pages".
- **Search/list view (s5, extended s8):** `graph-view/graph.html/js/css`.
  Keyword matches while typing, semantic search on Enter, results grouped by
  node, Delete per page. **s8:** each row shows a muted one-line URL path
  (path + query, no host, nothing for homepages; full URL on hover) under the
  host line, so same-title pages can be told apart; and a site name that is just
  the host with `www.` is no longer repeated ("google.com", not
  "google.com · www.google.com"). Reads IndexedDB directly; embedding and writes
  go through the worker.
- **Popup (s3–s6, extended s8):** wrap-up button, live status, Groups list,
  saved pages, Groq opt-in, "Delete all my data". **s8:** the summary shows
  "Dropped N search-result page(s) (not related to other pages)." when N > 0;
  new **"Remove saved Groq key"** button (`#removekey`): confirm, then clears
  `groqKey` AND sets `cloudSummaries=false`, unticks the toggle, resets the
  placeholder to "Groq API key"; if no key is saved it says so. The
  `api.groq.com` permission stays granted in Chrome (harmless: the code never
  calls Groq when the toggle is off). The "Your data" hint now points to the
  button.
- **Shared offscreen doc (s5):** reference-counted by wrap-up and search; 20 s
  warm window after a search; orphan closed on worker start.
- **Service worker messages:** `WRAP_UP`, `SUMMARIZE` (guarded by `running`),
  `SEARCH` (unguarded), `DELETE_PAGE` (guarded), `CLEAR_ALL` (guarded).
- **"Delete all my data" (s6):** `confirm()` -> `CLEAR_ALL` -> `storage.clearAll()`
  + removes `wrapUpStatus`. Groq toggle and key are kept (remove them with the
  s8 button).
- **README (rewritten s6, updated s8):** Known limitations now list the s7 filter
  behavior and the Groq 8,000 tokens/min limit; Roadmap has the filter checked
  and "More low-value page rules" open; "How it works" step 2 mentions skipped
  YouTube pages; Privacy mentions "Remove saved Groq key" and that "Delete all
  my data" keeps Groq settings; three screenshots (`docs/popup.png`,
  `docs/search.png`, `docs/search-query.png`) render on GitHub. The screenshots
  show real page titles from the owner's browsing; the owner judged them safe
  (public sites, no URLs/accounts/keys visible; the key field shows only the
  placeholder).
- **Manifest:** unchanged in s8 (description 105 chars, limit 132).
- Build tooling (s2): `npm run build`, `npm run download-model`.
- GitHub repo: https://github.com/rishav1729/Smriti (public; Claude cannot read
  its file contents).
- **Git (s8):** docs commit `0c2678e` ("Update handoff docs for s6 and s7;
  anonymize page names") pushed at the start of s8. All other s8 edits (README,
  popup, search view, screenshots) were committed and pushed by the owner in
  s8. **The s8 versions of this file and `ARCHITECTURE.md` still need the final
  commit** (see Next immediate step).

## Test results this session (s8)
- `droppedSearch` line: shown in the popup after a real wrap-up ("Dropped 3
  search-result pages"); also confirms the s7 filter on real data.
- "Remove saved Groq key": confirm dialog appeared; afterwards the toggle was
  unticked and the placeholder was "Groq API key". Second click says "No Groq
  key is saved." (not re-screenshotted). The button looks grey, not red like
  "Delete all my data" (cosmetic; `.danger` styling not investigated).
- URL path rows and the `www` host fix: confirmed in screenshots on real data
  (hover shows the full URL; long Google search URLs are cut with an ellipsis;
  `gemini.google.com · Gemini` and `claude.ai · Claude` still show real site
  names).
- README images render on GitHub.

## Test results (s7, kept)
- **Tab read timeouts:** a previously timed-out tab saved fine later, both when
  brought to the front and when left in the background, so the frozen-tab theory
  was NOT confirmed. Leading theory: a weak connection left heavy single-page
  apps half-loaded while `status=complete`. Not reproducible. **PARKED**; if
  "timed out" appears again, note connection quality and time in background.
- **Title-in-embedding A/B (closed):** prepending the page title gave IDENTICAL
  groups on 11 pages; reverted. Re-test only with 30+ pages if group quality
  becomes a concern.
- **Gotchas learned (s7):**
  - "Delete all my data" really wipes saved pages; pages from tabs closed since
    the last wrap-up are gone for good. Wrap-up reads every tab in every window.
  - Saved pages persist after their tabs are closed; the popup count can exceed
    the number of open tabs.
  - "Unchanged: N" in the wrap-up summary means those pages were already stored.
  - `chrome.storage` snippets fail on web-page consoles; use the popup's or the
    search view's DevTools.
  - `git diff` opens a pager; press `q`. The harmless "'credential-manager-core'
    is not a git command" line appears on push on this Windows setup.

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

## Known issues (carried into v2; none blocks v1)
- **Tab read timeouts (PARKED):** see s7 results. No code change.
- **Search pages that stay open and unrelated** are re-read and re-embedded at
  every wrap-up, then dropped again (small cost, no data loss).
- **A search page whose related tabs are not open yet is dropped.**
- **Groq free tier is 8000 tokens/min.** Many groups (5 per batch) could hit a
  429; the code stops remaining batches and keeps local labels (now in the
  README limitations).
- **Changed pages are not re-grouped** (`reclusterAll()` fixes it manually, then
  "Name groups now"; that re-uses Groq quota).
- **Labels drift:** a node is relabeled when its page set changes; Groq may
  phrase it differently.
- **Large mixed group:** in a big exam-prep group, off-topic low-text pages can
  end up inside. Untested fix at 30+ pages (title-in-embedding).
- **Singleton labels in the popup Groups list are raw page titles** (some
  noisy). The search view lists singletons under "Other pages".
- **Titles can carry notification counts**, e.g. YouTube "(1076) ..." (seen s8
  in the search view). Cosmetic; could be stripped for display and labels.
- On small page sets, some related pages stay alone.
- A very long page is capped at 60 chunks, so most of it is never embedded.
- Tiny pages and some low-text pages still add noise (YouTube home/feed and
  search pages are handled; other cases are not).
- Titles: a page can have title `""`; display helpers and the summarizer fall
  back to the URL hostname.
- `readabilityChars` / `bodyChars` diagnostics are not saved.
- **Stale `running` status** if the worker is killed or the extension reloaded
  mid-run (popup says "Working" until 3 minutes pass).
- **Timeouts do not cancel the underlying work.**
- **Search cost grows with the library** (loads all chunks per search); fine at
  personal scale.
- Delete/confirm use `confirm()`/`alert()` dialogs (inline UI is optional).
- "Remove saved Groq key" button is not styled red (cosmetic, unexplained).
- One run said "Saved 8" but listed 7 pages (not reproduced).
- Transient "Receiving end does not exist" embed error once (model starting).
- Groq model names change over time; on "Groq request failed (400/404)" check
  the model list and edit `GROQ_MODEL` in `lib/summarizer.js`.
- Generated files are gitignored; a fresh clone needs `npm install`,
  `npm run download-model`, `npm run build` (verified s6).

## PRE-PUBLISH CHECKLIST
All done, including the README screenshots (s8). Re-check the README privacy
section if the summarizer or any `fetch` changes (decision 39).

## Files touched this session (s8)
- Edited: `popup/popup.js`, `popup/popup.html`, `graph-view/graph.js`,
  `graph-view/graph.css`, `README.md`.
- Added: `docs/popup.png`, `docs/search.png`, `docs/search-query.png`.
- Docs: `ARCHITECTURE.md`, `PROJECT_STATE.md` (to commit, see below).
- Not touched: `lib/*`, `offscreen/*`, `content/extractor.js`,
  `background/service-worker.js`, `manifest.json`, `LICENSE`.

## Decisions made this session
- **v1 is closed; there is no v1.1.** Remaining ideas go to the v2 backlog.
- **"Remove saved Groq key" also turns cloud naming off**, because naming cannot
  work without a key. The host permission is left granted.
- **Result rows show URL path + query under the host line**, hash not shown
  (it is stripped before saving); full URL in the tooltip.
- **A site name that equals the host with `www.` is hidden** in result rows.
- **README screenshots may show real (public-site) page titles.** The owner's
  call; no URLs, accounts or keys appear. For future screenshots, neutral tabs
  are still preferred.
- Working style (user preference): give ONE step at a time, and say exactly where
  each code edit goes (the line to find, and what to put after/instead). Check
  the attached files before asking the user to redo something already done.

## v2 BACKLOG (nothing here is required; pick one at a time)
Quality of grouping:
- Re-group changed pages (and relabel their node).
- More low-value page rules (other feeds, tiny pages); strip notification-count
  prefixes like "(1076)" from titles.
- Re-test title-in-embedding on a set of 30+ pages.
- Long-page chunk cap (60 chunks).
UI/robustness:
- Inline delete confirmation instead of `confirm()` / `alert()`.
- Nicer labels for singleton groups in the popup.
- Stale `running` status handling; time-out cancellation.
- Style the "Remove saved Groq key" button as a danger button.
- Tab read timeouts, only if they recur (note connection and background time).
Features (from the stretch goals):
- Passive "related content" nudge on new page load (lookup only).
- Visual node-graph UI.
- Duplicate/stale tab detection.
- Actionability triage (read-later / reference / active-task).
- Capture tabs closed before wrap-up (tab-URL log or history).
- Opt-in "wake asleep tabs and retry" button.
- Chrome's on-device Gemini Nano used opportunistically (decision 2).
- Chrome Web Store listing and privacy policy (dropped for now, decision 41).

## Next immediate step (session 9)
1. **Commit the final s8 docs:**
   ```
   git status
   git add ARCHITECTURE.md PROJECT_STATE.md
   git commit -m "Close v1: update handoff docs for s8, start v2 backlog"
   git push
   ```
   Then replace the Project knowledge base copies of both files (`manifest.json`
   did not change).
2. **Plan v2:** choose the first item from the backlog with Claude. Suggested
   start: re-group changed pages (the biggest known quality gap), or the
   related-content nudge (the most visible new feature). Ask for the design
   first; this touches locked decisions only if the nudge makes any new network
   call (it should not: it is a local lookup).
3. Paste only the files about to be edited.

## Files to paste next session
- Depends on the chosen v2 item. Re-grouping: `lib/clustering.js` and
  `background/service-worker.js`. Nudge: ask Claude which files first.
- Do NOT paste `lib/summarizer.js` unless changing it.

## Open questions / blockers
- None blocking.
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
  worker, a fresh-clone test; s7: deciding a filter design from the data flow
  (keep a search page only if it groups with others, reusing the existing
  threshold instead of a URL blocklist), a controlled A/B experiment that
  rejected a plausible-sounding change and was reverted, noticing that the test
  set could not reproduce the original problem. **s8 was routine polish** (popup
  button, result-row path, README); the one small design point worth a sentence
  is that "remove key" also disables cloud naming so the UI can never be in a
  "on but no key" state. Routine: popup UI, settings form, batching loop, icons,
  IndexedDB CRUD, the chunker, npm scripts, manifest edits, list/group UI and
  CSS, README edits.

---

## Full current file contents

No source files are pasted here. Paste from VS Code only the files we are about
to edit. Replace the Project knowledge base copies of `ARCHITECTURE.md` and
`PROJECT_STATE.md` with the updated versions.