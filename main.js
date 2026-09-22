const { app, ipcMain, globalShortcut, Notification } = require('electron');
const path = require('path');

// 锁定 userData 为 ling-panel：开发/安装包共用 %APPDATA%\ling-panel\
// 避免安装包 productName(LingPanel) 导致重装后读到空目录，看起来像数据被覆盖
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'ling-panel'));
} catch (_) {}

const { Store, dataDir, storePath, deepMerge, DEFAULTS } = require('./src/main/store');
const { PanelWindow } = require('./src/main/window-manager');
const { startNotifyServer } = require('./src/main/notify-server');
const paperLib = require('./src/main/paper-lib');
const aiLog = require('./src/main/ai-log');
const clipNotify = require('./src/main/clip-notify');
const activityTracker = require('./src/main/activity-tracker');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const store = new Store();
  let panel = null;
  let notifyServer = null;
  const activity = new activityTracker.ActivityTracker({ store });

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function paperRoot() {
    const s = store.getSection('settings') || {};
    if (s.paperRoot && String(s.paperRoot).trim()) {
      try {
        paperLib.ensurePaperTree(String(s.paperRoot).trim());
        return String(s.paperRoot).trim();
      } catch (_) {}
    }
    const def = paperLib.defaultPaperRoot();
    try {
      paperLib.ensurePaperTree(def);
    } catch (_) {}
    return def;
  }

  function defaultDue() {
    const d = new Date();
    d.setHours(23, 30, 0, 0);
    return d.getTime();
  }

  function deriveTitle(content) {
    const text = String(content || '').trim();
    if (!text) return '';
    const first = text.split(/\r?\n/).find((line) => line.trim());
    if (!first) return '';
    return first.replace(/^#+\s*/, '').replace(/[*`_>]/g, '').trim().slice(0, 40);
  }

  async function fetchTitleSafe(url) {
    try {
      if (!/^https?:\/\//i.test(url)) return url;
      const u = new URL(url);
      const host = u.hostname;
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('192.168.') ||
        host.startsWith('10.') ||
        host.endsWith('.local')
      ) {
        return host;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
      clearTimeout(timer);
      const html = await res.text();
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return m ? m[1].trim() : host;
    } catch {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    }
  }

  function showNotification(payload) {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: payload.title || '灵动面板',
      body: payload.message || payload.project || '',
      silent: false,
    });
    n.show();
  }

  function registerShortcuts() {
    try {
      globalShortcut.register('Alt+Space', () => {
        if (panel) panel.toggle();
      });
    } catch (err) {
      console.error('[shortcut] register failed', err.message);
    }
  }

  function registerIpc() {
    ipcMain.handle('store:get', (_e, key) => store.getSection(key));
    ipcMain.handle('store:set', (_e, key, value) => {
      const next = store.setSection(key, value);
      if (key === 'settings' && panel) {
        panel.applySettings(value);
      }
      return next;
    });
    ipcMain.handle('store:all', () => store.load());
    ipcMain.handle('store:reset', () => store.reset());
    ipcMain.handle('store:paths', () => ({
      dataDir: dataDir(),
      workspaceFile: storePath(),
      userData: app.getPath('userData'),
      usingEnv: Boolean(process.env.LING_PANEL_DATA),
    }));
    ipcMain.handle('store:open-data-dir', () => {
      const { shell } = require('electron');
      try {
        shell.openPath(dataDir());
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('store:export-workspace', async () => {
      const { dialog } = require('electron');
      const fs = require('fs');
      const result = await dialog.showSaveDialog({
        title: '导出工作区',
        defaultPath: 'lingpanel-workspace.json',
        filters: [{ name: 'Workspace JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      try {
        fs.copyFileSync(storePath(), result.filePath);
        return { ok: true, path: result.filePath };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });
    ipcMain.handle('store:import-workspace', async () => {
      const { dialog } = require('electron');
      const fs = require('fs');
      const result = await dialog.showOpenDialog({
        title: '导入工作区（覆盖当前数据）',
        properties: ['openFile'],
        filters: [{ name: 'Workspace JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      try {
        const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
        const merged = deepMerge(DEFAULTS, raw);
        fs.mkdirSync(dataDir(), { recursive: true });
        const dest = storePath();
        const bak = dest + '.bak-' + Date.now();
        if (fs.existsSync(dest)) fs.copyFileSync(dest, bak);
        fs.writeFileSync(dest, JSON.stringify(merged, null, 2), 'utf8');
        store.cache = merged;
        return { ok: true, path: result.filePaths[0], backup: fs.existsSync(bak) ? bak : '' };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });

    ipcMain.handle('panel:expand', (_e, tab) => panel && panel.expand(tab));
    ipcMain.handle('panel:collapse', () => panel && panel.collapse());
    ipcMain.handle('panel:toggle', () => panel && panel.toggle());
    ipcMain.handle('panel:state', () => panel && panel.state);
    ipcMain.handle('panel:input-focus', () => panel && panel.enterInputFocusMode());
    ipcMain.handle('panel:input-blur', () => panel && panel.exitInputFocusMode());
    ipcMain.handle('panel:move-by', (_e, dx, dy) => {
      if (!panel) return false;
      return panel.moveBy(dx, dy);
    });
    ipcMain.handle('panel:drag-end', () => {
      if (!panel) return { ok: false };
      return panel.endDrag();
    });
    ipcMain.handle('panel:save-bounds', () => {
      if (!panel || !panel.win || panel.win.isDestroyed()) return false;
      const b = panel.win.getBounds();
      const s = panel.settings;
      const patch =
        panel.state === 'expanded'
          ? { expandedWidth: b.width, expandedHeight: b.height }
          : { compactWidth: b.width, compactHeight: b.height };
      store.setSection('settings', { ...s, ...patch });
      return true;
    });
    ipcMain.handle('panel:list-displays', () => {
      try {
        const { screen } = require('electron');
        return screen.getAllDisplays().map((d, i) => ({
          id: d.id,
          label: d.label || `显示器 ${i + 1}`,
          primary: d.id === screen.getPrimaryDisplay().id,
          bounds: d.bounds,
          workArea: d.workArea,
          scaleFactor: d.scaleFactor,
        }));
      } catch {
        return [];
      }
    });

    ipcMain.handle('todo:list', () => store.getSection('todos') || []);
    ipcMain.handle('todo:create', (_e, payload) => {
      const todos = store.getSection('todos') || [];
      const item = {
        id: uid('todo'),
        title: String(payload.title || '').trim() || '未命名待办',
        status: payload.status || 'today',
        dueAt: payload.dueAt || defaultDue(),
        note: payload.note || '',
        priority: payload.priority || 'normal',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      todos.unshift(item);
      store.setSection('todos', todos);
      return item;
    });
    ipcMain.handle('todo:update', (_e, id, patch) => {
      const todos = store.getSection('todos') || [];
      const idx = todos.findIndex((t) => t.id === id);
      if (idx < 0) return null;
      todos[idx] = { ...todos[idx], ...patch, updatedAt: Date.now() };
      store.setSection('todos', todos);
      return todos[idx];
    });
    ipcMain.handle('todo:remove', (_e, id) => {
      const todos = (store.getSection('todos') || []).filter((t) => t.id !== id);
      store.setSection('todos', todos);
      return true;
    });
    ipcMain.handle('todo:workflows', () => store.getSection('workflows'));
    ipcMain.handle('todo:set-workflows', (_e, workflows) => store.setSection('workflows', workflows));

    ipcMain.handle('note:list', () => store.getSection('notes') || []);
    ipcMain.handle('note:create', (_e, payload) => {
      try {
        const len = String((payload && (payload.content || payload.title)) || '').length;
        if (len) activity.addWriteChars(len);
      } catch (_) {}
      const notes = store.getSection('notes') || [];
      const item = {
        id: uid('note'),
        title: String(payload.title || '').trim() || deriveTitle(payload.content || '') || '未命名笔记',
        content: payload.content || '',
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      notes.unshift(item);
      store.setSection('notes', notes);
      return item;
    });
    ipcMain.handle('note:update', (_e, id, patch) => {
      const notes = store.getSection('notes') || [];
      const idx = notes.findIndex((n) => n.id === id);
      if (idx < 0) return null;
      notes[idx] = { ...notes[idx], ...patch, updatedAt: Date.now() };
      if (!notes[idx].title) {
        notes[idx].title = deriveTitle(notes[idx].content || '') || '未命名笔记';
      }
      store.setSection('notes', notes);
      return notes[idx];
    });
    ipcMain.handle('note:remove', (_e, id) => {
      const notes = (store.getSection('notes') || []).filter((n) => n.id !== id);
      store.setSection('notes', notes);
      return true;
    });

    ipcMain.handle('link:list', () => store.getSection('links') || []);
    ipcMain.handle('link:create', async (_e, payload) => {
      const links = store.getSection('links') || [];
      const url = String(payload.url || '').trim();
      if (!url) throw new Error('链接不能为空');
      const item = {
        id: uid('link'),
        url,
        title: payload.title || '',
        group: payload.group || '默认',
        favicon: '',
        createdAt: Date.now(),
      };
      if (!item.title) item.title = await fetchTitleSafe(url);
      links.unshift(item);
      store.setSection('links', links);
      return item;
    });
    ipcMain.handle('link:update', (_e, id, patch) => {
      const links = store.getSection('links') || [];
      const idx = links.findIndex((l) => l.id === id);
      if (idx < 0) return null;
      links[idx] = { ...links[idx], ...patch };
      store.setSection('links', links);
      return links[idx];
    });
    ipcMain.handle('link:remove', (_e, id) => {
      const links = (store.getSection('links') || []).filter((l) => l.id !== id);
      store.setSection('links', links);
      return true;
    });

    ipcMain.handle('pomodoro:get', () => store.getSection('pomodoro'));
    ipcMain.handle('pomodoro:save', (_e, data) => store.setSection('pomodoro', data));

    const downloadsDir = () => {
      const s = store.getSection('settings') || {};
      const custom = String(s.downloadsDir || '').trim();
      return custom || paperLib.defaultDownloads();
    };

    ipcMain.handle('paper:info', () => ({
      root: paperRoot(),
      downloads: downloadsDir(),
      topics: paperLib.TOPICS,
      venues: paperLib.VENUES,
      archiveMode: (store.getSection('settings') || {}).paperArchiveMode || 'copy',
    }));
    ipcMain.handle('paper:scan', () => {
      try {
        paperLib.ensurePaperTree(paperRoot());
        const r = paperLib.scanDownloads(paperRoot(), downloadsDir());
        return {
          ok: true,
          items: r.items,
          nonPapers: r.nonPapers,
          skippedArchived: r.skippedArchived,
          skippedIgnored: r.skippedIgnored,
          skippedCount: r.skippedCount,
          skippedIgnoredCount: r.skippedIgnoredCount,
        };
      } catch (err) {
        return {
          ok: false,
          error: String(err.message || err),
          items: [],
          nonPapers: [],
          skippedArchived: [],
          skippedIgnored: [],
          skippedCount: 0,
          skippedIgnoredCount: 0,
        };
      }
    });
    ipcMain.handle('paper:ignore', (_e, payload) => {
      try {
        const root = paperRoot();
        paperLib.addIgnore(root, {
          sourcePath: payload && payload.sourcePath,
          fp: (payload && (payload.fingerprint || payload.fp)) || '',
          fileName: payload && payload.fileName,
          reason: 'manual',
        });
        return { ok: true, ignored: paperLib.listIgnored(root) };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });
    ipcMain.handle('paper:unignore', (_e, payload) => {
      try {
        const root = paperRoot();
        paperLib.removeIgnore(root, {
          sourcePath: payload && payload.sourcePath,
          fp: (payload && (payload.fingerprint || payload.fp)) || '',
        });
        return { ok: true, ignored: paperLib.listIgnored(root) };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });
    ipcMain.handle('paper:list-ignored', () => paperLib.listIgnored(paperRoot()));
    ipcMain.handle('paper:archive', (_e, payload) => {
      try {
        return paperLib.archivePaper(paperRoot(), {
          ...payload,
          mode: (store.getSection('settings') || {}).paperArchiveMode || 'copy',
        });
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });
    ipcMain.handle('paper:archive-many', (_e, list) => {
      const mode = (store.getSection('settings') || {}).paperArchiveMode || 'copy';
      const results = [];
      for (const item of list || []) {
        try {
          results.push(paperLib.archivePaper(paperRoot(), { ...item, mode }));
        } catch (err) {
          results.push({ ok: false, error: String(err.message || err), sourcePath: item && item.sourcePath });
        }
      }
      return results;
    });
    ipcMain.handle('paper:list', () => paperLib.listLibrary(paperRoot()));
    ipcMain.handle('paper:rescan-summary', () => paperLib.rescanSummary(paperRoot()));
    ipcMain.handle('paper:pdf-hints', (_e, filePath) => {
      try {
        const { extractPdfHints } = require('./src/main/pdf-hints');
        return extractPdfHints(filePath) || {};
      } catch (err) {
        return { error: String(err.message || err) };
      }
    });
    ipcMain.handle('paper:open', (_e, p) => {
      const { shell } = require('electron');
      try {
        shell.showItemInFolder(p);
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.handle('app:notify', (_e, payload) => {
      showNotification(payload);
      return true;
    });
    ipcMain.handle('app:version', () => app.getVersion());

    const aiRoot = () => paperRoot();
    ipcMain.handle('ai:sessions', () => aiLog.listSessions(aiRoot()));
    ipcMain.handle('ai:create-session', (_e, title) => aiLog.createSession(aiRoot(), title));
    ipcMain.handle('ai:rename-session', (_e, id, title) => aiLog.renameSession(aiRoot(), id, title));
    ipcMain.handle('ai:remove-session', (_e, id) => aiLog.removeSession(aiRoot(), id));
    ipcMain.handle('ai:items', (_e, sessionId) => aiLog.listItems(aiRoot(), sessionId));
    ipcMain.handle('ai:add', (_e, payload) => aiLog.addItem(aiRoot(), payload));
    ipcMain.handle('ai:remove', (_e, id) => aiLog.removeItem(aiRoot(), id));
    ipcMain.handle('ai:update', (_e, id, patch) => aiLog.updateItem(aiRoot(), id, patch));
    ipcMain.handle('ai:suggest-role', (_e, sessionId) => aiLog.suggestNextRole(aiRoot(), sessionId));
    ipcMain.handle('ai:clipboard-text', () => {
      try {
        const { clipboard } = require('electron');
        return clipboard.readText('clipboard') || '';
      } catch {
        return '';
      }
    });
    ipcMain.handle('ai:detect-paper-ref', (_e, text) => detectPaperRef(text));

    ipcMain.handle('activity:summary', () => activityTracker.summarize(activity.load()));
    ipcMain.handle('activity:add-read', (_e, n) => activityTracker.summarize(activity.addReadChars(n)));
    ipcMain.handle('activity:add-write', (_e, n) => activityTracker.summarize(activity.addWriteChars(n)));
  }

  function detectPaperRef(text) {
    const s = String(text || '');
    const arxiv =
      s.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i) ||
      s.match(/\b(\d{4}\.\d{4,5})\b/);
    const doi = s.match(/\b(10\.\d{4,9}\/[^\s"']+)/i);
    return {
      isPaperRef: !!(arxiv || doi),
      arxivId: arxiv ? arxiv[1] : '',
      doi: doi ? doi[1] : '',
    };
  }

  function startClipboardWatch(storeRef) {
    const { clipboard } = require('electron');
    let last = '';
    try {
      last = clipboard.readText('clipboard') || '';
    } catch (_) {}
    setInterval(() => {
      try {
        const s = storeRef.getSection('settings') || {};
        if (s.clipboardWatch === false) return;
        const text = clipboard.readText('clipboard') || '';
        if (!text || text === last || text.trim().length < 2 || text.length > 20000) return;
        last = text;
        const payload = {
          text,
          at: Date.now(),
          paperRef: detectPaperRef(text),
        };

        // 摘录/阅读字量：复制即计入
        try {
          activity.addReadChars(String(text).length);
        } catch (_) {}

        // 静默写入待归档收件箱（默认无通知，有空再整理）
        try {
          const inbox = (storeRef.getSection('clipInbox') || []).slice();
          inbox.unshift({
            id: uid('in'),
            content: text,
            createdAt: Date.now(),
            paperRef: payload.paperRef,
            status: 'pending',
          });
          storeRef.setSection('clipInbox', inbox.slice(0, 300));
        } catch (_) {}

        // 仅在设置打开时弹系统通知
        if (s.clipboardNotify === true) {
          clipNotify.showClipboardSystemNotify(payload, {
          store: storeRef,
          aiLog,
          aiRoot: paperRoot,
          onArchived: (actionId, result) => {
            try {
              if (result && result.ok && actionId !== 'ignore') {
                showNotification({
                  title: '剪贴板已归档',
                  message: {
                    clip: '已存入片段',
                    note: '已存入笔记',
                    link: '已收藏链接',
                    todo: '已存为待办',
                    ai: result.role === 'a' ? '已存入 AI 会话（A）' : '已存入 AI 会话（Q）',
                  }[actionId] || '完成',
                });
              }
              if (panel && panel.win && !panel.win.isDestroyed()) {
                panel.send('clipboard:archived', { action: actionId, result });
              }
            } catch (_) {}
          },
          onOpenChooser: (p) => {
            try {
              if (panel) {
                panel.expand();
                if (panel.win && !panel.win.isDestroyed()) panel.win.focus();
              }
              if (panel && panel.win && !panel.win.isDestroyed()) {
                panel.send('clipboard:changed', p);
              }
            } catch (_) {}
          },
        });
        }

        // 2) 渲染进程：展开时叠加一层应用内分层弹层
        if (panel && panel.win && !panel.win.isDestroyed()) {
          panel.send('clipboard:changed', payload);
        }
      } catch (err) {
        console.error('[clipboard] watch error', err);
      }
    }, 700);
  }

  app.on('second-instance', () => {
    if (panel) {
      panel.expand();
      if (panel.win) panel.win.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.lingpanel.app');
    }

    registerIpc();
    store.ensureSeed();
    activity.start();

    panel = new PanelWindow(
      store,
      path.join(__dirname, 'preload.js'),
      path.join(__dirname, 'src', 'renderer', 'index.html')
    );
    panel.create({ startExpanded: true });
    registerShortcuts();
    startClipboardWatch(store);

    const settings = store.getSection('settings') || {};
    if (settings.enableAiNotify === true || process.env.LING_ENABLE_AI_NOTIFY === '1') {
      notifyServer = startNotifyServer({
        port: Number(process.env.LING_NOTIFY_PORT || 43822),
        onNotify: (payload) => {
          showNotification({
            title: `[${payload.source}] ${payload.title}`,
            message: [payload.project, payload.message].filter(Boolean).join(' · '),
          });
          panel.send('notify:ai', payload);
        },
      });
    } else {
      console.log('[notify] AI notify disabled');
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (notifyServer) notifyServer.close();
  });

  app.on('window-all-closed', () => {});
}
