'use strict';
// One hidden Chromium window per store. Cookies persist between runs
// (partition "persist:pc-<store>") so a human check only has to be passed once.

function chromeUA() {
  const v = process.versions.chrome || '130.0.0.0';
  const plat = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${plat}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class StoreSession {
  constructor(store) {
    this.store = store;
    this.win = null;
  }

  async ensure() {
    const { BrowserWindow } = require('electron');
    if (this.win && !this.win.isDestroyed()) return;
    this.win = new BrowserWindow({
      width: 1100,
      height: 820,
      show: false,
      title: 'Price Check - ' + this.store.name,
      webPreferences: { partition: 'persist:pc-' + this.store.id, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    this.win.webContents.setUserAgent(chromeUA());
    this.win.setMenuBarVisibility(false);
    this.win.on('close', (e) => {
      if (!this.closing) { e.preventDefault(); this.win.hide(); }
    });
    await this.load(this.store.home);
  }

  load(url, timeout = 20000) {
    return new Promise((resolve) => {
      const wc = this.win.webContents;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        wc.removeListener('did-finish-load', finish);
        wc.removeListener('did-fail-load', fail);
        resolve();
      };
      const fail = (_e, _code, _desc, _u, isMain) => { if (isMain) finish(); };
      const t = setTimeout(finish, timeout);
      wc.on('did-finish-load', finish);
      wc.on('did-fail-load', fail);
      wc.loadURL(url).catch(() => finish());
    });
  }

  evalFn(fn, arg) {
    const code = `(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`;
    return this.win.webContents.executeJavaScript(code, true);
  }

  async waitFor(fn, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { if (await this.evalFn(fn)) return true; } catch (_) { /* page still loading */ }
      await sleep(500);
    }
    return false;
  }

  async isBlocked() {
    const wc = this.win.webContents;
    const url = wc.getURL();
    const title = wc.getTitle();
    return /\/blocked|captcha|challenge/i.test(url) || /are you a human|just a moment|attention required|robot check|access denied/i.test(title);
  }

  show() { if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.focus(); } }
  hide() { if (this.win && !this.win.isDestroyed()) this.win.hide(); }
  async reload() { await this.load(this.store.home); }
  close() { this.closing = true; if (this.win && !this.win.isDestroyed()) this.win.destroy(); this.win = null; }
}

module.exports = { StoreSession, sleep };
