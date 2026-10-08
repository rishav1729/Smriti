import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/';
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx',
];

for (const f of FILES) {
  const out = `models/Xenova/all-MiniLM-L6-v2/${f}`;
  mkdirSync(dirname(out), { recursive: true });
  const res = await fetch(BASE + f);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log('saved', out);
}