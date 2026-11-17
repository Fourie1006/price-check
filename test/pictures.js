'use strict';
// Tests for the picture search: reading pictures from Excel, OCR, picture comparison and matching.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { readList } = require('../src/excel');
const { prepareItem, pick, evaluate } = require('../src/match');
const { ImageMatcher } = require('../src/imagematch');
const { Clip, features, similarity } = require('../src/vision');
const THRESH = require('../src/thresholds');

const FIX = path.join(__dirname, 'fixtures');
const fx = (n) => fs.readFileSync(path.join(FIX, n));
let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); process.exitCode = 1; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-pics-'));

(async () => {
  // ------------------------------------------------------------ Excel pictures
  const floatingFile = path.join(tmp, 'floating.xlsx');
  await t('reads a picture placed over the cells, a picture-only row and a picture file column', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('list');
    ws.addRow(['name', 'brand', 'quantity', 'picture']);
    ws.addRow(['Dettol hand wash', 'Dettol', 2, '']);            // row 2: has a floating picture
    ws.addRow(['', '', 1, '']);                                    // row 3: picture only
    ws.addRow(['Colgate Plax', 'Colgate', 1, 'colgate_red.png']); // row 4: picture by file name
    ws.addRow(['Plain item', '', 1, '']);                          // row 5: no picture
    const id1 = wb.addImage({ buffer: fx('dettol_green.png'), extension: 'png' });
    const id2 = wb.addImage({ buffer: fx('listerine_front.png'), extension: 'png' });
    ws.addImage(id1, { tl: { col: 5, row: 1 }, ext: { width: 80, height: 100 } });
    ws.addImage(id2, { tl: { col: 5, row: 2 }, ext: { width: 80, height: 100 } });
    await wb.xlsx.writeFile(floatingFile);
    fs.copyFileSync(path.join(FIX, 'colgate_red.png'), path.join(tmp, 'colgate_red.png'));
    const items = await readList(floatingFile);
    assert.strictEqual(items.length, 4);
    assert.ok(items[0].image && items[0].image.buffer.length > 100, 'row 2 picture');
    assert.strictEqual(items[1].name, ''); assert.ok(items[1].image, 'picture-only row');
    assert.ok(items[2].image && items[2].image.from === 'colgate_red.png', 'file column');
    assert.ok(!items[3].image);
    const p = prepareItem(items[1], 1);
    assert.strictEqual(p.hasImage, true); assert.strictEqual(p.name, '');
  });

  await t('reports a missing picture file', async () => {
    const f = path.join(tmp, 'missing.xlsx');
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('l');
    ws.addRow(['name', 'picture']); ws.addRow(['Thing', 'nope.png']);
    await wb.xlsx.writeFile(f);
    const items = await readList(f);
    assert.ok(/not found/i.test(items[0].pictureError));
  });

  await t('reads a picture placed IN a cell (Excel rich value layout)', async () => {
    // Build a normal workbook, then add the parts Excel writes for "Place in Cell" pictures.
    const f = path.join(tmp, 'incell.xlsx');
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('l');
    ws.addRow(['name', 'picture']); ws.addRow(['Listerine', '']); ws.addRow(['Dettol', '']);
    await wb.xlsx.writeFile(f);
    const zip = await JSZip.loadAsync(fs.readFileSync(f));
    zip.file('xl/media/image7.png', fx('dettol_green.png'));
    zip.file('xl/richData/richValueRel.xml', '<?xml version="1.0"?><richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><rel r:id="rId1"/></richValueRels>');
    zip.file('xl/richData/_rels/richValueRel.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image7.png"/></Relationships>');
    zip.file('xl/richData/rdrichvaluestructure.xml', '<?xml version="1.0"?><rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>');
    zip.file('xl/richData/rdrichvalue.xml', '<?xml version="1.0"?><rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><rv s="0"><v>0</v><v>5</v></rv></rvData>');
    zip.file('xl/metadata.xml', '<?xml version="1.0"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000"/></metadataTypes><futureMetadata name="XLRICHVALUE" count="1"><bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="0"/></ext></extLst></bk></futureMetadata><valueMetadata count="1"><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>');
    let sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    sheet = sheet.replace(/<c r="B3"[^>]*\/>|<c r="B3"[^>]*>.*?<\/c>/, '<c r="B3" t="e" vm="1"><v>#VALUE!</v></c>');
    if (!/vm="1"/.test(sheet)) sheet = sheet.replace(/<row r="3"([^>]*)>/, '<row r="3"$1><c r="B3" t="e" vm="1"><v>#VALUE!</v></c>');
    zip.file('xl/worksheets/sheet1.xml', sheet);
    fs.writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer' }));
    const items = await readList(f);
    assert.ok(!items[0].image, 'row 2 has none');
    assert.ok(items[1].image && items[1].image.buffer.equals(fx('dettol_green.png')), 'row 3 picture found');
  });

  // ------------------------------------------------------------ OCR
  await t('OCR reads brand and product from a pack, also when tilted', async () => {
    const { readText, summarise, stopOcr } = require('../src/ocr');
    const a = summarise(await readText(fx('listerine_front.png')));
    assert.strictEqual(a.brandGuess.toLowerCase(), 'listerine');
    assert.ok(/mouthwash/i.test(a.name) && /mint/i.test(a.name), a.name);
    assert.deepStrictEqual(a.sizes, ['500ml']);
    const b = summarise(await readText(fx('listerine_angle.jpg')));
    assert.strictEqual(b.brandGuess.toLowerCase(), 'listerine');
    const c = summarise(await readText(fx('dettol_green.png')));
    assert.ok(/dettol/i.test(c.name) && /wash/i.test(c.name), c.name);
    await stopOcr();
  });

  // ------------------------------------------------------------ comparison
  await t('basic comparison ranks the same product above other products', async () => {
    const q = await features(fx('listerine_front.png'));
    const qa = await features(fx('listerine_angle.jpg'));
    const s = async (n, from) => similarity(from, await features(fx(n))).score;
    for (const from of [q, qa]) {
      const same = await s('store_listerine.jpg', from);
      for (const other of ['store_listerine_total.jpg', 'store_colgate.jpg', 'store_dettol.jpg', 'store_yellow.jpg']) assert.ok(same > await s(other, from) + 0.05, `${other} should score lower`);
      assert.ok(same >= THRESH.basic.exact - 0.05, 'same product near the exact threshold: ' + same);
    }
  });

  await t('model loader: downloads, loads, embeds, and falls back cleanly', async () => {
    const bytes = fs.readFileSync(path.join(FIX, 'tiny_vision.onnx'));
    const mk = (ok) => async () => (ok ? { ok: true, status: 200, headers: { get: () => String(bytes.length) }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }) } : { ok: false, status: 404, headers: { get: () => null } });
    const clip = new Clip({ dir: path.join(tmp, 'm1'), fetchImpl: mk(true), minBytes: 10 });
    assert.strictEqual(clip.has(), false);
    assert.strictEqual(await clip.load(), true, clip.error);
    assert.strictEqual(clip.has(), true);
    const f = await features(fx('listerine_front.png'), clip);
    assert.ok(f.clip && f.clip.length === 3);
    assert.strictEqual(similarity(f, await features(fx('store_listerine.jpg'), clip)).kind, 'clip');
    const bad = new Clip({ dir: path.join(tmp, 'm2'), fetchImpl: mk(false), minBytes: 10 });
    assert.strictEqual(await bad.load(), false);
    assert.ok(/404/.test(bad.error));
    assert.strictEqual(similarity(await features(fx('listerine_front.png'), bad), await features(fx('store_listerine.jpg'), bad)).kind, 'basic');
    const small = new Clip({ dir: path.join(tmp, 'm3'), fetchImpl: mk(true) }); // default minimum size rejects a truncated download
    assert.strictEqual(await small.load(), false);
  });

  // ------------------------------------------------------------ matching with pictures
  await t('evaluate: picture evidence promotes, demotes and labels listings', async () => {
    const it = prepareItem({ name: 'Listerine cool mint', brand: 'Listerine', must: 'cool,mint', alternatives: 'No', image: { buffer: Buffer.alloc(1) } }, 0);
    const base = { title: 'Listerine Cool Mint Mouthwash 500ml', price: 80, url: 'u' };
    assert.strictEqual(evaluate(it, 'S', { ...base, vis: { score: 0.95, kind: 'clip' } }).match, 'Exact');
    const d = evaluate(it, 'S', { ...base, vis: { score: 0.6, kind: 'clip' } });
    assert.strictEqual(d.match, 'Alternative'); assert.ok(/looks different/.test(d.notes));
    assert.strictEqual(evaluate(it, 'S', { ...base, vis: { score: 0.4, kind: 'basic' } }).match, 'Exact', 'rough comparison never vetoes a name match');
    const other = { title: 'Colgate Plax Mouthwash 500ml', price: 70, url: 'o' };
    assert.strictEqual(evaluate(it, 'S', other), null, 'no picture score and no name match: not listed');
    const sim = evaluate(it, 'S', { ...other, vis: { score: 0.82, kind: 'clip' } });
    assert.strictEqual(sim.match, 'Alternative'); assert.ok(/Other brand, similar look \(82%\)/.test(sim.notes)); assert.strictEqual(sim.visual, 82);
    assert.strictEqual(evaluate(it, 'S', { ...other, vis: { score: 0.7, kind: 'clip' } }), null, 'below the similar threshold');
  });

  await t('full picture flow: name read from the picture, thumbnails compared, exact + similar found', async () => {
    // local "store" serving listing photos
    const srv = http.createServer((req, res) => { const f = path.join(FIX, req.url.slice(1)); if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(fs.readFileSync(f)); } else { res.writeHead(404); res.end(); } });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}/`;
    const fetchImage = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); };
    const item = prepareItem({ name: '', image: { buffer: fx('listerine_angle.jpg') } }, 0);
    const m = new ImageMatcher({ clip: null, fetchImage, cacheDir: tmp });
    const note = await m.prepare(item, fx('listerine_angle.jpg'));
    assert.strictEqual(note, '');
    assert.ok(/listerine/i.test(item.name) && /mint/i.test(item.name), item.name);
    assert.ok(item.alternativesOK && item.nameFromPicture);
    assert.ok(item.queries.full && item.queries.image && /listerine/i.test(item.queries.full + item.queries.image));
    const raw = [
      { title: 'Listerine Cool Mint Mouthwash 500ml', price: 79.99, img: base + 'store_listerine.jpg', url: 'a' },
      { title: 'Listerine Total Care Mouthwash 500ml', price: 99.99, img: base + 'store_listerine_total.jpg', url: 'b' },
      { title: 'Colgate Plax Mouthwash 500ml', price: 59.99, img: base + 'store_colgate.jpg', url: 'c' },
      { title: 'Sunlight Dishwashing Liquid 750ml', price: 39.99, img: base + 'store_yellow.jpg', url: 'd' },
      { title: 'Broken Image Mouthwash', price: 10, img: base + 'missing.jpg', url: 'e' },
    ];
    await m.score(item, raw, { home: 'https://example.test/' });
    assert.strictEqual(m.stats.fail, 1);
    const rows = pick(item, 'Test store', raw);
    const by = (u) => rows.find((r) => r.url === u);
    assert.strictEqual(by('a').match, 'Exact'); assert.ok(by('a').visual > 0);
    assert.strictEqual(by('b').match, 'Alternative'); assert.ok(/Same brand/.test(by('b').notes));
    assert.ok(!by('d'), 'unrelated product is not listed');
    assert.ok(rows.every((r) => r.match !== 'Exact' || r.url === 'a'));
    await m.close();
    srv.close();
  });

  console.log(`\n${passed} picture tests passed`);
})();
