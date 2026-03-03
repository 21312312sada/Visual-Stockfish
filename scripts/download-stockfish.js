#!/usr/bin/env node
/**
 * Download Stockfish 18 lite single-threaded worker script into static/.
 * Run from project root: node scripts/download-stockfish.js
 * Fixes 403 from CDN by serving the engine from your own app.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE = 'v18.0.0';
const BASE = `https://github.com/nmrugg/stockfish.js/releases/download/${RELEASE}`;
const OUT_DIR = path.join(__dirname, '..', 'static');

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) {
    const url = `${BASE}/${name}`;
    console.log('Downloading', name, '...');
    const buf = await download(url);
    const outPath = path.join(OUT_DIR, name);
    fs.writeFileSync(outPath, buf);
    console.log('Wrote', outPath);
  }
  const wasmSrc = path.join(OUT_DIR, 'stockfish-18-lite-single.wasm');
  const wasmDefault = path.join(OUT_DIR, 'stockfish.wasm');
  if (fs.existsSync(wasmSrc) && !fs.existsSync(wasmDefault)) {
    fs.copyFileSync(wasmSrc, wasmDefault);
    console.log('Wrote', wasmDefault, '(engine expects this name for direct load)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
