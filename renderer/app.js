'use strict';
const $ = (id) => document.getElementById(id);
const R = (n) => 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let items = [];
let last = null;

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e[k] = v; }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
const td = (content, cls) => { const c = el('td', cls ? { class: cls } : null); if (content instanceof Node) c.append(content); else c.textContent = content == null ? '' : String(content); return c; };
const chip = (t, cls) => el('span', { class: 'chip ' + cls, text: t });
function linkTo(text, url) { const a = el('a', { class: 'link', text }); a.addEventListener('click', () => url && window.api.openExternal(url)); return a; }

function renderList() {
  const t = $('list-table');
  const tb = t.querySelector('tbody');
  tb.textContent = '';
  for (const it of items) {
    const tr = el('tr');
    tr.append(td(it.id), td(it.name), td(it.brand || 'any'), td(it.size || ''), td(it.qtyLabel), td(it.alternativesOK ? 'Yes' : 'No'));
    tb.append(tr);
  }
  t.hidden = !items.length;
  $('btn-run').disabled = !items.length;
}

async function init() {
  const stores = await window.api.stores();
  const box = $('stores');
  box.classList.add('stores');
  for (const s of stores) {
    const cb = el('input', { type: 'checkbox', checked: true, id: 'st-' + s.id });
    cb.dataset.id = s.id;
    box.append(el('label', null, cb, document.createTextNode(s.name + (s.experimental ? ' (experimental)' : ''))));
  }
  window.api.onProgress((m) => {
    $('status').textContent = `${m.store}: ${m.item}`;
    $('bar-fill').style.width = Math.round((m.step / m.totalSteps) * 100) + '%';
  });
  window.api.onBlocked((m) => {
    $('modal-title').textContent = m.store + ' wants a human check';
    $('modal-text').textContent = `A ${m.store} window has opened. Complete the check there (for example press and hold the button), then click Continue. Or skip ${m.store} and carry on with the other stores.`;
    $('modal').hidden = false;
  });
}

$('btn-open').addEventListener('click', async () => {
  $('list-error').hidden = true;
  const r = await window.api.openList();
  if (r.canceled) return;
  if (r.error) { $('list-error').textContent = r.error; $('list-error').hidden = false; return; }
  items = r.items;
  $('list-path').textContent = r.path;
  renderList();
});
$('btn-sample').addEventListener('click', () => window.api.saveSample());
$('btn-continue').addEventListener('click', () => { $('modal').hidden = true; window.api.resume('retry'); });
$('btn-skip').addEventListener('click', () => { $('modal').hidden = true; window.api.resume('skip'); });
$('btn-cancel').addEventListener('click', () => { $('status').textContent = 'Cancelling...'; window.api.cancel(); });

$('btn-run').addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('#stores input:checked')).map((c) => c.dataset.id);
  if (!ids.length) { $('status').textContent = 'Tick at least one store.'; return; }
  $('btn-run').disabled = true; $('btn-open').disabled = true; $('btn-cancel').hidden = false;
  $('bar').hidden = false; $('bar-fill').style.width = '0';
  $('status').textContent = 'Starting...';
  try {
    last = await window.api.run(items, ids);
    last.items = items;
    $('status').textContent = last.cancelled ? 'Cancelled - partial results shown.' : 'Done.';
    renderResults();
  } catch (e) {
    $('status').textContent = 'Something went wrong: ' + e.message;
  } finally {
    $('btn-run').disabled = false; $('btn-open').disabled = false; $('btn-cancel').hidden = true; $('bar').hidden = true;
  }
});

function flags(r) {
  const f = el('span');
  if (r.special) f.append(chip(r.special, 'special'));
  if (r.bulk) f.append(chip(r.bulk + (r.units ? ' x' + r.units : ''), 'bulk'));
  return f;
}

function renderResults() {
  $('results-card').hidden = false;
  const tb = $('results-table').querySelector('tbody');
  tb.textContent = '';
  for (const e of last.summary.entries) {
    const b = e.best, a = e.alt;
    const tr = el('tr');
    tr.append(td(e.item.id), td(e.item.name));
    if (b) {
      const prod = el('div'); prod.append(linkTo(b.product, b.url));
      if (b.promo) prod.append(el('div', { class: 'muted small', text: b.promo }));
      if (b.notes) prod.append(el('div', { class: 'muted small', text: b.notes }));
      tr.append(td(b.store), td(prod), td(R(b.cost), 'num'), td(R(b.price) + (b.units > 1 ? ' / ' + b.units : ''), 'num'), td(flags(b)));
    } else {
      tr.append(td(el('span', { class: 'nf', text: 'No exact match' })), td(''), td(''), td(''), td(''));
    }
    tr.append(td(a ? `${a.store}: ${a.product} (${R(a.cost)})` : ''));
    tb.append(tr);
  }
  $('total').textContent = 'Basket total (cheapest exact match per item): ' + R(last.summary.total) + (last.summary.missing ? `  - ${last.summary.missing} item(s) not found` : '');
  const notes = $('notes'); notes.textContent = '';
  for (const n of last.notes || []) notes.append(el('div', { text: n }));

  const all = $('all'); all.textContent = '';
  for (const it of last.items) {
    const rows = last.rows.filter((r) => r.itemId === it.id);
    const d = el('details', null, el('summary', { text: `${it.id}. ${it.name}  (${rows.filter((r) => r.match).length} listings)` }));
    const t = el('table'); const hr = el('tr');
    for (const h of ['Store', 'Product', 'Match', 'Price', 'Cost for qty', 'Flags']) hr.append(el('th', { text: h }));
    t.append(el('thead', null, hr));
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      if (!r.match) tr.append(td(r.store), td(el('span', { class: 'nf', text: r.product + (r.notes ? ' - ' + r.notes : '') })), td(''), td(''), td(''), td(''));
      else {
        const m = r.match === 'Alternative' ? chip('Alternative', 'alt') : document.createTextNode('Exact');
        const prod = el('div'); prod.append(linkTo(r.product, r.url)); if (r.notes) prod.append(el('div', { class: 'muted small', text: r.notes }));
        tr.append(td(r.store), td(prod), td(m), td(R(r.price) + (r.was ? ' (was ' + R(r.was) + ')' : ''), 'num'), td(r.cost == null ? '' : R(r.cost), 'num'), td(flags(r)));
      }
      tbody.append(tr);
    }
    t.append(tbody); d.append(t); all.append(d);
  }
}

$('btn-export').addEventListener('click', async () => {
  if (!last) return;
  const r = await window.api.exportXlsx({ items: last.items, rows: last.rows, storeNames: last.storeNames, notes: last.notes });
  if (!r.canceled) $('status').textContent = 'Saved: ' + r.path;
});

init();
