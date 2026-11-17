'use strict';
// Compares how two product pictures look.
//  - "clip": a small AI model (CLIP) turns each picture into numbers; downloaded once (about 90 MB).
//  - "basic": colour layout, colour mix, outline hash and shape; always available, less clever.
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const THRESH = require('./thresholds');

// --------------------------------------------------------------------------- basic features
const isBg = (d, i) => d[i + 3] < 20 || (d[i] > 232 && d[i + 1] > 232 && d[i + 2] > 232);

function trimBackground(img) {
  const { width: w, height: h, data: d } = img.bitmap;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isBg(d, (y * w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  if (x1 < 0 || cw < w * 0.15 || ch < h * 0.15) return img;
  return img.clone().crop({ x: x0, y: y0, w: cw, h: ch });
}

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

function basicFeatures(src) {
  const trimmed = trimBackground(src);
  const aspect = trimmed.bitmap.width / trimmed.bitmap.height;
  const small = trimmed.clone().resize({ w: 32, h: 32 });
  const { data } = small.bitmap;
  // 4x4 colour grid
  const grid = new Float32Array(48);
  const cnt = new Float32Array(16);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4, c = (y >> 3) * 4 + (x >> 3);
    grid[c * 3] += data[i]; grid[c * 3 + 1] += data[i + 1]; grid[c * 3 + 2] += data[i + 2]; cnt[c]++;
  }
  for (let c = 0; c < 16; c++) for (let k = 0; k < 3; k++) grid[c * 3 + k] /= cnt[c] || 1;
  // colour histogram: 12 hues (weighted by saturation and brightness) + 3 greys (dark, mid, light)
  const hist = new Float32Array(15);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 20) continue;
    const [h, s, v] = rgb2hsv(data[i], data[i + 1], data[i + 2]);
    if (s < 0.18 || v < 0.15) hist[v < 0.35 ? 12 : v < 0.75 ? 13 : 14] += 1;
    else hist[Math.floor(h / 30) % 12] += s * v + 0.05;
  }
  const hs = hist.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 15; i++) hist[i] /= hs;
  // difference hash on 9x8 greyscale
  const g = small.clone().greyscale().resize({ w: 9, h: 8 });
  const bits = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(g.bitmap.data[(y * 9 + x) * 4] > g.bitmap.data[(y * 9 + x + 1) * 4] ? 1 : 0);
  return { grid, hist, bits, aspect };
}

function basicSim(a, b) {
  let diff = 0;
  for (let i = 0; i < 48; i++) diff += Math.abs(a.grid[i] - b.grid[i]);
  const gridSim = Math.exp(-(diff / 48) / 38);
  let inter = 0;
  for (let i = 0; i < 15; i++) inter += Math.min(a.hist[i], b.hist[i]);
  let ham = 0;
  for (let i = 0; i < 64; i++) if (a.bits[i] !== b.bits[i]) ham++;
  const hashSim = Math.max(0, 1 - (ham / 64 - 0.0) * 2.0);
  const aspSim = Math.max(0, 1 - Math.min(1, Math.abs(Math.log(a.aspect / b.aspect))));
  return 0.35 * gridSim + 0.32 * inter + 0.13 * hashSim + 0.2 * aspSim;
}

// --------------------------------------------------------------------------- CLIP
const MODEL_URL = 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx';
const MODEL_FILE = 'clip-vit-b32-vision-q8.onnx';
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

class Clip {
  constructor({ dir, url, fetchImpl, minBytes }) {
    this.dir = dir;
    this.file = path.join(dir, MODEL_FILE);
    this.url = url || MODEL_URL;
    this.fetch = fetchImpl || globalThis.fetch;
    this.minBytes = minBytes == null ? 20 * 1024 * 1024 : minBytes;
    this.session = null;
    this.ort = null;
    this.error = '';
  }

  has() { try { return fs.statSync(this.file).size >= this.minBytes; } catch (e) { return false; } }

  async download(onProgress) {
    fs.mkdirSync(this.dir, { recursive: true });
    const res = await this.fetch(this.url, { redirect: 'follow' });
    if (!res.ok) throw new Error('model download failed (HTTP ' + res.status + ')');
    const total = Number(res.headers.get('content-length')) || 0;
    const part = this.file + '.part';
    const out = fs.createWriteStream(part);
    let got = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        if (onProgress) onProgress(got, total);
      }
    } finally { await new Promise((r) => out.end(r)); }
    if (got < this.minBytes) { fs.rmSync(part, { force: true }); throw new Error('model download was incomplete'); }
    fs.renameSync(part, this.file);
  }

  // Loads the model, downloading it first if needed. Returns true when ready.
  async load(onProgress) {
    if (this.session) return true;
    try {
      if (!this.has()) await this.download(onProgress);
      this.ort = require('onnxruntime-web');
      this.ort.env.wasm.numThreads = 1;
      this.ort.env.logLevel = 'error';
      this.session = await this.ort.InferenceSession.create(new Uint8Array(fs.readFileSync(this.file)), { executionProviders: ['wasm'] });
      this.error = '';
      return true;
    } catch (e) {
      this.error = e && e.message ? e.message : String(e);
      this.session = null;
      return false;
    }
  }

  async embed(buf) {
    const img = await Jimp.read(buf);
    // flatten transparency onto white
    const { data } = img.bitmap;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 1) { data[i] = data[i] * a + 255 * (1 - a); data[i + 1] = data[i + 1] * a + 255 * (1 - a); data[i + 2] = data[i + 2] * a + 255 * (1 - a); data[i + 3] = 255; }
    }
    const { width: w, height: h } = img.bitmap;
    const s = 224 / Math.min(w, h);
    img.resize({ w: Math.max(224, Math.round(w * s)), h: Math.max(224, Math.round(h * s)) });
    const x0 = Math.floor((img.bitmap.width - 224) / 2), y0 = Math.floor((img.bitmap.height - 224) / 2);
    img.crop({ x: x0, y: y0, w: 224, h: 224 });
    const px = new Float32Array(3 * 224 * 224);
    const d = img.bitmap.data;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      px[p] = (d[i] / 255 - MEAN[0]) / STD[0];
      px[224 * 224 + p] = (d[i + 1] / 255 - MEAN[1]) / STD[1];
      px[2 * 224 * 224 + p] = (d[i + 2] / 255 - MEAN[2]) / STD[2];
    }
    const inName = this.session.inputNames.includes('pixel_values') ? 'pixel_values' : this.session.inputNames[0];
    const out = await this.session.run({ [inName]: new this.ort.Tensor('float32', px, [1, 3, 224, 224]) });
    const outName = this.session.outputNames.includes('image_embeds') ? 'image_embeds' : this.session.outputNames[0];
    const v = Float32Array.from(out[outName].data);
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
  }
}

const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// --------------------------------------------------------------------------- public API
async function features(buf, clip) {
  const img = await Jimp.read(buf);
  const f = { basic: basicFeatures(img) };
  if (clip && clip.session) { try { f.clip = await clip.embed(buf); } catch (e) { /* basic only */ } }
  return f;
}

function similarity(a, b) {
  if (a.clip && b.clip) return { score: Math.max(0, cosine(a.clip, b.clip)), kind: 'clip' };
  return { score: basicSim(a.basic, b.basic), kind: 'basic' };
}

// A small picture for the screen (data URL).
async function thumbnail(buf, height = 56) {
  const img = await Jimp.read(buf);
  img.resize({ h: height });
  return 'data:image/png;base64,' + (await img.getBuffer('image/png')).toString('base64');
}

module.exports = { Clip, features, similarity, thumbnail, basicFeatures, basicSim, cosine, THRESH, MODEL_URL };
