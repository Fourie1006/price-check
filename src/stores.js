'use strict';
// Each store knows how to search itself from inside a hidden browser window
// (so requests carry the site's own cookies and origin).
// The in-page functions below are serialised and run inside the page - they
// must not reference anything outside their own body.

class BlockedError extends Error {
  constructor(store) {
    super(`${store} is asking for a human check`);
    this.blocked = true;
  }
}

// ---------------------------------------------------------------- Takealot
function inTakealot(q) {
  return (async () => {
    const r = await fetch('https://api.takealot.com/rest/v-1-16-0/searches/products?qsearch=' + encodeURIComponent(q) + '&rows=24');
    if (r.status === 403 || r.status === 429) return { blocked: true };
    if (!r.ok) throw new Error('Takealot HTTP ' + r.status);
    const j = await r.json();
    return ((j.sections && j.sections.products && j.sections.products.results) || [])
      .map((p) => {
        const v = p.product_views || {};
        const core = v.core || {};
        const b = v.buybox_summary || {};
        const price = b.prices && b.prices[0];
        const list = b.listing_price;
        const g = v.gallery && v.gallery.images && v.gallery.images[0];
        return {
          title: core.title,
          price,
          was: list && price && list > price ? list : null,
          promo: '',
          url: core.slug ? 'https://www.takealot.com/' + core.slug + '/PLID' + core.id : null,
          img: g ? g.replace('{size}', 'pdpxl') : null,
        };
      })
      .filter((x) => x.title && x.price > 0);
  })();
}

// ---------------------------------------------------------------- Amazon.co.za
function inAmazon(q) {
  return (async () => {
    const r = await fetch('/s?k=' + encodeURIComponent(q));
    const h = await r.text();
    const d = new DOMParser().parseFromString(h, 'text/html');
    const tiles = d.querySelectorAll('[data-component-type="s-search-result"]');
    // 202 + empty body is Amazon's bot-challenge response; short pages without results are too.
    if (r.status === 202 || r.status === 403 || r.status === 429 || r.status === 503) return { blocked: true };
    if (!tiles.length && (h.length < 3000 || /captcha|robot check|not a robot/i.test(h.slice(0, 20000)))) return { blocked: true };
    const num = (t) => {
      const m = (t || '').replace(/\s/g, '').match(/R([\d,]+\.?\d*)/);
      return m ? parseFloat(m[1].replace(/,/g, '')) : null;
    };
    const out = [];
    for (const e of tiles) {
      if (e.querySelector('.puis-sponsored-label-text')) continue;
      const img = e.querySelector('img.s-image');
      const title = ((img && img.getAttribute('alt')) || (e.querySelector('h2') || {}).textContent || '').trim();
      const price = num((e.querySelector('.a-price:not(.a-text-price) .a-offscreen') || {}).textContent);
      const was = num((e.querySelector('.a-price.a-text-price .a-offscreen') || {}).textContent);
      const asin = e.getAttribute('data-asin');
      if (!title || !price) continue;
      out.push({ title, price, was: was && was > price ? was : null, promo: '', url: asin ? 'https://www.amazon.co.za/dp/' + asin : null, img: (img && img.getAttribute('src')) || null });
    }
    return out;
  })();
}

// ---------------------------------------------------------------- Clicks
function inClicks(q) {
  return (async () => {
    const r = await fetch('/search?q=' + encodeURIComponent(q) + '&pageSize=80');
    if (r.status === 403 || r.status === 429 || r.status === 503) return { blocked: true };
    const h = await r.text();
    const d = new DOMParser().parseFromString(h, 'text/html');
    const blocks = d.querySelectorAll('.productBlock');
    if (!blocks.length && /just a moment|cf-chl|attention required/i.test(h.slice(0, 5000))) return { blocked: true };
    const seen = new Set();
    const out = [];
    for (const e of blocks) {
      const c = e.cloneNode(true);
      c.querySelectorAll('script,style').forEach((s) => s.remove());
      const a = c.querySelector('a[href*="/p/"]');
      const href = a && a.getAttribute('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const txt = c.textContent.replace(/\s+/g, ' ').replace(/Delivered in.*$/, '').replace('See more variants', '').trim();
      const m = txt.match(/^(.*?)\s*R\s?([\d,]+\.\d{2})/);
      if (!m) continue;
      const pimg = Array.from(c.querySelectorAll('img')).map((i) => i.getAttribute('src') || '').find((x) => /^\/medias\/\?context=/.test(x));
      out.push({ title: m[1].trim(), price: parseFloat(m[2].replace(/,/g, '')), was: null, promo: /On promo/i.test(txt) ? 'On promo (Clicks flag)' : '', url: 'https://clicks.co.za' + href, img: pimg ? 'https://clicks.co.za' + pimg : null });
    }
    return out;
  })();
}

// ---------------------------------------------------------------- Dis-Chem
function inDischem(q) {
  return (async () => {
    const r = await fetch('/catalogsearch/result/?q=' + encodeURIComponent(q));
    if (r.status === 403 || r.status === 429 || r.status === 503) return { blocked: true };
    const h = await r.text();
    const d = new DOMParser().parseFromString(h, 'text/html');
    const tiles = d.querySelectorAll('li.product-item');
    if (!tiles.length && /just a moment|attention required|captcha/i.test(h.slice(0, 5000))) return { blocked: true };
    const out = [];
    for (const e of tiles) {
      const a = e.querySelector('a.product-item-photo');
      const link = e.querySelector('.product-item-link');
      const img = e.querySelector('img.product-image-photo');
      const title = ((link && link.textContent) || (img && img.getAttribute('alt')) || '').replace(/\s+/g, ' ').trim();
      const pb = e.querySelector('.price-box');
      const t = (pb ? pb.textContent : '').replace(/\s+/g, ' ');
      const nums = Array.from(t.matchAll(/R\s?([\d,]+\.\d{2})/g)).map((m) => parseFloat(m[1].replace(/,/g, '')));
      if (!title || !nums.length) continue;
      const special = /Special Price/i.test(t) && nums.length > 1;
      const price = special ? nums[1] : nums[0];
      const was = special ? nums[0] : null;
      const mem = e.textContent.match(/(\d+)% Off for members/i);
      out.push({ title, price, was, promo: mem ? mem[1] + '% off for Dis-Chem Benefits members' : '', url: a ? a.getAttribute('href') : null, img: (img && img.getAttribute('src')) || null });
    }
    return out;
  })();
}

// ---------------------------------------------------------------- Makro
// Makro renders results in the browser, so we load the page and read its text.
function parseMakroPrice(line) {
  const s = line.replace(/\s+/g, '');
  const toNum = (x) => parseInt(String(x).replace(/,/g, ''), 10) / 100;
  let m = s.match(/^R([\d,]+)R([\d,]+)%off/);
  if (m) {
    const a = toNum(m[1]);
    const rest = m[2].replace(/,/g, '');
    for (const k of [2, 1]) {
      const d = parseInt(rest.slice(-k), 10);
      const b = toNum(rest.slice(0, -k));
      if (b && a < b && Math.abs(Math.round((1 - a / b) * 100) - d) <= 1) return { price: a, was: b };
    }
    return { price: a, was: null };
  }
  m = s.match(/^R([\d,]+)R([\d,]+)$/);
  if (m) {
    const a = toNum(m[1]);
    const b = toNum(m[2]);
    return { price: a, was: b > a ? b : null };
  }
  m = s.match(/^R([\d,]+)$/);
  if (m) return { price: toNum(m[1]), was: null };
  return null;
}

function parseMakroText(text, links) {
  const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const sizeRe = /^(?:Pack of \d+ x )?\d+(?:\.\d+)? ?(?:ml|l|g|kg)$/i;
  const out = [];
  for (let i = 1; i < lines.length - 1; i++) {
    if (!sizeRe.test(lines[i]) || !/^R\s?[\d,]+/.test(lines[i + 1])) continue;
    const p = parseMakroPrice(lines[i + 1]);
    if (!p) continue;
    const name = lines[i - 1].replace(/\.\.\.$/, '');
    const url = (links || []).find((l) => l[0] && l[0].indexOf(name.slice(0, 25)) === 0);
    out.push({
      title: `${name} ${lines[i]}`,
      price: p.price,
      was: p.was,
      promo: '',
      url: url ? url[1] : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- definitions
// plan = which query styles to run (see match.js: full / short / brand)
const STORES = [
  { id: 'takealot', name: 'Takealot', home: 'https://www.takealot.com/', plan: ['full'], search: (s, q) => s.evalFn(inTakealot, q) },
  { id: 'amazon', name: 'Amazon.co.za', home: 'https://www.amazon.co.za/', plan: ['full'], pace: 1500, search: (s, q) => s.evalFn(inAmazon, q) },
  { id: 'clicks', name: 'Clicks', home: 'https://clicks.co.za/', plan: ['short', 'brand'], pace: 700, search: (s, q) => s.evalFn(inClicks, q) },
  { id: 'dischem', name: 'Dis-Chem', home: 'https://www.dischem.co.za/', plan: ['full', 'short'], search: (s, q) => s.evalFn(inDischem, q) },
  {
    id: 'makro', name: 'Makro', home: 'https://www.makro.co.za/', plan: ['short'], pace: 2000, experimental: true,
    async search(s, q) {
      await s.load('https://www.makro.co.za/search?q=' + encodeURIComponent(q));
      if (await s.isBlocked()) throw new BlockedError('Makro');
      await s.waitFor(() => /Showing \d+|no results|0 results/i.test(document.body.innerText), 15000);
      if (await s.isBlocked()) throw new BlockedError('Makro');
      const text = await s.evalFn(() => document.body.innerText);
      const links = await s.evalFn(() => Array.from(document.querySelectorAll('a[href]')).map((a) => [a.innerText.trim().slice(0, 100), a.href]).filter((x) => x[0]));
      return parseMakroText(text, links);
    },
  },
];

module.exports = { STORES, BlockedError, parseMakroText, parseMakroPrice, inTakealot, inAmazon, inClicks, inDischem };
