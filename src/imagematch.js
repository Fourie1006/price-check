'use strict';
// Ties the picture steps together: read the user's picture, then score store thumbnails against it.
const { readText, summarise, stopOcr } = require('./ocr');
const { features, similarity } = require('./vision');
const { applyPicture } = require('./match');
const { tokens } = require('./parse');

const MAX_CANDIDATES = 12;
const PARALLEL = 4;

class ImageMatcher {
  // fetchImage(url) -> Promise<Buffer>
  constructor({ clip, fetchImage, cacheDir }) {
    this.clip = clip || null;
    this.fetchImage = fetchImage;
    this.cacheDir = cacheDir;
    this.mine = new Map(); // item id -> features
    this.cache = new Map(); // url -> features or null
    this.referer = '';
    this.stats = { ok: 0, fail: 0 };
  }

  get kind() { return this.clip && this.clip.session ? 'clip' : 'basic'; }

  // Reads the picture for one item: OCR text + look features. Never throws; returns a short note.
  async prepare(item, buf) {
    const notes = [];
    try { this.mine.set(item.id, await features(buf, this.clip)); } catch (e) { notes.push('could not decode the picture'); }
    let sum = { top: [], name: '', brandGuess: '', sizes: [] };
    try { sum = summarise(await readText(buf, { cacheDir: this.cacheDir })); } catch (e) { notes.push('could not read the writing on it'); }
    applyPicture(item, sum);
    if (!item.name) notes.push('no name found - add a name in the sheet so the app knows what to search for');
    return notes.join('; ');
  }

  async thumbFeatures(url) {
    if (this.cache.has(url)) return this.cache.get(url);
    let f = null;
    try { f = await features(await this.fetchImage(url, this.referer), this.clip); this.stats.ok++; } catch (e) { f = null; this.stats.fail++; }
    this.cache.set(url, f);
    return f;
  }

  // Sets raw[i].vis = { score, kind } on the listings that look worth comparing.
  async score(item, raw, store) {
    if (store && store.home) this.referer = store.home;
    const mine = this.mine.get(item.id);
    if (!mine) return;
    const want = new Set(item.coreTokens.concat(item.pictureWords ? tokens(item.pictureWords.join(' ')) : []));
    const withImg = raw.map((r, i) => ({ r, i, hit: tokens(r.title).filter((t) => want.has(t)).length })).filter((x) => x.r.img);
    withImg.sort((a, b) => b.hit - a.hit || a.i - b.i);
    const urls = [];
    for (const x of withImg) if (!urls.includes(x.r.img)) urls.push(x.r.img);
    const chosen = urls.slice(0, MAX_CANDIDATES);
    const out = new Map();
    let next = 0;
    const worker = async () => {
      while (next < chosen.length) {
        const url = chosen[next++];
        const f = await this.thumbFeatures(url);
        if (f) out.set(url, similarity(mine, f));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, chosen.length) }, worker));
    for (const r of raw) if (r.img && out.has(r.img)) r.vis = out.get(r.img);
  }

  async close() { await stopOcr(); }
}

module.exports = { ImageMatcher };
