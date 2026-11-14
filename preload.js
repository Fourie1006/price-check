'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  openList: () => ipcRenderer.invoke('list:open'),
  saveSample: () => ipcRenderer.invoke('list:sample'),
  stores: () => ipcRenderer.invoke('stores:list'),
  run: (items, storeIds) => ipcRenderer.invoke('search:run', { items, storeIds }),
  cancel: () => ipcRenderer.invoke('search:cancel'),
  resume: (action) => ipcRenderer.invoke('search:resume', action),
  exportXlsx: (payload) => ipcRenderer.invoke('results:export', payload),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  onProgress: (cb) => ipcRenderer.on('search:progress', (_e, m) => cb(m)),
  onBlocked: (cb) => ipcRenderer.on('search:blocked', (_e, m) => cb(m)),
});
