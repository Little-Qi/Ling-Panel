const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lm', {
  file: {
    read: (file) => ipcRenderer.invoke('file:read', file),
    write: (file, content) => ipcRenderer.invoke('file:write', file, content),
    stat: (file) => ipcRenderer.invoke('file:stat', file),
    openDialog: () => ipcRenderer.invoke('file:open-dialog'),
    saveDialog: (name) => ipcRenderer.invoke('file:save-dialog', name),
    exportHtmlDialog: (name) => ipcRenderer.invoke('file:export-html-dialog', name),
    saveImage: (baseDir, dataUrl, hint) => ipcRenderer.invoke('file:save-image', baseDir, dataUrl, hint),
    current: () => ipcRenderer.invoke('app:current-file'),
  },
  recent: {
    list: () => ipcRenderer.invoke('recent:list'),
    add: (file) => ipcRenderer.invoke('recent:add', file),
    remove: (file) => ipcRenderer.invoke('recent:remove', file),
    clear: () => ipcRenderer.invoke('recent:clear'),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    confirm: (opts) => ipcRenderer.invoke('app:confirm', opts),
    close: () => ipcRenderer.invoke('window:close'),
    confirmClose: () => ipcRenderer.invoke('window:confirm-close'),
  },
  shell: {
    showItem: (p) => ipcRenderer.invoke('shell:show-item', p),
  },
  events: {
    on: (channel, handler) => {
      const allowed = new Set([
        'file:open-request',
        'file:new',
        'file:open-dialog',
        'file:save',
        'file:save-as',
        'file:export-html',
        'editor:find',
        'editor:zen',
        'editor:mode',
        'editor:command',
        'editor:help',
      ]);
      if (!allowed.has(channel)) return () => {};
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
});
