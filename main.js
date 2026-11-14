'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { STORES } = require('./src/stores');
const { StoreSession } = require('./src/session');
const { runSearch } = require('./src/engine');
const { prepareItem, summarise } = require('./src/match');
const { readList, writeTemplate, writeResults } = require('./src/excel');

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

app.on('window-all-closed', () => { closeSessions(); app.quit(); });
app.on('before-quit', closeSessions);

ipcMain.handle('stores:list', () => STORES.map((s) => ({ id: s.id, name: s.name, experimental: !!s.experimental })));

ipcMain.handle('list:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose your shopping list', filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try {
    const raw = await readList(r.filePaths[0]);
    return { path: r.filePaths[0], items: raw.map((x, i) => prepareItem(x, i)) };
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
  const stores = STORES.filter((s) => storeIds.includes(s.id));
  for (const s of stores) sessions.set(s.id, new StoreSession(s));
  const hooks = {
    cancelled: () => cancelFlag,
    onProgress: (m) => win && win.webContents.send('search:progress', m),
    onBlocked: (store) => new Promise((resolve) => {
      blockedResolver = resolve;
      sessions.get(store.id).show();
      win && win.webContents.send('search:blocked', { store: store.name });
    }),
  };
  try {
    const res = await runSearch({ items, stores, sessions, hooks });
    return { rows: res.rows, notes: res.notes, cancelled: res.cancelled, storeNames: stores.map((s) => s.name), summary: summarise(items, res.rows) };
  } finally {
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
  await writeResults(r.filePath, { items, rows, stores: storeNames, storeNotes: notes });
  shell.showItemInFolder(r.filePath);
  return { path: r.filePath };
});

ipcMain.handle('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
