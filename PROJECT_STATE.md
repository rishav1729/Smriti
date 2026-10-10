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
`2026-10-09 — end of session 3`

## Current phase
Bottom-up build, steps 1–7 done and tested in Chrome (clustering is wired into
wrap-up, popup shows full results). Next: step 8, `lib/summarizer.js` (Groq
labels/summaries for groups), then the list/search view in `graph-view/`.

## What's working right now (all tested in Chrome)
- `lib/storage.js` (s1): IndexedDB wrapper; page upsert, chunks as
  `Float32Array`, `deletePage` removes page and chunks.
- `content/extractor.js` + vendored `lib/readability.js` (s1, **fixed s3**):
  Readability result is only used if it is >= 200 chars AND >= 30% of the
  page's `innerText` length; otherwise falls back to `innerText`. Fixes the
  partial-subtree problem on app-style pages (Claude chat page now ~11.6k chars
  instead of ~1k).
- **Embeddings (s2):** `offscreen/offscreen.js` runs transformers.js with the
  quantized all-MiniLM-L6-v2 from local files (no CDN), in an offscreen
  document. `lib/embeddings.js` provides `chunkText`, `embedTexts`, `embedPage`,
  `cosine`, `closeOffscreen`. Vectors are 384-dim, L2-normalized (cosine = dot).
- **Clustering (s3, NEW):** `lib/clustering.js`. Each page = one vector (mean of
  its chunk vectors, re-normalized). Step 1 `assign`: page joins the node whose
  centroid scores best if score >= `THRESHOLD` (0.50), else starts a new node.
  Step 2 `mergeNodes`: repeatedly merge the closest pair of nodes while their
  centroid score >= `MERGE_THRESHOLD` (0.52) (fixes centroid dilution).
  Exports: `THRESHOLD`, `MERGE_THRESHOLD`, `clusterNewPages`, `reclusterAll`,
  `showClusters`, `showMergeCandidates` (last two are dev helpers).
- **Wrap-up (s2, extended s3):** extract -> save page -> chunk+embed ->
  `saveChunks` -> after the tab loop, `clusterNewPages()`. Skips thin pages
  (< 300 chars), asleep/loading tabs, and unchanged pages that already have
  chunks. Offscreen doc closed in `finally`. A clustering error is caught
  separately (`summary.clusterError`) and never loses the wrap-up result; pages
  are grouped on the next run.
- **Status via storage (s3, NEW):** the service worker writes progress and the
  final summary to `chrome.storage.local` key `wrapUpStatus`
  (`state: running | done | error`). The popup no longer waits for the message
  response, so closing/reopening it (Chrome closes popups on focus loss) still
  shows progress or the last result. A `running` flag blocks a second wrap-up.
- `popup/` (s3 updated): live progress ("Working: embedding (tab 5 of 14)"),
  full summary (saved, embedded, unchanged, skipped, thin, asleep, groups,
  merged, problems), "Clear all (dev)" also clears the status key. A `running`
  status not updated for 3 minutes is shown as "interrupted".
- Build tooling (s2): `npm run build`, `npm run download-model`; Node on D:,
  npm cache on `D:\npm-cache`.
- Manifest: unchanged in s3 (no need to replace the knowledge-base copy).
- GitHub repo: https://github.com/rishav1729/Smriti (reference only; Claude
  cannot read its file contents).

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
- **Merge threshold:** group-to-group scores of pairs that should merge were
  0.553–0.602; the next pair down was 0.493 (article 258 search page), then
  unrelated pairs <= 0.487. Clear gap -> `MERGE_THRESHOLD = 0.52`.
- Result at 0.50 / 0.52 on 46 pages: exam-prep group of 14, Kore.ai/LangChain/AI
  group of 6, two web3 pairs, 22 singletons, no wrong merges.
- After Clear all + re-run on 14 open tabs: 9 groups (exam prep x5, Vertex AI
  Agent Builder x2, 7 alone).
- Decision on model size: no bigger model needed. Remaining misses come from
  short/low-text pages, not model quality.

## What's broken / known issues
- **Changed pages are not re-grouped.** If a page's content changes and it is
  re-embedded, it stays in its old node. `reclusterAll()` fixes it manually.
- **Deleted pages stay in node `pageIds`** (stale ids). Must be handled before
  the search view relies on nodes (`deletePage` should also remove the id from
  nodes, and delete empty nodes).
- **Web3 pages split** (Cyfrin/Shieldify pair, Web3 certification pair, and
  Cyfrin Login / remix / Solidity cheat sheet alone). Short pages have little
  text. Idea: prepend the page title to the text that gets embedded (test it).
- On small sets (14 pages) some related pages stay alone (Agents for Impact,
  Google Skills vs the Vertex AI group). More pages may fix it; title-in-
  embedding is the next experiment.
- Kore.ai release notes: 88k chars, capped at 60 chunks, so ~80% of the page is
  never embedded.
- Google Search pages and tiny pages (Speedtest, Groq console, Inshorts, "Thank
  you" pages) add noise; blocklist or higher minimum still undecided. YouTube
  feed/home pages same issue.
- Titles: IIT Kanpur page has title `""`; the display helpers fall back to the
  URL. Readability strips site-name suffixes.
- `readabilityChars` / `bodyChars` diagnostics are returned by the extractor but
  the service worker does not save them.
- A transient "Receiving end does not exist" embed error happened once (model
  still starting up); the page is retried at the next wrap-up.
- If the service worker is killed mid-run, `wrapUpStatus` stays `running`; the
  popup treats it as interrupted after 3 minutes.
- Popup status needs `white-space: pre-wrap;` on `#status` in `popup.css` if the
  text shows as one line.
- One run said "Saved 8" but listed 7 pages (probably duplicate URLs upserting
  into one record; unconfirmed, low priority).
- Dev hooks `globalThis.storage`, `.embeddings`, `.clustering` are still in the
  service worker. Remove before publishing.
- Generated files are gitignored, so a fresh clone needs `npm install`,
  `npm run download-model`, `npm run build`.

## Files touched this session
- New: `lib/clustering.js`
- Edited: `content/extractor.js` (Readability gating), `background/service-worker.js`
  (clustering step, status in `chrome.storage.local`, running guard),
  `popup/popup.js` (live status, full summary)
- Docs: `ARCHITECTURE.md`, `PROJECT_STATE.md`
- Not touched: `lib/storage.js`, `lib/embeddings.js`, `offscreen/*`,
  `manifest.json`, `popup/popup.html`, `popup/popup.css`

## Decisions made this session
- Page-level matching (mean of chunk vectors), not chunk-level.
- Greedy incremental assignment to node centroids, `THRESHOLD = 0.50`.
- Second merge pass for centroid dilution, `MERGE_THRESHOLD = 0.52`; both
  chosen from measured score distributions on real pages (decision 12 done).
- Readability is gated against an `innerText` baseline (30% ratio), not
  per-site rules.
- Wrap-up progress/result lives in `chrome.storage.local`; the popup never
  waits on the message response.
- Clustering failure must not lose the wrap-up result.
- Keep MiniLM; do not move to a bigger embedding model.

## Next immediate step
1. Optional quick experiment: prepend the page title to the text passed to
   `embedPage` (for short pages) and re-run `reclusterAll()`; keep it only if
   groups improve (web3 and the small-set singletons).
2. Fix the stale-node problem: when a page is deleted, remove its id from nodes
   and delete empty nodes (touches `lib/storage.js` and/or `clustering.js`).
3. Build `lib/summarizer.js`: label + summary per node (Groq free tier,
   batched, only at wrap-up, optional; anonymized short prompts only) and show
   the label in the groups. Paste `lib/storage.js` and `service-worker.js` when
   starting.
4. Then `graph-view/` list/search view over nodes.
Paste only the files about to be edited.

## Open questions / blockers
- Blocklist for low-value sites (Google Search, YouTube feed, tiny pages)?
- What goes to Groq exactly (titles + short excerpts only? how anonymized?).
- Whether re-embedded/changed pages should be re-assigned automatically.
- README credits still to add: transformers.js (Apache-2.0), onnxruntime-web
  (MIT), all-MiniLM-L6-v2 (Apache-2.0), Readability (Apache-2.0).
- Interview-worthy so far: on-demand injection with runtime-granted host
  permissions (privacy design), transactional chunk replacement in storage,
  Readability on a cloned DOM with fallback; s2: on-device WASM embeddings under
  MV3 lifecycle limits (offscreen doc, creation lock, ready-retry), locally
  bundled model with CDN WASM path overridden, normalized vectors so similarity
  is a dot product, idempotent wrap-up; **s3:** gating Readability against an
  independent `innerText` baseline (found in real data), choosing page-level
  matching and two thresholds from measured score distributions, merge pass for
  centroid dilution, and moving wrap-up status into `chrome.storage.local`
  because MV3 popups die on focus loss. Routine: popup UI, icons, IndexedDB
  CRUD, the chunker, npm scripts, manifest edits.

---

## Full current file contents

No source files are pasted here. Paste from VS Code only the files we are about
to edit. Replace the Project knowledge base copies of `ARCHITECTURE.md` and
`PROJECT_STATE.md` with the updated versions (`manifest.json` did not change
this session).