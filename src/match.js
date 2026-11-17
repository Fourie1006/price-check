'use strict';
const { parseSize, allSizes, toBase, tokens } = require('./parse');
const THRESH = require('./thresholds');

const GENERIC_BRAND = /^(any|none|n\/a|-)?$/i;

function cleanCell(v) {
  return String(v == null ? '' : v).trim();
}

function parseQty(q) {
  const s = cleanCell(q);
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml)?\b/i);
  if (!m) return { qty: 1, needed: null, label: '1' };
  const n = parseFloat(m[1].replace(',', '.'));
  if (m[2]) {
    const b = toBase(n, m[2]);
    return { qty: n, needed: b.amount, label: `${n} ${m[2].toLowerCase()}` };
  }
  return { qty: n, needed: null, label: String(n) };
}

// Size rule from the "size" column (or the name): { min, flexible }
function sizeSpec(sizeText, name) {
  const s = cleanCell(sizeText);
  const orM = s.match(/(\d+(?:[.,]\d+)?)\s*(?:or|\/)\s*(\d+(?:[.,]\d+)?)\s*(kg|gr|gm|g|ml|ltr|l)\b/i);
  if (orM) return { min: toBase(orM[1], orM[3]).amount, flexible: true };
  let list = allSizes(s);
  let src = s;
  if (!list.length) {
    list = allSizes(name);
    src = name;
  }
  if (!list.length) return null;
  const min = list.reduce((a, b) => (b.amount < a.amount ? b : a));
  const flexible = /\bmin(imum)?\b/i.test(src) || list.length > 1;
  return { min: min.amount, flexible };
}

function stripSizes(text) {
  return cleanCell(text)
    .replace(/\(?\s*\d+(?:[.,]\d+)?\s?(?:kg|gr|gm|g|ml|ltr|l)\b\s*\)?/gi, ' ')
    .replace(/\bmin(imum)?\b/gi, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text) {
  const seen = new Set();
  return cleanCell(text)
    .split(/\s+/)
    .filter((w) => {
      const k = w.toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function prepareItem(raw, i) {
  const name = cleanCell(raw.name);
  let brand = cleanCell(raw.brand);
  if (GENERIC_BRAND.test(brand)) brand = '';
  const variant = cleanCell(raw.variant);
  const q = parseQty(raw.quantity);
  const must = cleanCell(raw.must)
    .split(/[,;]/)
    .map((x) => tokens(x))
    .reduce((a, b) => a.concat(b), []);
  const brandTokens = tokens(brand);
  const core = Array.from(new Set(tokens([brand, name, variant].join(' '))));
  const base = cleanCell(raw.search) || [brand, stripSizes(name)].join(' ');
  const w = words(base);
  const item = {
    id: i + 1,
    name,
    brand,
    variant,
    size: cleanCell(raw.size),
    qty: q.qty,
    qtyLabel: q.label,
    needed: q.needed,
    alternativesOK: /^(y|yes|true|1)/i.test(cleanCell(raw.alternatives)),
    notes: cleanCell(raw.notes),
    hasImage: !!raw.image,
    pictureError: cleanCell(raw.pictureError),
    must,
    brandTokens,
    coreTokens: core,
    spec: sizeSpec(raw.size, name),
    queries: {
      full: cleanCell(raw.search) || w.slice(0, 6).join(' '),
      short: cleanCell(raw.search) ? w.slice(0, 3).join(' ') : w.slice(0, 2).join(' '),
      brand: brand || w[0] || name,
    },
  };
  return item;
}

// Use what the picture says (see ocr.js summarise) to fill in or extend an item.
function applyPicture(item, sum) {
  const words = (sum.top || []).filter(Boolean);
  item.pictureWords = words;
  item.pictureSizes = sum.sizes || [];
  item.pictureBrand = tokens(sum.brandGuess || '');
  if (!item.name && sum.name) {
    item.name = sum.name;
    item.nameFromPicture = true;
    item.coreTokens = Array.from(new Set(tokens(sum.name)));
    const w = words.length ? words : sum.name.split(/\s+/);
    item.queries.full = w.slice(0, 3).join(' ');
    item.queries.short = w.slice(0, 2).join(' ');
    item.queries.brand = sum.brandGuess || w[0] || '';
    if (!item.size && item.pictureSizes[0]) { item.size = item.pictureSizes[0]; item.spec = sizeSpec(item.size, ''); item.spec && (item.spec.flexible = true); }
    item.alternativesOK = true;
  }
  const brandSet = new Set(item.brandTokens.concat(item.pictureBrand));
  const generic = tokens(item.nameFromPicture ? sum.name : item.name).filter((t) => !brandSet.has(t));
  item.queries.image = words.slice(0, 3).join(' ');
  item.queries.generic = generic.slice(0, 3).join(' ');
}

function fmtSize(amount, type) {
  if (amount == null) return '';
  if (amount >= 1000) return `${+(amount / 1000).toFixed(2)}${type === 'g' ? 'kg' : 'L'}`;
  return `${+amount.toFixed(1)}${type || ''}`;
}

// Turn one raw store listing into a comparison row (or null if irrelevant).
function evaluate(item, storeName, raw) {
  if (!raw || !raw.title || !(raw.price > 0)) return null;
  const ps = parseSize(raw.title);
  if (ps.bundle) return null;
  const toks = new Set(tokens(raw.title));
  const has = (t) => toks.has(t);
  const brandOK = item.brandTokens.every(has);
  const core = item.coreTokens;
  const hits = core.filter(has).length;
  const coverage = core.length ? hits / core.length : 0;
  const nameOK = item.must.length ? item.must.every(has) && brandOK : brandOK && coverage >= 0.7;

  let sizeState = 'na';
  let sizeNote = '';
  if (item.spec) {
    const m = item.spec.min;
    if (!ps.perUnit) {
      sizeState = 'unknown';
      sizeNote = 'Size not shown in the title - check it is at least ' + fmtSize(m, 'ml') + '.';
    } else if (ps.perUnit < m * 0.98) {
      sizeState = 'small';
      sizeNote = `Smaller than your size (${fmtSize(ps.perUnit, ps.type)}).`;
    } else if (!item.spec.flexible && ps.perUnit > m * 1.34) {
      sizeState = 'big';
      sizeNote = `Larger than your size (${fmtSize(ps.perUnit, ps.type)}).`;
    } else sizeState = 'ok';
  }

  let match = null;
  let note = sizeNote;
  if (nameOK && (sizeState === 'ok' || sizeState === 'na')) match = 'Exact';
  else if (nameOK) match = 'Alternative';
  else if (brandOK && item.brandTokens.length && (coverage >= 0.6 || sizeState === 'ok')) {
    match = 'Alternative';
    note = 'Same brand, different variant/product. ' + sizeNote;
  } else if (item.pictureBrand && item.pictureBrand.length && item.pictureBrand.every(has)) {
    match = 'Alternative';
    note = 'Same brand as your picture, different product. ' + sizeNote;
  } else if (item.alternativesOK && coverage >= 0.6) {
    match = 'Alternative';
    note = 'Other brand/variant. ' + sizeNote;
  }

  // ---- picture evidence (only when the user supplied a picture and a store thumbnail was compared)
  const vis = item.hasImage ? raw.vis : null;
  let visual = null;
  if (vis) {
    const T = THRESH[vis.kind];
    const pct = Math.round(vis.score * 100);
    visual = pct;
    const sameBrand = brandOK && item.brandTokens.length > 0 || (item.pictureBrand && item.pictureBrand.length > 0 && item.pictureBrand.every(has));
    const sizeFine = sizeState === 'ok' || sizeState === 'na';
    const rough = vis.kind === 'basic' ? ' (rough comparison)' : '';
    if (match === 'Exact') {
      if (vis.kind === 'clip' && vis.score < T.similar) {
        match = 'Alternative';
        note = `The name matches but the picture looks different (${pct}%). ` + note;
      } else note = `Picture match ${pct}%${rough}. ` + note;
    } else if (vis.score >= T.exact && (sameBrand || coverage >= 0.5)) {
      match = sizeFine ? 'Exact' : 'Alternative';
      note = `Looks the same as your picture (${pct}%)${rough}. ` + sizeNote;
    } else if (vis.score >= T.similar) {
      match = 'Alternative';
      note = `${sameBrand ? 'Same brand' : 'Other brand'}, similar look (${pct}%)${rough}. ` + sizeNote;
    }
  } else if (item.nameFromPicture && match === 'Exact') {
    match = 'Alternative';
    note = 'The name came from your picture and the listing photo could not be compared - check it is the same product. ' + note;
  }
  if (!match) return null;

  const total = ps.total;
  const unitPrice = raw.price / ps.units;
  let cost = null;
  if (item.needed) cost = total ? (raw.price / total) * item.needed : null;
  else cost = unitPrice * item.qty;
  const per100 = total ? (raw.price / total) * 100 : null;
  const special = raw.was && raw.was > raw.price ? 'SPECIAL' : raw.promo ? 'PROMO' : '';
  return {
    itemId: item.id,
    store: storeName,
    product: raw.title,
    match,
    pack: ps.perUnit ? `${ps.units} x ${fmtSize(ps.perUnit, ps.type)}` : ps.units > 1 ? `${ps.units} pack` : '',
    units: ps.units,
    sizePer: ps.perUnit,
    price: raw.price,
    was: raw.was && raw.was > raw.price ? raw.was : null,
    promo: raw.promo || '',
    special,
    bulk: ps.units > 1 ? 'BULK' : '',
    unitPrice,
    per100,
    qtyLabel: item.qtyLabel,
    cost,
    notes: note.trim(),
    url: raw.url || '',
    coverage,
    visual,
    visualKind: vis ? vis.kind : '',
  };
}

const byCost = (a, b) => (a.cost == null) - (b.cost == null) || a.cost - b.cost;

// Keep the cheapest few Exact and the most relevant few Alternative rows per store/item.
function pick(item, storeName, rawList) {
  const seen = new Set();
  const rows = [];
  for (const raw of rawList || []) {
    const key = (raw.url || raw.title) + '|' + raw.price;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = evaluate(item, storeName, raw);
    if (r) rows.push(r);
  }
  const exact = rows.filter((r) => r.match === 'Exact').sort(byCost).slice(0, 3);
  const alt = rows
    .filter((r) => r.match === 'Alternative')
    .sort((a, b) => (item.hasImage ? (b.visual || 0) - (a.visual || 0) : 0) || b.coverage - a.coverage || byCost(a, b))
    .slice(0, item.hasImage ? 3 : 2);
  const out = exact.concat(alt);
  if (!out.length) {
    out.push({ itemId: item.id, store: storeName, product: 'Not found', match: '', notes: 'No matching listing in the search results.', url: '' });
  }
  return out;
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// A listing whose price per 100 g/ml is far above the others for the same item is
// probably a multipack or a marketplace mark-up. Flag it; it is not used as "best"
// unless nothing else is available.
function markOutliers(rows) {
  const ids = Array.from(new Set(rows.map((r) => r.itemId)));
  for (const id of ids) {
    const mine = rows.filter((r) => r.itemId === id && r.per100 > 0);
    if (mine.length < 3) continue;
    const med = median(mine.map((r) => r.per100));
    for (const r of mine) {
      if (r.per100 > med * 2.5 && !r.outlier) {
        r.outlier = true;
        r.notes = ((r.notes ? r.notes + ' ' : '') + 'Price per unit is far above the other listings - may be a multipack or a mark-up. Check before buying.').trim();
      }
    }
  }
}

function summarise(items, rows) {
  markOutliers(rows);
  const out = items.map((it) => {
    const mine = rows.filter((r) => r.itemId === it.id && r.cost != null);
    const exact = mine.filter((r) => r.match === 'Exact').sort(byCost);
    const best = exact.find((r) => !r.outlier) || exact[0] || null;
    const alt = mine.filter((r) => r.match === 'Alternative' && !r.outlier).sort(byCost)[0] || null;
    return { item: it, best, alt };
  });
  const total = out.reduce((s, x) => s + (x.best ? x.best.cost : 0), 0);
  return { entries: out, total, missing: out.filter((x) => !x.best).length };
}

module.exports = { prepareItem, applyPicture, evaluate, pick, summarise, parseQty, sizeSpec, fmtSize };
