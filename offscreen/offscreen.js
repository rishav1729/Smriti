import { pipeline, env } from '@huggingface/transformers';

// Local-only: never touch the network. (The default WASM path is a CDN, so we override it.)
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/');
env.backends.onnx.wasm.numThreads = 1;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',   // loads onnx/model_quantized.onnx
      device: 'wasm',
    }).catch((e) => { extractorPromise = null; throw e; });
  }
  return extractorPromise;
}

async function embed(texts) {
  const extractor = await getExtractor();
  // mean pooling + normalize => unit vectors, so cosine similarity = dot product
  const out = await extractor(texts, { pooling: 'mean', normalize: true });
  return out.tolist(); // number[][] (messages are JSON, so no typed arrays)
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'PING') { sendResponse({ ok: true }); return; }
  if (msg.type === 'EMBED') {
    embed(msg.texts)
      .then((vectors) => sendResponse({ ok: true, vectors }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true; // keep the channel open for the async response
  }
});