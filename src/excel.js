'use strict';
const ExcelJS = require('exceljs');
const { summarise } = require('./match');

const FONT = 'Arial';
const HDR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
const BLUEF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
const GREYF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const RAND = '"R"#,##0.00';
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.result != null) return String(v.result);
    if (v.text != null) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v).trim();
}

const HEADER_KEYS = {
  name: 'name', item: 'name', product: 'name',
  brand: 'brand', variant: 'variant', size: 'size',
  quantity: 'quantity', qty: 'quantity',
  alternatives: 'alternatives', 'alternatives ok': 'alternatives', 'alternatives ok?': 'alternatives',
  notes: 'notes', note: 'notes',
  search: 'search', 'search terms': 'search',
  must: 'must', 'must include': 'must', 'must include words': 'must',
};

async function readList(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheets.');
  const map = {};
  ws.getRow(1).eachCell((cell, col) => {
    const key = HEADER_KEYS[cellText(cell.value).toLowerCase()];
    if (key && !map[key]) map[key] = col;
  });
  if (!map.name) map.name = 1;
  const items = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const rec = {};
    for (const [k, col] of Object.entries(map)) rec[k] = cellText(row.getCell(col).value);
    if (rec.name) items.push(rec);
  });
  if (!items.length) throw new Error('No items found. Put a header row (name, brand, variant, size, quantity, alternatives, notes) and one item per row.');
  return items;
}

function styleHeader(ws, height = 32) {
  const r = ws.getRow(1);
  r.height = height;
  r.eachCell((c) => {
    c.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = HDR;
    c.border = BORDER;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
}

async function writeTemplate(filePath, items) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('shopping_list');
  ws.columns = [
    { header: 'name', key: 'name', width: 46 }, { header: 'brand', key: 'brand', width: 14 },
    { header: 'variant', key: 'variant', width: 30 }, { header: 'size', key: 'size', width: 12 },
    { header: 'quantity', key: 'quantity', width: 10 }, { header: 'alternatives', key: 'alternatives', width: 13 },
    { header: 'notes', key: 'notes', width: 30 }, { header: 'search terms', key: 'search', width: 34 },
    { header: 'must include', key: 'must', width: 28 },
  ];
  for (const it of items) ws.addRow(it);
  styleHeader(ws);
  ws.eachRow((row, n) => { if (n > 1) row.eachCell((c) => { c.font = { name: FONT, size: 10 }; c.border = BORDER; }); });
  const help = wb.addWorksheet('How to fill in');
  [
    'name: what you want to buy (required).',
    'brand: the brand. Leave blank for "any brand".',
    'variant, notes: free text for you (variant words are used for matching).',
    'size: minimum size such as "750ml min" or "1 or 2kg". Bigger packs are accepted when the size says min or lists options.',
    'quantity: a number of items (6) or a total amount (12kg) - the app compares cost for that amount.',
    'alternatives: Yes lets the app also suggest other brands.',
    'search terms (optional): the words typed into each store search. Short is better, e.g. "listerine cool mint".',
    'must include (optional): words a listing title must contain to count as an exact match, separated by commas, e.g. "cool,mint".',
  ].forEach((t, i) => { const c = help.getCell(i + 1, 1); c.value = t; c.font = { name: FONT, size: 10 }; });
  help.getColumn(1).width = 110;
  await wb.xlsx.writeFile(filePath);
}

function money(c) { c.numFmt = RAND; }

async function writeResults(filePath, { items, rows, stores, storeNotes }) {
  const wb = new ExcelJS.Workbook();
  const sum = summarise(items, rows);
  const date = new Date().toISOString().slice(0, 10);

  // ---------------- Best Prices
  const bp = wb.addWorksheet('Best Prices');
  bp.getCell('A1').value = `Best price per item (${date}) - ${stores.join(', ')}`;
  bp.getCell('A1').font = { name: FONT, size: 13, bold: true };
  const bh = ['#', 'Item', 'Qty needed', 'Best price per unit (R)', 'Cost for qty needed (R)', 'Best store', 'Product', 'Listed price (R)', 'Special?', 'Bulk?', 'Cheapest alternative cost (R)', 'Alt store', 'Alt product', 'Link', 'Promo detail / notes'];
  bp.getRow(3).values = bh;
  bp.getRow(3).height = 44;
  bp.getRow(3).eachCell((c) => { c.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }; c.fill = HDR; c.border = BORDER; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  let r = 4;
  for (const e of sum.entries) {
    const b = e.best, a = e.alt;
    const row = bp.getRow(r++);
    row.values = [
      e.item.id, e.item.name, e.item.qtyLabel,
      b ? b.unitPrice : '', b ? b.cost : '', b ? b.store : 'No exact match found',
      b ? b.product : '', b ? b.price : '', b ? b.special : '', b ? b.bulk : '',
      a ? a.cost : '', a ? a.store : '', a ? a.product : '',
      b && b.url ? { text: 'Open', hyperlink: b.url } : '',
      b ? [b.promo, b.notes].filter(Boolean).join(' - ') : '',
    ];
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { name: FONT, size: 10 }; c.border = BORDER;
      c.alignment = { vertical: 'top', wrapText: true, horizontal: [1, 3, 9, 10].includes(col) ? 'center' : 'left' };
      if ([4, 5, 8, 11].includes(col)) money(c);
    });
    row.getCell(14).font = { name: FONT, size: 10, color: { argb: 'FF0563C1' }, underline: true };
    if (b && b.special) row.getCell(9).fill = GREEN;
    if (b && b.bulk) row.getCell(10).fill = BLUEF;
    if (!b) row.eachCell({ includeEmpty: true }, (c) => { c.fill = GREYF; });
  }
  const tr = bp.getRow(r);
  tr.getCell(2).value = 'Total for the list (cheapest exact option per item)';
  tr.getCell(5).value = { formula: `SUM(E4:E${r - 1})`, result: sum.total };
  money(tr.getCell(5));
  tr.eachCell((c) => { c.font = { name: FONT, size: 10, bold: true }; });
  [5, 38, 10, 14, 14, 14, 48, 12, 11, 8, 14, 13, 40, 10, 60].forEach((w, i) => { bp.getColumn(i + 1).width = w; });
  bp.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
  if (sum.missing) bp.getCell(`B${r + 2}`).value = `${sum.missing} item(s) had no exact match in the stores searched, so the total is understated.`;
  bp.getCell(`B${r + 3}`).value = 'Best Prices is calculated by the app at search time (static values). The Price Comparison sheet has the full detail.';
  [r + 2, r + 3].forEach((n) => { bp.getCell(`B${n}`).font = { name: FONT, size: 9, italic: true }; });

  // ---------------- Shopping List
  const sl = wb.addWorksheet('Shopping List');
  sl.columns = [
    { header: '#', width: 5 }, { header: 'Name', width: 46 }, { header: 'Brand', width: 14 }, { header: 'Variant', width: 30 },
    { header: 'Size', width: 12 }, { header: 'Quantity', width: 10 }, { header: 'Alternatives OK?', width: 13 }, { header: 'Notes', width: 40 },
  ];
  for (const it of items) sl.addRow([it.id, it.name, it.brand, it.variant, it.size, it.qtyLabel, it.alternativesOK ? 'Yes' : 'No', it.notes]);
  styleHeader(sl);
  sl.eachRow((row, n) => { if (n > 1) row.eachCell((c) => { c.font = { name: FONT, size: 10 }; c.border = BORDER; c.alignment = { vertical: 'top', wrapText: true }; }); });

  // ---------------- Price Comparison
  const pc = wb.addWorksheet('Price Comparison');
  const ph = ['Item #', 'Shopping list item', 'Store', 'Product found', 'Match', 'Pack / size', 'Units in listing', 'Price (R)', 'Was price (R)', 'Promo detail', 'Special?', 'Bulk?', 'Price per unit (R)', 'Price per 100 ml/g (R)', 'Qty needed', 'Cost for qty needed (R)', 'Notes', 'Link'];
  pc.getRow(1).values = ph;
  styleHeader(pc, 42);
  const byId = new Map(items.map((i) => [i.id, i]));
  let n = 2;
  for (const x of rows) {
    const it = byId.get(x.itemId);
    const row = pc.getRow(n);
    const found = x.match !== '';
    row.getCell(1).value = x.itemId;
    row.getCell(2).value = it ? it.name : '';
    row.getCell(3).value = x.store;
    row.getCell(4).value = x.product;
    row.getCell(5).value = x.match || null;
    row.getCell(6).value = x.pack || null;
    if (found) {
      row.getCell(7).value = x.units;
      row.getCell(8).value = x.price;
      row.getCell(9).value = x.was;
      row.getCell(10).value = x.promo || null;
      row.getCell(11).value = x.special || null;
      row.getCell(12).value = x.bulk || null;
      row.getCell(13).value = { formula: `IF(OR(H${n}="",G${n}=""),"",H${n}/G${n})`, result: x.unitPrice };
      row.getCell(14).value = x.per100 == null ? null : x.per100;
      row.getCell(15).value = x.qtyLabel;
      row.getCell(16).value = x.cost == null ? null : x.cost;
    }
    row.getCell(17).value = x.notes || null;
    if (x.url) row.getCell(18).value = { text: x.url, hyperlink: x.url };
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { name: FONT, size: 10 }; c.border = BORDER;
      c.alignment = { vertical: 'top', wrapText: col !== 18, horizontal: [1, 5, 7, 11, 12, 15].includes(col) ? 'center' : 'left' };
      if ([8, 9, 13, 14, 16].includes(col)) money(c);
    });
    row.getCell(18).font = { name: FONT, size: 10, color: { argb: 'FF0563C1' }, underline: true };
    if (x.special) row.getCell(11).fill = GREEN;
    if (x.bulk) row.getCell(12).fill = BLUEF;
    if (!found) row.eachCell({ includeEmpty: true }, (c) => { c.fill = GREYF; });
    n++;
  }
  [7, 34, 13, 46, 12, 12, 9, 11, 11, 24, 11, 8, 12, 12, 10, 14, 52, 40].forEach((w, i) => { pc.getColumn(i + 1).width = w; });
  pc.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];
  pc.autoFilter = { from: 'A1', to: `R${Math.max(n - 1, 2)}` };

  // ---------------- Notes
  const nt = wb.addWorksheet('Notes');
  const lines = [
    ['Method and caveats', true],
    [`Prices were read from each store's website on ${date} through the Price Check app. Prices and specials change daily.`],
    [`Stores searched: ${stores.join(', ')}.`],
    ...(storeNotes || []).map((t) => [t]),
    ['Match column: Exact = the listing matches your name/brand/must-include words and meets your size rule. Alternative = a substitute (different variant, house brand, below your minimum size, or size not shown). Alternatives are kept out of the Best Prices maths. Matching is automatic - please review before buying.'],
    ['SPECIAL = a was-price above the current price. PROMO = the store flags a promotion but shows no was-price. BULK = a multi-pack listing; per-unit price = listing price / units in the pack.'],
    ['Dis-Chem prices marked as members need a Dis-Chem Benefits membership. Marketplace listings (Takealot, Amazon) can have inconsistent pricing - verify odd values.'],
  ];
  lines.forEach(([t, b], i) => { const c = nt.getCell(i + 1, 1); c.value = t; c.font = { name: FONT, size: b ? 12 : 10, bold: !!b }; c.alignment = { wrapText: true, vertical: 'top' }; });
  nt.getColumn(1).width = 120;

  await wb.xlsx.writeFile(filePath);
  return sum;
}

module.exports = { readList, writeTemplate, writeResults, cellText };
