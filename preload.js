const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ling', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    all: () => ipcRenderer.invoke('store:all'),
    reset: () => ipcRenderer.invoke('store:reset'),
    paths: () => ipcRenderer.invoke('store:paths'),
    openDataDir: () => ipcRenderer.invoke('store:open-data-dir'),
    exportWorkspace: () => ipcRenderer.invoke('store:export-workspace'),
    importWorkspace: () => ipcRenderer.invoke('store:import-workspace'),
  },
  panel: {
    expand: (tab) => ipcRenderer.invoke('panel:expand', tab),
    collapse: () => ipcRenderer.invoke('panel:collapse'),
    toggle: () => ipcRenderer.invoke('panel:toggle'),
    state: () => ipcRenderer.invoke('panel:state'),
    inputFocus: () => ipcRenderer.invoke('panel:input-focus'),
    inputBlur: () => ipcRenderer.invoke('panel:input-blur'),
    moveBy: (dx, dy) => ipcRenderer.invoke('panel:move-by', dx, dy),
    dragEnd: () => ipcRenderer.invoke('panel:drag-end'),
    saveBounds: () => ipcRenderer.invoke('panel:save-bounds'),
    listDisplays: () => ipcRenderer.invoke('panel:list-displays'),
  },
  todo: {
    list: () => ipcRenderer.invoke('todo:list'),
    create: (payload) => ipcRenderer.invoke('todo:create', payload),
    update: (id, patch) => ipcRenderer.invoke('todo:update', id, patch),
    remove: (id) => ipcRenderer.invoke('todo:remove', id),
    workflows: () => ipcRenderer.invoke('todo:workflows'),
    setWorkflows: (w) => ipcRenderer.invoke('todo:set-workflows', w),
  },
  note: {
    list: () => ipcRenderer.invoke('note:list'),
    create: (payload) => ipcRenderer.invoke('note:create', payload),
    update: (id, patch) => ipcRenderer.invoke('note:update', id, patch),
    remove: (id) => ipcRenderer.invoke('note:remove', id),
  },
  link: {
    list: () => ipcRenderer.invoke('link:list'),
    create: (payload) => ipcRenderer.invoke('link:create', payload),
    update: (id, patch) => ipcRenderer.invoke('link:update', id, patch),
    remove: (id) => ipcRenderer.invoke('link:remove', id),
  },
  pomodoro: {
    get: () => ipcRenderer.invoke('pomodoro:get'),
    save: (data) => ipcRenderer.invoke('pomodoro:save', data),
  },
  paper: {
    info: () => ipcRenderer.invoke('paper:info'),
    scan: () => ipcRenderer.invoke('paper:scan'),
    archive: (payload) => ipcRenderer.invoke('paper:archive', payload),
    archiveMany: (list) => ipcRenderer.invoke('paper:archive-many', list),
    list: () => ipcRenderer.invoke('paper:list'),
    rescanSummary: () => ipcRenderer.invoke('paper:rescan-summary'),
    open: (p) => ipcRenderer.invoke('paper:open', p),
    ignore: (payload) => ipcRenderer.invoke('paper:ignore', payload),
    unignore: (payload) => ipcRenderer.invoke('paper:unignore', payload),
    listIgnored: () => ipcRenderer.invoke('paper:list-ignored'),
    pdfHints: (filePath) => ipcRenderer.invoke('paper:pdf-hints', filePath),
  },
  app: {
    notify: (payload) => ipcRenderer.invoke('app:notify', payload),
    version: () => ipcRenderer.invoke('app:version'),
  },
  ai: {
    sessions: () => ipcRenderer.invoke('ai:sessions'),
    createSession: (title) => ipcRenderer.invoke('ai:create-session', title),
    renameSession: (id, title) => ipcRenderer.invoke('ai:rename-session', id, title),
    removeSession: (id) => ipcRenderer.invoke('ai:remove-session', id),
    items: (sessionId) => ipcRenderer.invoke('ai:items', sessionId),
    add: (payload) => ipcRenderer.invoke('ai:add', payload),
    remove: (id) => ipcRenderer.invoke('ai:remove', id),
    update: (id, patch) => ipcRenderer.invoke('ai:update', id, patch),
    suggestRole: (sessionId) => ipcRenderer.invoke('ai:suggest-role', sessionId),
    clipboardText: () => ipcRenderer.invoke('ai:clipboard-text'),
    detectPaperRef: (text) => ipcRenderer.invoke('ai:detect-paper-ref', text),
  },
  events: {
    on: (channel, handler) => {
      const allowed = new Set([
        'panel:state',
        'panel:blur',
        'panel:will-expand',
        'panel:will-collapse',
        'settings:updated',
        'notify:ai',
        'panel:edge',
        'panel:orient',
        'clipboard:changed',
        'clipboard:archived',
      ]);
      if (!allowed.has(channel)) return () => {};
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
});
