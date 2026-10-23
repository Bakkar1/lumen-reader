// Puts everything Kokoro needs at run time under public/kokoro/, so the
// extension ships the model and never fetches anything while reading:
//   models/<MODEL_ID>/  config, tokenizer and the q8 ONNX model (downloaded once from Hugging Face)
//   voices/             voice style vectors (copied from the kokoro-js package)
//   ort/                the ONNX Runtime WASM build that transformers.js loads (copied from onnxruntime-web)
// Idempotent: files that already exist are skipped. Run with `npm run kokoro`.
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
/** The voices kokoro-js knows (English only); the package ships more .bin files than it can use. */
const VOICE_PREFIXES = ['af_', 'am_', 'bf_', 'bm_'];

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public', 'kokoro');
const nodeModules = path.join(root, 'node_modules');

async function download(file) {
  const target = path.join(out, 'models', MODEL_ID, file);
  if (existsSync(target)) return;
  await mkdir(path.dirname(target), { recursive: true });
  const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${file}`;
  console.log(`kokoro: downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  // Write to a temporary name first so an interrupted download is not mistaken for a finished one.
  await writeFile(`${target}.part`, Buffer.from(await response.arrayBuffer()));
  await rename(`${target}.part`, target);
}

async function copyMatching(fromDir, toDir, keep) {
  await mkdir(toDir, { recursive: true });
  for (const name of readdirSync(fromDir).filter(keep)) {
    const target = path.join(toDir, name);
    if (!existsSync(target)) await copyFile(path.join(fromDir, name), target);
  }
}

for (const file of MODEL_FILES) await download(file);
await copyMatching(path.join(nodeModules, 'kokoro-js', 'voices'), path.join(out, 'voices'), (n) =>
  VOICE_PREFIXES.some((p) => n.startsWith(p)) && n.endsWith('.bin'),
);
await copyMatching(path.join(nodeModules, 'onnxruntime-web', 'dist'), path.join(out, 'ort'), (n) =>
  /^ort-wasm-simd-threaded\.jsep\.(mjs|wasm)$/.test(n),
);
console.log(`kokoro: assets ready in ${path.relative(root, out)}`);
