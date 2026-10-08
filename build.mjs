import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

await build({
  entryPoints: ['offscreen/offscreen.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'offscreen/offscreen.bundle.js',
  logLevel: 'info',
});

mkdirSync('vendor', { recursive: true });
const src = 'node_modules/onnxruntime-web/dist';
for (const f of readdirSync(src)) {
  if (/^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(f)) {
    cpSync(`${src}/${f}`, `vendor/${f}`);
    console.log('copied', f);
  }
}