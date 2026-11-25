const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
    // 拖拽进来的 File 对象拿不到路径，交给 webUtils 解析
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file) || '';
      } catch (_) {
        return '';
      }
    },
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
    closeReply: (request, decision) => ipcRenderer.invoke('window:close-reply', request, decision),
    setTheme: (isDark) => ipcRenderer.send('theme:apply', !!isDark),
    setDefaultMd: () => ipcRenderer.invoke('shell:set-default-md'),
  },
  shell: {
    showItem: (p) => ipcRenderer.invoke('shell:show-item', p),
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },
  events: {
    on: (channel, handler) => {
      const allowed = new Set([
        'app:will-close',
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
