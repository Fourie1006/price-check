'use strict';
// Reads the writing on a product picture (brand, product, size) with Tesseract.
// The English language data ships inside the app, so this works offline.
const path = require('path');
const fs = require('fs');
const { Jimp } = require('jimp');

let workerPromise = null;

function langDir() {
  const base = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
  for (const d of ['4.0.0_best_int', '4.0.0']) {
    if (fs.existsSync(path.join(base, d, 'eng.traineddata.gz'))) return path.join(base, d);
  }
  throw new Error('English OCR data is missing from the app.');
}

async function getWorker(cacheDir) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      return createWorker('eng', 1, { langPath: langDir(), gzip: true, cachePath: cacheDir || require('os').tmpdir(), cacheMethod: 'none' });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

async function stopOcr() {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch (e) { /* ignore */ }
  workerPromise = null;
}

// Make the picture friendlier for OCR: a sensible size, greyscale, more contrast.
async function prepare(buf, invert) {
  const img = await Jimp.read(buf);
  const longest = Math.max(img.bitmap.width, img.bitmap.height);
  const target = 1600;
  if (longest < 900 || longest > 2200) {
    const f = target / longest;
    img.resize({ w: Math.round(img.bitmap.width * f), h: Math.round(img.bitmap.height * f) });
  }
  img.greyscale().contrast(0.25);
  if (invert) img.invert();
  return img.getBuffer('image/png');
}

const STOP = new Set(['the', 'and', 'for', 'with', 'new', 'from', 'free', 'your', 'ltd', 'pty', 'www', 'com', 'net']);

// Returns the words found, biggest lettering first.
async function readText(buf, opts = {}) {
  const worker = await getWorker(opts.cacheDir);
  const found = new Map();
  let fullText = '';
  // Light text on a dark pack often reads better inverted, so try both and merge.
  for (const invert of [false, true]) {
    let res;
    try { res = await worker.recognize(await prepare(buf, invert), {}, { blocks: true }); } catch (e) { continue; }
    const data = res.data || {};
    fullText += '\n' + (data.text || '');
    const words = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) words.push(w);
    for (const w of data.words || words) {
      const raw = String(w.text || '').replace(/[^A-Za-z0-9'&-]/g, '');
      if (raw.length < 3 || !/[A-Za-z]{3}/.test(raw)) continue;
      const bb = w.bbox || {};
      const h = Math.max(1, (bb.y1 || 0) - (bb.y0 || 0));
      const key = raw.toLowerCase();
      const prev = found.get(key);
      if (!prev || w.confidence > prev.conf) found.set(key, { text: raw, conf: w.confidence || 0, h, y: bb.y0 || 0, x: bb.x0 || 0 });
    }
  }
  const all = Array.from(found.values());
  // Keep confident, real-looking words; the biggest lettering is usually the brand.
  const good = all
    .filter((w) => w.conf >= 55 && !STOP.has(w.text.toLowerCase()) && /^[A-Za-z][A-Za-z'&-]{2,}$/.test(w.text))
    .sort((a, b) => b.h * b.conf - a.h * a.conf);
  const sizes = Array.from(fullText.matchAll(/(\d+(?:[.,]\d+)?)\s?(ml|l|g|kg)\b/gi)).map((m) => `${m[1].replace(',', '.')}${m[2].toLowerCase()}`);
  return { words: good, all, text: fullText.replace(/\s+/g, ' ').trim(), sizes: Array.from(new Set(sizes)) };
}

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// Turn OCR output into search words.
function summarise(ocr) {
  const big = ocr.words.slice(0, 4);
  const w = big.map((x) => x.text);
  const reading = big.slice().sort((a, b) => (Math.abs(a.y - b.y) > Math.max(a.h, b.h) * 0.6 ? a.y - b.y : a.x - b.x)).map((x) => x.text);
  return {
    name: reading.map(titleCase).join(' '),
    top: w.slice(0, 3),
    brandGuess: w[0] || '',
    sizes: ocr.sizes,
  };
}

module.exports = { readText, summarise, stopOcr };
