const { app, ipcMain, globalShortcut, Notification } = require('electron');
const path = require('path');

// 锁定 userData 为 ling-panel：开发/安装包共用 %APPDATA%\ling-panel\
// 避免安装包 productName(LingPanel) 导致重装后读到空目录，看起来像数据被覆盖
// 例外：设置 LING_PANEL_USERDATA 可让开发实例用独立目录，
// 这样它和已安装的正式版能同时运行（否则单实例锁会互相顶掉）
try {
  const override = String(process.env.LING_PANEL_USERDATA || '').trim();
  app.setPath(
    'userData',
    override || path.join(app.getPath('appData'), 'ling-panel')
  );
} catch (_) {}

const { Store, dataDir, storePath, DEFAULTS } = require('./src/main/store');
const { PanelWindow } = require('./src/main/window-manager');
const { clipSummary, notePage, homeOverview, groupPages } = require('./src/shared/workspace-lists');
const { startNotifyServer } = require('./src/main/notify-server');
const paperLib = require('./src/main/paper-lib');
const paperJobs = require('./src/main/paper-jobs');
const aiLog = require('./src/main/ai-log');
const clipNotify = require('./src/main/clip-notify');
const activityTracker = require('./src/main/activity-tracker');
const typingCounter = require('./src/main/typing-counter');
const externalEditor = require('./src/main/external-editor');
const shotLib = require('./src/main/shot-lib');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const store = new Store();
  let panel = null;
  let notifyServer = null;
  const activity = new activityTracker.ActivityTracker({ store });
  let keyHook = null;
  let keyHookTimer = null;
  let noteWatcher = null;

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

  async function openWorkspace() {
    const { dialog, shell } = require('electron');
    const fs = require('fs');
    try {
      store.ensureSeed();
      return true;
    } catch (err) {
      let file;
      try {
        file = storePath();
      } catch (error) {
        dialog.showErrorBox('无法访问工作区目录', error.message);
        return false;
      }
      let detail = err.message;
      for (;;) {
        const backup = file + '.bak';
        const choices = fs.existsSync(backup) ? ['恢复最近快照'] : [];
        choices.push('选择备份文件', '打开数据目录', '使用空工作区', '退出');
        const { response } = await dialog.showMessageBox({
          type: 'warning', title: '工作区需要恢复', message: '无法载入工作区',
          detail: `${file}\n${detail}\n恢复或新建时，原文件会保存在同目录的 .bak- 副本中。`,
          buttons: choices, cancelId: choices.length - 1,
        });
        try {
          switch (choices[response]) {
            case '打开数据目录':
              await shell.openPath(dataDir());
              continue;
            case '选择备份文件': {
              const picked = await dialog.showOpenDialog({ title: '选择工作区备份', defaultPath: dataDir(), properties: ['openFile'] });
              if (picked.canceled || !picked.filePaths[0]) continue;
              store.importFile(picked.filePaths[0]);
              return true;
            }
            case '恢复最近快照':
              store.importFile(backup);
              return true;
            case '使用空工作区':
              store.replace(structuredClone(DEFAULTS));
              return true;
            default:
              return false;
          }
        } catch (error) {
          detail = error.message;
        }
      }
    }
  }

  function registerIpc() {
    ipcMain.handle('clip:process', (_e, ids, action) => clipNotify.applyInboxAction(
      store, ids, action, (writeChars) => activityTracker.applySample(store.getSection('activity'), { writeChars })
    ));
    ipcMain.handle('clip:summary', () => clipSummary(store));
    ipcMain.handle('home:overview', () => homeOverview(store));
    ipcMain.handle('store:get', (_e, key) => store.getSection(key));
    ipcMain.handle('store:set', (_e, key, value) => {
      const next = store.setSection(key, value);
      if (key === 'settings' && panel) {
        panel.applySettings(value);
      }
      if (key === 'settings') {
        // 开关全局键数钩子
        try {
          const want = next.settings.enableKeyHook === true;
          if (want && !keyHook) {
            keyHook = typingCounter.startKeyHook(require('./src/main/store').dataDir());
            console.log('[typing] global key hook on');
          } else if (!want && keyHook) {
            keyHook.stop();
            keyHook = null;
            console.log('[typing] global key hook off');
          }
        } catch (err) {
          console.error('[typing] toggle hook failed', err && err.message);
        }
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
        store.flush();
        fs.copyFileSync(storePath(), result.filePath);
        return { ok: true, path: result.filePath };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });
    ipcMain.handle('store:import-workspace', async () => {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog({
        title: '导入工作区（覆盖当前数据）',
        properties: ['openFile'],
        filters: [{ name: 'Workspace JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      try {
        const backup = store.importFile(result.filePaths[0]);
        return { ok: true, path: result.filePaths[0], backup };
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
    ipcMain.handle('todo:board', (_e, pages, expandDone) => groupPages(store.getSection('todos'), 'status', pages, expandDone));
    ipcMain.handle('todo:open-count', () => store.getSection('todos').reduce((n, t) => n + (t.status !== 'done'), 0));
    ipcMain.handle('todo:clear-done', () => {
      store.setSection('todos', store.getSection('todos').filter((t) => t.status !== 'done'));
      return true;
    });
    ipcMain.handle('todo:create', (_e, payload) => {
      const todos = store.getSection('todos').slice();
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
      const todos = store.getSection('todos').slice();
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
    ipcMain.handle('note:page', (_e, opts) => notePage(store.getSection('notes'), opts));
    ipcMain.handle('note:get', (_e, id) => store.getSection('notes').find((n) => n.id === id));
    ipcMain.handle('note:create', (_e, payload) => {
      try {
        const len = String((payload && (payload.content || payload.title)) || '').length;
        if (len) activity.addWriteChars(len);
      } catch (_) {}
      const notes = store.getSection('notes').slice();
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
      const notes = store.getSection('notes').slice();
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

    // —— 外部 Markdown 编辑器（灵墨）——
    ipcMain.handle('app:detect-editor', () => {
      const s = store.getSection('settings') || {};
      const ed = externalEditor.resolveEditor(s.mdEditorPath);
      return {
        ok: !!ed,
        path: ed ? ed.exe : '',
        source: ed ? ed.source : 'none',
        candidates: externalEditor.candidatePaths(),
      };
    });

    ipcMain.handle('note:open-external', (_e, id) => {
      const s = store.getSection('settings') || {};
      const ed = externalEditor.resolveEditor(s.mdEditorPath);
      if (!ed) {
        return {
          ok: false,
          error:
            '没找到灵墨 LingMark。请在「设置 → 外部编辑器」里填写 LingMark.exe 的完整路径' +
            '（路径含空格可直接粘贴，不必加引号），或点「自动探测」。',
        };
      }
      const notes = store.getSection('notes') || [];
      const note = notes.find((n) => n.id === id);
      if (!note) return { ok: false, error: '笔记不存在' };
      try {
        const file = externalEditor.exportNote(dataDir(), note.id, note.content || '');
        const r = externalEditor.openInEditor(ed, file);
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, file, editor: ed.exe };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });

    ipcMain.handle('link:list', () => store.getSection('links') || []);
    ipcMain.handle('link:groups', (_e, pages) => groupPages(store.getSection('links'), 'group', pages));
    ipcMain.handle('link:create', async (_e, payload) => {
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
      const links = store.getSection('links').slice();
      links.unshift(item);
      store.setSection('links', links);
      return item;
    });
    ipcMain.handle('link:update', (_e, id, patch) => {
      const links = store.getSection('links').slice();
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
    ipcMain.handle('paper:scan', async () => {
      try {
        const r = await paperJobs.run('scanDownloads', paperRoot(), downloadsDir());
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
    async function ignorePapers(items) {
      try {
        return { ok: true, ignored: await paperJobs.run('addIgnores', paperRoot(), items) };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    }
    ipcMain.handle('paper:ignore', (_e, payload) => ignorePapers([payload]));
    ipcMain.handle('paper:ignore-many', (_e, items) => ignorePapers(items));
    ipcMain.handle('paper:unignore', async (_e, payload) => {
      try {
        const root = paperRoot();
        await paperJobs.run('removeIgnore', root, {
          sourcePath: payload && payload.sourcePath,
          fp: (payload && (payload.fingerprint || payload.fp)) || '',
        });
        return { ok: true, ignored: paperLib.listIgnored(root) };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });
    ipcMain.handle('paper:list-ignored', () => paperLib.listIgnored(paperRoot()));
    ipcMain.handle('paper:archive', async (_e, payload) => {
      try {
        return await paperJobs.run('archivePaper', paperRoot(), {
          ...payload,
          mode: (store.getSection('settings') || {}).paperArchiveMode || 'copy',
        });
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });
    ipcMain.handle('paper:archive-many', async (_e, list) => {
      const mode = (store.getSection('settings') || {}).paperArchiveMode || 'copy';
      try {
        const result = await paperJobs.run('archivePapers', paperRoot(), (list || []).map((item) => ({ ...item, mode })));
        return result.results.map((row) => row.ok ? { ...row, summary: result.summary } : row);
      } catch (err) {
        return (list || []).map((item) => ({ ok: false, error: err.message, sourcePath: item?.sourcePath }));
      }
    });
    ipcMain.handle('paper:list', () => paperJobs.run('listLibrary', paperRoot()));
    ipcMain.handle('paper:rescan-summary', () => paperJobs.run('rescanSummary', paperRoot()));
    ipcMain.handle('paper:pdf-hints', async (_e, filePath) => {
      try {
        return await paperJobs.run('pdfHints', filePath);
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

    // —— 截图收件箱 ——
    const shotsDir = () => {
      const s = store.getSection('settings') || {};
      const custom = String(s.shotsDir || '').trim();
      return custom || shotLib.defaultShotsDir();
    };

    ipcMain.handle('shot:info', () => ({
      dir: shotsDir(),
      defaultDir: shotLib.defaultShotsDir(),
      count: (store.getSection('shots') || []).length,
    }));

    ipcMain.handle('shot:list', () => (store.getSection('shots') || []));

    ipcMain.handle('shot:scan', () => {
      try {
        const known = store.getSection('shots') || [];
        const items = shotLib.scanShots(shotsDir(), known);
        return { ok: true, dir: shotsDir(), items };
      } catch (err) {
        return { ok: false, error: String(err.message || err), items: [] };
      }
    });

    ipcMain.handle('shot:ingest', (_e, items) => {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return { ok: true, added: 0, shots: store.getSection('shots') || [] };
      const shots = (store.getSection('shots') || []).slice();
      const knownPaths = new Set(shots.map((s) => s.path));
      const knownFps = new Set(shots.map((s) => s.fp).filter(Boolean));
      let added = 0;
      for (const it of list) {
        if (!it || !it.path) continue;
        if (knownPaths.has(it.path)) continue;
        if (it.fp && knownFps.has(it.fp)) continue;
        const id = uid('shot');
        shots.unshift({
          id,
          path: it.path,
          name: it.name || '',
          size: it.size || 0,
          at: it.at || Date.now(),
          fp: it.fp || '',
          createdAt: Date.now(),
        });
        knownPaths.add(it.path);
        if (it.fp) knownFps.add(it.fp);
        added += 1;
      }
      store.setSection('shots', shots);
      return { ok: true, added, shots };
    });

    ipcMain.handle('shot:remove', (_e, payload) => {
      const id = payload && payload.id;
      const deleteFile = payload && payload.deleteFile === true;
      const shots = (store.getSection('shots') || []).slice();
      const idx = shots.findIndex((s) => s.id === id);
      if (idx < 0) return { ok: false, error: '截图不存在' };
      const removed = shots.splice(idx, 1)[0];
      store.setSection('shots', shots);
      if (deleteFile && removed.path) {
        try {
          require('fs').unlinkSync(removed.path);
        } catch (_) {}
      }
      return { ok: true, shots };
    });

    ipcMain.handle('shot:clear', () => {
      store.setSection('shots', []);
      return { ok: true, shots: [] };
    });

    ipcMain.handle('shot:open', (_e, p) => {
      const { shell } = require('electron');
      try {
        shell.openPath(p);
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.handle('shot:reveal', (_e, p) => {
      const { shell } = require('electron');
      try {
        shell.showItemInFolder(p);
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.handle('shot:data-url', (_e, p) => shotLib.readAsDataUrl(p));

    ipcMain.handle('shot:to-note-asset', (_e, p) => {
      try {
        const r = shotLib.toNoteAsset(dataDir(), p, null);
        return { ok: true, ...r };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    });

    ipcMain.handle('shot:copy', async (_e, p) => {
      const { clipboard, nativeImage } = require('electron');
      try {
        const dataUrl = shotLib.readAsDataUrl(p);
        if (!dataUrl) return { ok: false, error: '读取图片失败' };
        const img = nativeImage.createFromDataURL(dataUrl);
        if (img.isEmpty()) return { ok: false, error: '图片解码失败' };
        clipboard.writeImage(img);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
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
    ipcMain.handle('ai:reorder', (_e, sessionId, orderedIds) => aiLog.reorderItems(aiRoot(), sessionId, orderedIds));
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
    ipcMain.handle('app:clipboard-write', (_e, text) => {
      try {
        const { clipboard } = require('electron');
        clipboard.writeText(String(text || ''), 'clipboard');
        return true;
      } catch (err) {
        console.error('[clipboard] write failed', err);
        return false;
      }
    });
    ipcMain.handle('ai:detect-paper-ref', (_e, text) => detectPaperRef(text));

    ipcMain.handle('activity:summary', () => activityTracker.summarize(activity.load()));
    ipcMain.handle('activity:insights', () => activity.insights());
    ipcMain.handle('activity:add-read', (_e, n) => activityTracker.summarize(activity.addReadChars(n)));
    ipcMain.handle('activity:add-write', (_e, n) => activityTracker.summarize(activity.addWriteChars(n)));
    ipcMain.handle('activity:add-typed', (_e, n) => activityTracker.summarize(activity.addTypedChars(n)));
    ipcMain.handle('activity:flush-typed-keys', () => {
      try {
        const d = keyHook ? keyHook.readDelta() : 0;
        if (d) activity.addTypedKeys(d);
        return activityTracker.summarize(activity.load());
      } catch {
        return activityTracker.summarize(activity.load());
      }
    });
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
    const timer = setInterval(() => {
      try {
        const s = storeRef.getSection('settings') || {};
        if (s.clipboardWatch === false) return;
        const text = clipboard.readText('clipboard') || '';
        if (!text || text === last || text.trim().length < 2 || text.length > 20000) return;
        const payload = {
          inboxId: uid('in'),
          text,
          at: Date.now(),
          paperRef: detectPaperRef(text),
        };

        const inbox = storeRef.getSection('clipInbox') || [];
        storeRef.save({
          clipInbox: [{
            id: payload.inboxId, content: text, createdAt: payload.at,
            paperRef: payload.paperRef, status: 'pending',
          }, ...inbox.slice(0, 299)],
          activity: activityTracker.applySample(storeRef.getSection('activity'), { readChars: text.length }),
        });
        last = text;

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
    }, 1200);
    return timer;
  }

  let clipTimer = null;

  app.on('second-instance', () => {
    if (panel) {
      panel.expand();
      if (panel.win) panel.win.focus();
    }
  });

  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.lingpanel.app');
    }

    if (!(await openWorkspace())) return app.quit();
    registerIpc();
    activity.start();

    // 全局键数钩子：默认关闭，避免杀软误报；开启后才常驻
    const startKeyHookIfNeeded = () => {
      const s = store.getSection('settings') || {};
      const want = s.enableKeyHook === true;
      if (want && !keyHook) {
        try {
          keyHook = typingCounter.startKeyHook(require('./src/main/store').dataDir());
          console.log('[typing] global key hook on');
        } catch (err) {
          console.error('[typing] key hook failed', err && err.message);
        }
      } else if (!want && keyHook) {
        try {
          keyHook.stop();
        } catch (_) {}
        keyHook = null;
        console.log('[typing] global key hook off');
      }
      return want;
    };

    startKeyHookIfNeeded();
    keyHookTimer = setInterval(() => {
      try {
        if (!keyHook) {
          startKeyHookIfNeeded();
          return;
        }
        if (keyHook.ensureAlive) keyHook.ensureAlive();
        const d = keyHook.readDelta();
        if (d) activity.addTypedKeys(d);
      } catch (_) {}
    }, 8000);
    keyHookTimer.unref?.();

    panel = new PanelWindow(
      store,
      path.join(__dirname, 'preload.js'),
      path.join(__dirname, 'src', 'renderer', 'index.html')
    );
    panel.create({ startExpanded: true });
    registerShortcuts();
    clipTimer = startClipboardWatch(store);

    // 外部 Markdown 编辑器（灵墨）改动了导出的 .md → 回写笔记
    noteWatcher = externalEditor.watchNotes(dataDir(), (file, content) => {
      const noteId = externalEditor.noteIdFromFile(file);
      const notes = (store.getSection('notes') || []).slice();
      const idx = notes.findIndex((n) => n.id === noteId);
      if (idx < 0) return;
      if (notes[idx].content === content) return;
      notes[idx] = { ...notes[idx], content, updatedAt: Date.now() };
      store.setSection('notes', notes);
      if (panel && panel.win && !panel.win.isDestroyed()) {
        panel.send('note:external-changed', { id: noteId });
      }
    });

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

  app.on('before-quit', (event) => {
    if (!paperJobs.busy()) return;
    event.preventDefault();
    paperJobs.drain().then(() => app.quit());
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (clipTimer) clearInterval(clipTimer);
    if (keyHookTimer) clearInterval(keyHookTimer);
    try {
      if (noteWatcher) noteWatcher();
    } catch (_) {}
    try {
      if (keyHook) keyHook.stop();
    } catch (_) {}
    try {
      activity.stop();
      store.flush();
    } catch (_) {}
    if (notifyServer) notifyServer.close();
  });

  app.on('window-all-closed', () => {});
}
