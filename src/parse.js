'use strict';
// Size / pack parsing and token helpers shared by the matcher and tests.

const UNIT = '(kg|gr|gm|g|ml|ltr|litres?|l)';
const SIZE_RE = () => new RegExp('(\\d+(?:[.,]\\d+)?)\\s?' + UNIT + '(?![a-z])', 'gi');

function toBase(n, u) {
  u = u.toLowerCase();
  n = parseFloat(String(n).replace(',', '.'));
  if (u === 'kg') return { amount: n * 1000, type: 'g' };
  if (u === 'g' || u === 'gr' || u === 'gm') return { amount: n, type: 'g' };
  if (u === 'ml') return { amount: n, type: 'ml' };
  return { amount: n * 1000, type: 'ml' }; // l, ltr, litre(s)
}

function allSizes(text) {
  const re = SIZE_RE();
  const out = [];
  let m;
  while ((m = re.exec(String(text || '')))) {
    out.push({ idx: m.index, len: m[0].length, ...toBase(m[1], m[2]) });
  }
  return out;
}

// Returns { units, perUnit, type, total, bundle }
// units   = number of items in the listing (1 if not a multipack)
// perUnit = size of one item in g or ml (null if the title has no size)
function parseSize(title) {
  const t = String(title || '');
  const sizes = allSizes(t);
  let units = null;
  let bundle = false;
  const first = sizes[0];

  if (first) {
    const before = t.slice(0, first.idx).replace(/[\s(]+$/, '');
    const after = t.slice(first.idx + first.len);
    let m = before.match(/(\d+)\s*[x×]\s*$/i);
    if (m) units = parseInt(m[1], 10);
    if (!units) {
      m = after.match(/^\s*[x×]\s*(\d+)\b/i);
      if (m) units = parseInt(m[1], 10);
    }
    if (sizes.length > 1) {
      const between = t.slice(first.idx + first.len, sizes[1].idx);
      if (/[+&]/.test(between) && Math.abs(sizes[1].amount - first.amount) >= 0 && /[a-z]{3,}/i.test(between)) bundle = true;
    }
  }
  if (!units) {
    const m = t.match(/(?:pack|set|shrink|case|box|bundle|carton)(?:\s*pack)?\s*of\s*(\d+)/i) || t.match(/(\d+)\s*[- ]?(?:pack|pk)\b/i);
    if (m) units = parseInt(m[1], 10);
  }
  if (!units || units < 1) units = 1;
  const perUnit = first ? first.amount : null;
  return { units, perUnit, type: first ? first.type : null, total: first ? first.amount * units : null, bundle };
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'with', 'for', 'in', 'on', 'any', 'variant', 'variants', 'reputable', 'brand', 'min', 'minimum', 'or', 'new', 'improved', 'range', 'favourite', 'favorite', 'plain', 'x', 'pack', 'set']);
const UNIT_WORDS = new Set(['ml', 'l', 'g', 'gr', 'gm', 'kg', 'ltr']);
const SYN = { deodorant: ['deo'], antiperspirant: ['anti', 'perspirant'], moisturizer: ['moisturiser'], moisturising: ['moisturiser'], moisturizing: ['moisturiser'], cleaner: ['cleaner'], ingrams: ['ingram'] };

function stem(w) {
  return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

// Lower-cased, de-punctuated, synonym-mapped tokens (sizes and fluff removed).
function tokens(s, { keepStop = false } = {}) {
  const raw = String(s || '')
    .toLowerCase()
    .replace(/&amp;/g, ' ')
    .replace(/[`'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const out = [];
  for (const w of raw) {
    if (/^\d+$/.test(w) || UNIT_WORDS.has(w)) continue;
    if (/^\d+(ml|g|kg|l|gr|gm)$/.test(w)) continue;
    if (!keepStop && STOP.has(w)) continue;
    const mapped = SYN[w] || [w];
    for (const x of mapped) out.push(stem(x));
  }
  return out;
}

module.exports = { parseSize, allSizes, toBase, tokens, stem };
