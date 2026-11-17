'use strict';
// Finds pictures in an .xlsx shopping list.
//  1. Pictures placed over the cells (Insert > Pictures > Place Over Cells): read through ExcelJS.
//  2. Pictures placed in a cell (Place in Cell, Excel 365): stored as "rich values"; read from the zip.
//  3. A "picture" column holding a file path is handled in excel.js.
const path = require('path');
const JSZip = require('jszip');

const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? m[1] : null; };
const all = (xml, re) => Array.from(xml.matchAll(re));

async function text(zip, name) { const f = zip.file(name); return f ? f.async('string') : null; }

// Returns Map<rowNumber, Buffer> for pictures placed in cells of the first worksheet.
async function inCellImages(filePath) {
  const out = new Map();
  let zip;
  try { zip = await JSZip.loadAsync(require('fs').readFileSync(filePath)); } catch (e) { return out; }
  const rv = await text(zip, 'xl/richData/rdrichvalue.xml');
  if (!rv) return out;
  try {
    const meta = await text(zip, 'xl/metadata.xml');
    const structXml = await text(zip, 'xl/richData/rdrichvaluestructure.xml');
    const relXml = await text(zip, 'xl/richData/richValueRel.xml');
    const relRels = await text(zip, 'xl/richData/_rels/richValueRel.xml.rels');
    if (!meta || !structXml || !relXml || !relRels) return out;

    // rich value structures: which <v> holds the image relationship index
    const structs = all(structXml, /<s\b[^>]*>([\s\S]*?)<\/s>/g).map((m) => {
      const keys = all(m[1], /<k\b[^>]*\/>/g).map((k) => attr(k[0], 'n'));
      return keys.indexOf('_rvRel:LocalImageIdentifier');
    });
    // rich value i -> relationship index
    const rvToRel = all(rv, /<rv\b([^>]*)>([\s\S]*?)<\/rv>/g).map((m) => {
      const s = parseInt(attr(m[0].slice(0, m[0].indexOf('>') + 1), 's') || '0', 10);
      const vs = all(m[2], /<v>([^<]*)<\/v>/g).map((x) => x[1]);
      const k = structs[s];
      return k >= 0 && vs[k] != null ? parseInt(vs[k], 10) : -1;
    });
    // rel index -> media path
    const relIds = all(relXml, /<rel\b[^>]*\/>/g).map((m) => attr(m[0], 'r:id'));
    const targets = {};
    for (const m of all(relRels, /<Relationship\b[^>]*\/>/g)) targets[attr(m[0], 'Id')] = attr(m[0], 'Target');
    // vm (1-based) -> futureMetadata bk -> rich value index
    const fm = meta.match(/<futureMetadata\b[^>]*name="XLRICHVALUE"[^>]*>([\s\S]*?)<\/futureMetadata>/);
    const bkToRv = fm ? all(fm[1], /<bk>([\s\S]*?)<\/bk>/g).map((m) => { const r = m[1].match(/<xlrd:rvb\b[^>]*i="(\d+)"/); return r ? parseInt(r[1], 10) : -1; }) : [];
    const vmBlock = meta.match(/<valueMetadata\b[^>]*>([\s\S]*?)<\/valueMetadata>/);
    const vmToBk = vmBlock ? all(vmBlock[1], /<bk>([\s\S]*?)<\/bk>/g).map((m) => { const r = m[1].match(/<rc\b[^>]*v="(\d+)"/); return r ? parseInt(r[1], 10) : -1; }) : [];

    // first worksheet part
    const wbXml = await text(zip, 'xl/workbook.xml');
    const wbRels = await text(zip, 'xl/_rels/workbook.xml.rels');
    let sheetPath = 'xl/worksheets/sheet1.xml';
    if (wbXml && wbRels) {
      const first = wbXml.match(/<sheet\b[^>]*\/>/);
      const rid = first && attr(first[0], 'r:id');
      const rel = rid && all(wbRels, /<Relationship\b[^>]*\/>/g).find((m) => attr(m[0], 'Id') === rid);
      if (rel) sheetPath = 'xl/' + attr(rel[0], 'Target').replace(/^\/?(xl\/)?/, '');
    }
    const sheet = await text(zip, sheetPath);
    if (!sheet) return out;
    for (const m of all(sheet, /<c\b[^>]*>/g)) {
      const ref = attr(m[0], 'r');
      const vm = parseInt(attr(m[0], 'vm') || '0', 10);
      if (!ref || !vm) continue;
      const rvIdx = bkToRv[vmToBk[vm - 1]];
      const relIdx = rvToRel[rvIdx];
      const target = targets[relIds[relIdx]];
      if (!target) continue;
      const mediaPath = path.posix.normalize(path.posix.join('xl/richData', target));
      const f = zip.file(mediaPath);
      if (!f) continue;
      const row = parseInt(ref.replace(/^[A-Z]+/, ''), 10);
      if (!out.has(row)) out.set(row, await f.async('nodebuffer'));
    }
  } catch (e) { /* unreadable rich data: ignore, floating pictures still work */ }
  return out;
}

// Returns Map<rowNumber, Buffer> for pictures placed over the cells of a worksheet.
function floatingImages(wb, ws) {
  const out = new Map();
  let imgs = [];
  try { imgs = ws.getImages() || []; } catch (e) { return out; }
  for (const im of imgs) {
    const media = wb.getImage(im.imageId);
    const tl = im.range && im.range.tl;
    if (!media || !media.buffer || !tl) continue;
    const row = Math.floor(tl.nativeRow != null ? tl.nativeRow : tl.row) + 1;
    if (!out.has(row)) out.set(row, Buffer.from(media.buffer));
  }
  return out;
}

module.exports = { inCellImages, floatingImages };
