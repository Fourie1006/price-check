'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSize, tokens } = require('../src/parse');
const { prepareItem, pick, summarise } = require('../src/match');
const { parseMakroText, parseMakroPrice, inTakealot, inAmazon, inClicks, inDischem } = require('../src/stores');
const { readList, writeResults } = require('../src/excel');

let passed = 0;
const t = (name, fn) => { try { const r = fn(); if (r && r.then) return r.then(() => { passed++; console.log('ok  ', name); }); passed++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n    ', e.message); process.exitCode = 1; } };
const approx = (a, b, m) => assert.ok(Math.abs(a - b) < 0.011, `${m || ''} expected ${b} got ${a}`);

(async () => {
  // ---------------------------------------------------------------- parsing
  t('parseSize: multipacks', () => {
    let p = parseSize('Handy Andy Lavender Cleaning Cream 750ml (Pack of 5)'); assert.deepStrictEqual([p.units, p.perUnit], [5, 750]);
    p = parseSize('Duck Toilet Cleaner Lavender Fresh Deep Action Gel (6 x 500ml)'); assert.deepStrictEqual([p.units, p.perUnit], [6, 500]);
    p = parseSize('Jungle Oats Original 1Kg x 2'); assert.deepStrictEqual([p.units, p.perUnit], [2, 1000]);
    p = parseSize("Ingram's Camphor Cream Herbal - (4 x 500ml)"); assert.deepStrictEqual([p.units, p.perUnit], [4, 500]);
    p = parseSize('Listerine Cool Mint Mouthwash 250ml- Pack of 3'); assert.deepStrictEqual([p.units, p.perUnit], [3, 250]);
    p = parseSize('Nivea Men ... Spray 150 ml (Pack of 6)'); assert.deepStrictEqual([p.units, p.perUnit], [6, 150]);
    p = parseSize('Colgate Mouthwash Pack of 12 x 500 ml'); assert.deepStrictEqual([p.units, p.perUnit], [12, 500]);
    p = parseSize('NIVEA MEN Derma Control Roll On 6x50ml'); assert.deepStrictEqual([p.units, p.perUnit], [6, 50]);
  });
  t('parseSize: units and bundles', () => {
    approx(parseSize('Listerine ... 1L').perUnit, 1000); approx(parseSize('Jungle Oats 2kg').perUnit, 2000);
    assert.strictEqual(parseSize('NIVEA MEN Anti-Age Power 2in1 Moisturiser SPF30 50ml').perUnit, 50);
    assert.ok(parseSize('Domestos Thick Bleach Original 750ml + Sunlight Dishwashing Liquid 750ml').bundle);
    assert.strictEqual(parseSize('Dis-Chem thing with no size').perUnit, null);
  });
  t('tokens: apostrophes, synonyms, stems', () => {
    assert.deepStrictEqual(tokens("Ingram's"), tokens('Ingram`s'));
    assert.ok(tokens('Deodorant Spray').includes('deo'));
    assert.ok(!tokens('750ml Jungle Oats').includes('750ml'));
  });
  t('in-page extractors are valid JavaScript', () => { for (const f of [inTakealot, inAmazon, inClicks, inDischem]) new Function('return (' + f.toString() + ')'); });

  // ---------------------------------------------------------------- Makro text
  t('Makro price strings', () => {
    assert.deepStrictEqual(parseMakroPrice('R 26500R 2990011% off'), { price: 265, was: 299 });
    assert.deepStrictEqual(parseMakroPrice('R 4995R 899544% off'), { price: 49.95, was: 89.95 });
    assert.deepStrictEqual(parseMakroPrice('R 9739'), { price: 97.39, was: null });
    assert.deepStrictEqual(parseMakroPrice('R 1,29500R 1,30000'), { price: 1295, was: 1300 });
  });
  t('Makro page text', () => {
    const text = 'Showing 1 - 40 of 330 results for "listerine"\nSort By\nListerine Cool Mint Mouthwash - Mint\n750 ml\nR 26500R 2990011% off\nAvailable online only\nAdd to Cart\nListerine Mouthwash Total Care - Clean Mint\n750 ml\nR 9739\n(79)\n Delivery\nAdd to Cart\nLISTERINE_3 Cool Mint - Cool Mint\n750 ml\nR 13995\n(27)\nListerine Mouth Wash X5 - Coolmint\nPack of 5 x 250 ml\nR 49500R 6990029% off';
    const r = parseMakroText(text, []);
    assert.strictEqual(r.length, 4);
    assert.deepStrictEqual([r[1].price, r[2].price, r[3].price, r[0].was], [97.39, 139.95, 495, 299]);
    assert.strictEqual(parseSize(r[3].title).units, 5);
  });

  // ---------------------------------------------------------------- matching on real listings
  const ITEMS = [
    { name: 'Nivea Men Anti-Age face anti age cream', brand: 'Nivea', quantity: 3, alternatives: 'No', search: 'nivea men anti-age', must: 'men,anti,age' },
    { name: 'Listerine cool mint', brand: 'Listerine', size: '750ml min', quantity: 6, alternatives: 'No', must: 'cool,mint' },
    { name: 'Jungle Oats The Original Favourite', brand: 'Jungle Oats', variant: 'The Original Favourite', size: '1 or 2kg', quantity: '12kg', alternatives: 'No', must: 'jungle,oat' },
    { name: 'Mitchum Advanced Gel', brand: 'Mitchum', variant: 'any variant', quantity: 6, alternatives: 'No', must: 'gel' },
    { name: 'Nivea men black and white anti perspirant', brand: 'Nivea', variant: 'Invisible Fresh Deodorant Spray', quantity: 5, alternatives: 'No', must: 'black,white,invisible,fresh,spray' },
    { name: 'Domestos Unstoppable Extended Power Plain (750 ml)', brand: 'Domestos', quantity: 5, alternatives: 'No', must: 'unstoppable' },
    { name: 'Handy Andy Cream Lavender Clean Boost (750 ml)', brand: 'Handy Andy', quantity: 5, alternatives: 'No', must: 'lavender,cream' },
    { name: 'Duck Deep Action Toilet Cleaner', brand: 'Duck', variant: 'Any variant', quantity: 6, alternatives: 'Yes', must: 'deep,action' },
    { name: "Ingram's Herbal Camphor Cream 450gr min", brand: "Ingram's", size: '450g min', quantity: 2, alternatives: 'No', must: 'camphor,cream' },
    { name: 'Toilet rim', brand: '', variant: 'Any reputable brand', quantity: 6, alternatives: 'Yes', must: 'rim' },
  ].map((x, i) => prepareItem(x, i));
  const L = (title, price, was) => ({ title, price, was: was || null, promo: '', url: 'https://example.test/' + encodeURIComponent(title) });
  const find = (rows, sub) => rows.find((r) => r.product.includes(sub));

  t('item 1: Nivea Men Anti-Age', () => {
    const rows = pick(ITEMS[0], 'Takealot', [L('NIVEA MEN Anti-Age Power 2in1 Moisturiser SPF30 50ml, Hyaluronic Acid', 240), L('NIVEA MEN Sensitive Face Wash, with Chamomile and Vitamin E, 100ml', 105, 120), L('Nivea Body Q10 Argan Oil Lotion 400ml', 161.99)]);
    assert.strictEqual(rows.filter((r) => r.match === 'Exact').length, 1); approx(rows[0].cost, 720);
    assert.strictEqual(pick(ITEMS[0], 'Clicks', [L('Nivea Men Even Tone Creme 75ml', 79.99)])[0].product, 'Not found');
  });
  t('item 2: Listerine size rule (750ml min)', () => {
    const rows = pick(ITEMS[1], 'Amazon', [L('Listerine Cool Mint Mouthwash, Intense Mint, 750ml', 119.99, 139.99), L('Listerine Cool Mint Daily Mouthwash, Intense Mint, 1L', 129.9, 149.99), L('Listerine, Cool Mint, Daily Mouthwash, 500ml', 49.95, 89.99), L('Listerine Cool Mint Daily Mouthwash For A Cleaner & Fresher', 81.89, 129.99)]);
    const ex = rows.filter((r) => r.match === 'Exact');
    assert.strictEqual(ex.length, 2); approx(ex[0].cost, 719.94); assert.strictEqual(ex[0].special, 'SPECIAL');
    assert.ok(find(rows, '500ml').match === 'Alternative' && /Smaller/.test(find(rows, '500ml').notes));
    assert.ok(/Size not shown/.test(find(rows, 'Cleaner & Fresher').notes));
  });
  t('item 3: Jungle Oats cost for 12kg total', () => {
    const rows = pick(ITEMS[2], 'x', [L('Jungle Oats Pillow Breakfast Cereal - 2kg, 50 Servings Approx.', 109), L('Jungle Oats Original Breakfast Cereal - 1kg, 25 Servings Approx.', 44.95, 55.99), L('Jungle Oats Original 1Kg x 2', 179), L('Purity Jungle Oats Original 500g', 48.99), L('Jungle Oatso Easy Original Instant Oatmeal - 10 x 50g Sachets', 69.99)]);
    approx(find(rows, '1kg, 25').cost, 539.4); approx(find(rows, '2kg').cost, 654); approx(find(rows, '1Kg x 2').cost, 1074);
    assert.strictEqual(find(rows, '500g').match, 'Alternative'); assert.ok(!find(rows, 'Oatso') || find(rows, 'Oatso').match !== 'Exact');
  });
  t('item 4: Mitchum, any variant', () => {
    const rows = pick(ITEMS[3], 'x', [L('Mitchum Advanced Gel Men - Ice Fresh - 63g', 98, 114), L('Mitchum Power Gel Men 63g Clear Control', 103.49, 114.99), L('Mitchum Invisible Solid Men 76g', 125.99, 139.99)]);
    assert.strictEqual(rows.filter((r) => r.match === 'Exact').length, 2); assert.ok(!find(rows, 'Invisible Solid'));
  });
  t('item 5: Nivea B&W spray vs roll-on', () => {
    const rows = pick(ITEMS[4], 'x', [L('NIVEA MEN Black & White Invisible Fresh Anti-perspirant Deo Spray, 150ml', 49), L('Nivea Men Invisible Black and White Fresh Mist Deodorant Spray 150 ml (Pack of 6)', 219), L('NIVEA MEN Black & White Invisible Fresh Anti-perspirant Roll-On Deo, 50ml', 33)]);
    const six = find(rows, 'Pack of 6'); approx(six.unitPrice, 36.5); assert.strictEqual(six.bulk, 'BULK'); approx(six.cost, 182.5);
    assert.strictEqual(find(rows, 'Roll-On').match, 'Alternative');
  });
  t('item 7: Handy Andy packs and variant-less Dis-Chem listing', () => {
    const rows = pick(ITEMS[6], 'x', [L('Handy Andy Lavender Cleaning Cream 750ml (Pack of 5)', 190), L('Handy Andy Lavender Multipurpose Cleaning Cream 750ml', 29.99), L('Handy Andy 750ml', 29.69, 32.99)]);
    approx(find(rows, 'Pack of 5').unitPrice, 38); assert.strictEqual(find(rows, 'Handy Andy 750ml').match, 'Alternative');
  });
  t('item 9: Ingram\'s 450 min', () => {
    const rows = pick(ITEMS[8], 'x', [L("Ingram's Camphor Cream Herbal - (4 x 500ml)", 450), L("Ingram's Caring Repair Herbal Camphor Cream - 400ml", 59.99), L('Ingram`s Caring Repair Herbal Camphor Cream 400ml', 59.99), L('Ingram\'s Camphor Cream Herbal - 650ml', 79.99)]);
    assert.strictEqual(rows.filter((r) => r.match === 'Exact').length, 2); assert.ok(rows.some((r) => r.match === 'Alternative' && /Smaller/.test(r.notes)));
    approx(find(rows, '4 x 500ml').unitPrice, 112.5);
  });
  t('item 10: toilet rim, any brand', () => {
    const rows = pick(ITEMS[9], 'x', [L('Harpic 6 x 35g Fresh Power 6 Toilet Rim Cleaner, Forest Dew', 219, 239), L('Domestos Power 5 Ocean Toilet Rim Block 50g', 29.99), L('Harpic White And Shine 750ml', 39.99)]);
    assert.strictEqual(rows.filter((r) => r.match === 'Exact').length, 2); approx(find(rows, 'Domestos').cost, 179.94); approx(find(rows, '6 x 35g').cost, 219);
  });
  t('outlier flag: Domestos R238 single-unit listing', () => {
    const all = [].concat(
      pick(ITEMS[5], 'Amazon', [L('Domestos Extended Power Unstoppable Thick Bleach, 750ml', 238), L('Domestos Lavender Multipurpose Stain Removal Thick Bleach 750ml', 36), L('Domestos Lemon Multipurpose Stain Removal Thick Bleach 750ml', 35.99)]),
      pick(ITEMS[5], 'Clicks', [L('Domestos Multipurpose Stain Removal Thick Bleach Cleaner Lavender 750ml', 38.99)]),
    );
    const s = summarise([ITEMS[5]], all);
    assert.ok(find(all, 'Unstoppable').outlier && /multipack/.test(find(all, 'Unstoppable').notes));
    assert.ok(s.entries[0].best.outlier, 'outlier used only as a fallback when nothing else is Exact');
  });

  // ---------------------------------------------------------------- Excel round trip
  await t('Excel: sample list loads, results export re-reads', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
    const sample = path.join(__dirname, '..', 'sample', 'shopping_list_sample.xlsx');
    const raw = await readList(sample);
    assert.strictEqual(raw.length, 10); assert.strictEqual(raw[2].quantity, '12kg');
    const items = raw.map((x, i) => prepareItem(x, i));
    assert.strictEqual(items[2].needed, 12000); assert.deepStrictEqual(items[1].spec, { min: 750, flexible: true });
    const rows = [].concat(pick(items[1], 'Amazon.co.za', [L('Listerine Cool Mint Mouthwash, Intense Mint, 750ml', 119.99, 139.99)]), pick(items[0], 'Clicks', []));
    const out = path.join(dir, 'out.xlsx');
    const sum = await writeResults(out, { items, rows, stores: ['Amazon.co.za', 'Clicks'], storeNotes: ['Makro: skipped'] });
    approx(sum.entries[1].best.cost, 719.94);
    const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(out);
    assert.deepStrictEqual(wb.worksheets.map((w) => w.name), ['Best Prices', 'Shopping List', 'Price Comparison', 'Notes']);
    assert.strictEqual(wb.getWorksheet('Price Comparison').getRow(2).getCell(11).value, 'SPECIAL');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\n${passed} passed${process.exitCode ? ', with FAILURES' : ''}`);
})();
