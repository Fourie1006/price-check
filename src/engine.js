'use strict';
const { prepareItem, pick } = require('./match');
const { BlockedError } = require('./stores');
const { sleep } = require('./session');

function queriesFor(item, plan) {
  const seen = new Set();
  const out = [];
  for (const kind of plan) {
    const q = (item.queries[kind] || '').trim();
    if (q && !seen.has(q.toLowerCase())) { seen.add(q.toLowerCase()); out.push(q); }
  }
  return out;
}

// sessions: Map(storeId -> StoreSession)
// hooks: { onProgress(msg), onBlocked(store) -> 'retry'|'skip', cancelled() -> bool }
async function runSearch({ items, stores, sessions, hooks }) {
  const rows = [];
  const notes = [];
  let step = 0;
  const totalSteps = items.length * stores.length;

  for (const store of stores) {
    const session = sessions.get(store.id);
    let skipped = false;
    let failures = 0;
    let autoTries = 0;
    const pace = store.pace || 400;
    try {
      await session.ensure();
    } catch (e) {
      notes.push(`${store.name}: could not open the site (${e.message}).`);
      skipped = true;
    }
    for (const item of items) {
      if (hooks.cancelled()) return { rows, notes, cancelled: true };
      step++;
      hooks.onProgress({ store: store.name, item: item.name, step, totalSteps });
      if (skipped) {
        rows.push({ itemId: item.id, store: store.name, product: 'Not checked', match: '', notes: 'Store skipped.', url: '' });
        continue;
      }
      let raw = [];
      for (const q of queriesFor(item, store.plan)) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await store.search(session, q);
            if (r && r.blocked) throw new BlockedError(store.name);
            raw = raw.concat(Array.isArray(r) ? r : []);
            autoTries = 0;
            break;
          } catch (e) {
            if (e && e.blocked) {
              // First try to ride out a rate limit / automatic browser check: wait, reload the home page, retry.
              if (autoTries < 2) {
                autoTries++;
                hooks.onProgress({ store: store.name, item: `${item.name} (waiting, ${store.name} is rate limiting)`, step, totalSteps });
                await sleep(6000 * autoTries);
                await session.reload();
                await sleep(3000);
                attempt--;
                continue;
              }
              autoTries = 0;
              const action = await hooks.onBlocked(store);
              if (action === 'skip') { skipped = true; notes.push(`${store.name}: skipped after a human check (${new Date().toLocaleTimeString()}).`); break; }
              await session.reload();
              continue;
            }
            failures++;
            if (attempt === 2) notes.push(`${store.name}: search "${q}" failed (${(e && e.message) || e}).`);
            await sleep(800);
          }
        }
        if (skipped) break;
        await sleep(pace + Math.random() * pace);
      }
      if (skipped) {
        rows.push({ itemId: item.id, store: store.name, product: 'Not checked', match: '', notes: 'Store skipped.', url: '' });
        continue;
      }
      rows.push(...pick(item, store.name, raw));
      if (failures >= 6) { notes.push(`${store.name}: too many failed searches, stopped early.`); skipped = true; }
    }
    if (store.experimental) notes.push(`${store.name}: reads the rendered page, which is the least reliable method - double-check its prices.`);
  }
  return { rows, notes, cancelled: false };
}

module.exports = { runSearch, queriesFor, prepareItem };
