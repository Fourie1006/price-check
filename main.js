'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { STORES } = require('./src/stores');
const { StoreSession } = require('./src/session');
const { runSearch } = require('./src/engine');
const { prepareItem, summarise } = require('./src/match');
const { readList, writeTemplate, writeResults } = require('./src/excel');
const { Clip, thumbnail } = require('./src/vision');
const { ImageMatcher } = require('./src/imagematch');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const imageStore = new Map(); // item imageKey -> Buffer (kept here, not sent to the screen)

async function fetchImage(url, referer) {
  if (!/^https:\/\//i.test(url)) throw new Error('not an https image');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await net.fetch(url, { headers: Object.assign({ 'User-Agent': UA, Accept: 'image/*' }, referer ? { Referer: referer } : {}), signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) throw new Error('image too large');
    return buf;
  } finally { clearTimeout(timer); }
}

let win = null;
let sessions = new Map();
let cancelFlag = false;
let blockedResolver = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: 'Price Check',
    backgroundColor: '#f6f7fb',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

function closeSessions() {
  for (const s of sessions.values()) s.close();
  sessions = new Map();
}

app.whenReady().then(async () => {
  createWindow();
  if (process.argv.includes('--selftest')) {
    // Headless smoke test used by the build checks: UI loads and the bridge exists.
    win.webContents.once('did-finish-load', async () => {
      try {
        const ok = await win.webContents.executeJavaScript('typeof window.api === "object" && !!document.getElementById("btn-open")');
        const stores = await win.webContents.executeJavaScript('window.api.stores()');
        console.log('SELFTEST', ok ? 'PASS' : 'FAIL', stores.map((s) => s.id).join(','));
        app.exit(ok ? 0 : 1);
      } catch (e) { console.log('SELFTEST FAIL', e.message); app.exit(1); }
    });
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

if (process.argv.includes('--selftest-pictures')) {
  // Packaged-app check: OCR and the picture model runtime both work inside Electron.
  // usage: --selftest-pictures <png> <tiny.onnx>
  app.whenReady().then(async () => {
    try {
      const i = process.argv.indexOf('--selftest-pictures');
      const png = process.argv[i + 1], onnx = process.argv[i + 2];
      const { readText, summarise, stopOcr } = require('./src/ocr');
      const sum = summarise(await readText(fs.readFileSync(png), { cacheDir: app.getPath('temp') }));
      await stopOcr();
      const { features } = require('./src/vision');
      const clip = new Clip({ dir: path.join(app.getPath('temp'), 'pc-selftest-model'), minBytes: 10, fetchImpl: async () => { const b = fs.readFileSync(onnx); return { ok: true, status: 200, headers: { get: () => String(b.length) }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(b)); c.close(); } }) }; } });
      const loaded = await clip.load();
      const f = await features(fs.readFileSync(png), clip);
      console.log('SELFTEST-PICTURES', sum.brandGuess, JSON.stringify(sum.sizes), 'model', loaded, 'embed', f.clip ? f.clip.length : 'none', clip.error);
      app.exit(loaded && f.clip && /listerine/i.test(sum.brandGuess) ? 0 : 1);
    } catch (e) { console.log('SELFTEST-PICTURES FAIL', e.stack); app.exit(1); }
  });
}

app.on('window-all-closed', () => { closeSessions(); app.quit(); });
app.on('before-quit', closeSessions);

ipcMain.handle('stores:list', () => STORES.map((s) => ({ id: s.id, name: s.name, experimental: !!s.experimental })));

ipcMain.handle('list:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose your shopping list', filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try {
    const raw = await readList(r.filePaths[0]);
    imageStore.clear();
    const items = [];
    for (let i = 0; i < raw.length; i++) {
      const it = prepareItem(raw[i], i);
      if (raw[i].image) {
        it.imageKey = 'img' + i;
        imageStore.set(it.imageKey, raw[i].image.buffer);
        try { it.thumb = await thumbnail(raw[i].image.buffer); } catch (e) { it.thumb = ''; it.pictureError = 'The picture could not be opened (use a PNG or JPEG).'; }
      }
      items.push(it);
    }
    return { path: r.filePaths[0], items };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('list:sample', async () => {
  const src = path.join(__dirname, 'sample', 'shopping_list_sample.xlsx');
  const r = await dialog.showSaveDialog(win, { title: 'Save a sample shopping list', defaultPath: path.join(app.getPath('documents'), 'shopping_list.xlsx'), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.copyFileSync(src, r.filePath);
  shell.showItemInFolder(r.filePath);
  return { path: r.filePath };
});

ipcMain.handle('search:run', async (_e, { items, storeIds }) => {
  cancelFlag = false;
  closeSessions();
  items = items.map((x) => ({ ...x }));
  const pre = [];
  let matcher = null;
  const say = (store, item) => win && win.webContents.send('search:progress', { store, item, step: 0, totalSteps: 1 });
  const picItems = items.filter((x) => x.hasImage && imageStore.has(x.imageKey) && !x.pictureError);
  if (picItems.length) {
    const clip = new Clip({ dir: path.join(app.getPath('userData'), 'models'), fetchImpl: (u, o) => net.fetch(u, o) });
    say('Pictures', clip.has() ? 'Loading the picture model...' : 'Downloading the picture model (about 90 MB, first time only)...');
    const ok = await clip.load((got, total) => say('Pictures', `Downloading the picture model: ${Math.round(got / 1048576)} of ${total ? Math.round(total / 1048576) : '~90'} MB`));
    pre.push(ok ? 'Pictures were compared with the detailed picture model.' : `The detailed picture model could not be loaded (${clip.error}), so a simple colour and shape comparison was used. Treat picture matches as hints.`);
    matcher = new ImageMatcher({ clip: ok ? clip : null, fetchImage, cacheDir: app.getPath('userData') });
    let n = 0;
    for (const it of picItems) {
      if (cancelFlag) break;
      say('Pictures', `Reading picture ${++n} of ${picItems.length}...`);
      const note = await matcher.prepare(it, imageStore.get(it.imageKey));
      if (note) pre.push(`Picture ${it.id}: ${note}.`);
    }
  }
  for (const it of items) if (it.pictureError) pre.push(`Item ${it.id}: ${it.pictureError}`);
  const usable = items.filter((x) => x.name);
  for (const it of items) if (!it.name) pre.push(`Item ${it.id} was skipped: no name and nothing readable on the picture.`);
  items = usable;
  const stores = STORES.filter((s) => storeIds.includes(s.id));
  for (const s of stores) sessions.set(s.id, new StoreSession(s));
  const hooks = {
    cancelled: () => cancelFlag,
    onProgress: (m) => win && win.webContents.send('search:progress', m),
    visual: matcher ? (item, raw, store) => matcher.score(item, raw, store) : null,
    onBlocked: (store) => new Promise((resolve) => {
      blockedResolver = resolve;
      sessions.get(store.id).show();
      win && win.webContents.send('search:blocked', { store: store.name });
    }),
  };
  try {
    const res = await runSearch({ items, stores, sessions, hooks });
    if (matcher && matcher.stats.fail && !matcher.stats.ok) res.notes.push('The store photos could not be downloaded, so pictures were not compared. Matches rely on the name and the writing on the pack only.');
    else if (matcher && matcher.stats.fail) res.notes.push(`${matcher.stats.fail} store photo(s) could not be downloaded and were not compared.`);
    return { rows: res.rows, notes: pre.concat(res.notes), cancelled: res.cancelled, storeNames: stores.map((s) => s.name), summary: summarise(items, res.rows), items };
  } finally {
    if (matcher) await matcher.close();
    for (const s of sessions.values()) s.hide();
    closeSessions();
  }
});

ipcMain.handle('search:cancel', () => { cancelFlag = true; if (blockedResolver) { blockedResolver('skip'); blockedResolver = null; } });
ipcMain.handle('search:resume', (_e, action) => {
  for (const s of sessions.values()) s.hide();
  if (blockedResolver) { blockedResolver(action === 'skip' ? 'skip' : 'retry'); blockedResolver = null; }
});

ipcMain.handle('results:export', async (_e, { items, rows, storeNames, notes }) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, { title: 'Save results', defaultPath: path.join(app.getPath('documents'), `price-comparison-${stamp}.xlsx`), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  const withPics = items.map((it) => ({ ...it, imageBuffer: it.imageKey ? imageStore.get(it.imageKey) : null }));
  await writeResults(r.filePath, { items: withPics, rows, stores: storeNames, storeNotes: notes });
  shell.showItemInFolder(r.filePath);
  return { path: r.filePath };
});

ipcMain.handle('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
