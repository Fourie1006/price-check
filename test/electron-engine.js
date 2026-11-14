'use strict';
// Run with: electron test/electron-engine.js  (needs a display or xvfb)
const { app } = require('electron');
const http = require('http');
const assert = require('assert');
const { StoreSession } = require('../src/session');
const { runSearch } = require('../src/engine');
const { prepareItem, summarise } = require('../src/match');

let hits = 0;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/s?')) {
    hits++;
    if (hits === 1) { res.statusCode = 202; return res.end(''); }       // simulated bot challenge
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify([{ title: 'Listerine Cool Mint Mouthwash 750ml', price: 119.99, was: 139.99 }, { title: 'Listerine Cool Mint 500ml', price: 49.95 }]));
  }
  res.setHeader('content-type', 'text/html');
  res.end('<html><head><title>Fake store</title></head><body>home</body></html>');
});

app.whenReady().then(() => server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const store = {
    id: 'fake', name: 'Fake Store', home: `http://127.0.0.1:${port}/`, plan: ['full'], pace: 50,
    search: (s, q) => s.evalFn(function (q) { return fetch('/s?q=' + encodeURIComponent(q)).then(async (r) => (r.status === 202 ? { blocked: true } : r.json())); }, q),
  };
  const sessions = new Map([['fake', new StoreSession(store)]]);
  const item = prepareItem({ name: 'Listerine cool mint', brand: 'Listerine', size: '750ml min', quantity: 6, alternatives: 'No', must: 'cool,mint' }, 0);
  const progress = [];
  const t0 = Date.now();
  try {
    const res = await runSearch({ items: [item], stores: [store], sessions, hooks: { cancelled: () => false, onProgress: (m) => progress.push(m.item), onBlocked: async () => { throw new Error('should have auto-recovered without asking the user'); } } });
    const s = summarise([item], res.rows);
    assert.strictEqual(res.rows.filter((r) => r.match === 'Exact').length, 1);
    assert.ok(Math.abs(s.entries[0].best.cost - 719.94) < 0.011);
    assert.ok(hits >= 2, 'retried after the simulated 202 challenge');
    console.log('ENGINE PASS', 'requests=' + hits, 'elapsed=' + Math.round((Date.now() - t0) / 1000) + 's', 'best=R' + s.entries[0].best.cost.toFixed(2));
    process.exitCode = 0;
  } catch (e) { console.log('ENGINE FAIL', e.stack); process.exitCode = 1; }
  sessions.get('fake').close(); server.close(); app.exit(process.exitCode);
}));
