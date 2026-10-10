# Smriti — Your Browsing Memory

> *Smriti* (स्मृति) is Sanskrit for "memory."

A **local-first** Chrome extension that turns your open tabs into a personal knowledge graph. It reads the pages you have open, embeds them **on your device**, and groups related pages into topics so you can find things later by meaning instead of by remembering which tab it was.

**Status: early development (v0.1.0).** Extraction, on-device embeddings, and clustering work. Summaries and the search view are in progress. See the [Roadmap](#roadmap).

<!-- Add a screenshot or GIF of the popup here once the search view exists -->

## Why

Tab hoarding is a memory problem. You open twenty tabs across exam prep, a side project, and a rabbit hole about smart-contract security, and a week later you cannot find the one page you needed. Smriti groups what you read by topic, without sending your browsing to a server.

## How it works

1. **Wrap up session.** You click a button in the popup. Nothing runs in the background and nothing is captured automatically.
2. **Extract.** The extractor is injected into your open tabs on demand and pulls the readable text (Mozilla Readability, with a fallback to visible text for app-style pages).
3. **Embed.** Text is chunked and embedded into 384-dimension vectors by `all-MiniLM-L6-v2`, running in WebAssembly inside an offscreen document. The model ships with the extension and is loaded from local files.
4. **Cluster.** Each page becomes one vector (the mean of its chunks). Pages join the most similar existing topic if the similarity is at least 0.50, otherwise they start a new one. A second pass merges topics whose centroids score at least 0.52.
5. **Store.** Pages, chunks, and topics are saved in IndexedDB, in your browser profile.

## Privacy

Privacy is the point of this project, so here is exactly what happens:

- **Page content is processed and stored locally.** Extraction, embedding, clustering, and storage all run on your machine. The embedding model is bundled, with no runtime CDN or model download.
- **Nothing is captured until you click "Wrap up session."** There are no content scripts in the manifest. The extractor is injected on demand only into tabs you have open at that moment.
- **Host access is requested at runtime.** `<all_urls>` is an *optional* permission, requested when you first click wrap-up.
- **Incognito tabs are never read.** Only http(s) pages are processed. Sleeping tabs are skipped, never reloaded.
- **Optional cloud step (planned, off by default).** Topic labels and summaries may use the Groq API with *your own* key, only if you turn it on. Only short, anonymized prompts (page titles and brief excerpts, no URLs, no full text) are sent. Without it, everything still works with locally generated labels.

## Tech highlights

- **On-device ML under Manifest V3.** transformers.js runs in an offscreen document to survive service-worker shutdown, with a creation lock, ready-retry, and the offscreen document closed after each run to free memory.
- **Data-driven clustering.** The two thresholds were chosen from measured similarity distributions on real browsing data. Page-level matching beat chunk-level matching, which produced false matches from generic boilerplate chunks. A merge pass fixes centroid dilution.
- **Extraction heuristic found from real data.** Readability output is accepted only if it covers at least 30% of the page's visible text, which fixes partial extraction on app-style pages.
- **Resilient wrap-up.** Progress and results live in `chrome.storage.local`, so the popup can close mid-run (MV3 popups die on focus loss) and still show status. Wrap-up is idempotent, and a clustering failure never loses extraction or embedding work.
- **Compact storage.** Vectors are stored as `Float32Array` and L2-normalized, so cosine similarity is a plain dot product. Chunk replacement is transactional.

## Setup (from source)

Requires Node.js and Chrome.

```bash
git clone https://github.com/rishav1729/Smriti.git
cd Smriti
npm install
npm run download-model   # one-time, dev-time download of MiniLM into models/
npm run build            # bundles the offscreen script, copies WASM into vendor/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the project folder.

Re-run `npm run build` after editing `offscreen/offscreen.js`. Edits to other files only need an extension reload.

## Usage

1. Open some tabs.
2. Click the Smriti toolbar icon and press **Wrap up session**.
3. Grant site access when prompted (first run only).
4. Watch progress in the popup. When it finishes, the summary shows how many pages were saved, embedded, and grouped.

## Project structure

```
background/service-worker.js   orchestrates wrap-up
content/extractor.js           on-demand page text extraction
offscreen/                     hidden page that runs the embedding model
lib/storage.js                 IndexedDB wrapper
lib/embeddings.js              chunking + embedding API
lib/clustering.js              page vectors, assignment, merge pass
lib/readability.js             vendored Mozilla Readability
popup/                         toolbar popup UI
```

Full design notes and decisions are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Roadmap

- [x] Manual wrap-up from the popup
- [x] On-demand content extraction
- [x] Local embeddings (MiniLM, WASM)
- [x] Similarity clustering into topics
- [x] IndexedDB storage
- [ ] Topic labels and summaries (local fallback, optional Groq)
- [ ] List and search view over topics
- [ ] Cleanup of deleted pages in topics, re-grouping of changed pages

**Later:** related-content nudge on new pages, visual graph view, duplicate-tab detection, capturing tabs closed before wrap-up.

## Known limitations

- Pages with very little text (login screens, search result pages) group poorly.
- Very long pages are capped at 60 chunks, so the tail is not embedded.
- Changed pages are not automatically re-grouped yet.

## Credits

- [transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0)
- [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT)
- [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) (Apache-2.0), quantized ONNX build by [Xenova](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
- [Mozilla Readability](https://github.com/mozilla/readability) (Apache-2.0)

## License

License to be decided.