/**
 * 灵墨 LingMark — 独立 Markdown 编辑器主进程
 *
 * 定位：本地文件优先、秒开、所见即所得。
 * 与 LingPanel 完全独立（不共享代码、不共享数据目录），
 * 但可被 LingPanel 以命令行方式唤起：LingMark.exe <文件路径>
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const fsService = require('./src/main/fs-service');

app.setAppUserModelId('com.lingpanel.lingmark');

const isDev = !app.isPackaged;

/** 命令行里的文件路径（Windows 资源管理器双击/「打开方式」会走到这里） */
function fileFromArgv(argv) {
  const args = (argv || []).slice(isDev ? 2 : 1);
  for (const a of args) {
    if (typeof a !== 'string') continue;
    if (a.startsWith('-')) continue;
    if (/^[a-z]+:\/\//i.test(a)) continue;
    try {
      if (fs.existsSync(a) && fs.statSync(a).isFile()) return path.resolve(a);
    } catch (_) {}
  }
  return '';
}

/** 待打开的队列：窗口未就绪时先存着 */
let pendingFile = fileFromArgv(process.argv);

let win = null;
let recent = null;
let currentFile = '';
let watcher = null;
let quitting = false;
let closeTimer = null;
let closeRequest = 0;
let waitingForClose = false;

function statePath() {
  return path.join(app.getPath('userData'), 'state.json');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveState(patch) {
  try {
    const next = { ...loadState(), ...patch };
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (_) {}
}

function createWindow() {
  const state = loadState();
  const bounds = state.bounds || {};
  const workArea = screen.getPrimaryDisplay().workArea;
  let width = Number(bounds.width) || 1180;
  let height = Number(bounds.height) || 780;
  // 高分屏/小屏上，默认尺寸或上次保存的尺寸可能比工作区还大，先夹住
  width = Math.max(720, Math.min(width, workArea.width - 32));
  height = Math.max(480, Math.min(height, workArea.height - 32));

  // 位置只在它仍落在某块屏幕内时沿用；否则交给系统居中，避免窗口跑到屏幕外
  let x;
  let y;
  if (bounds.x != null && bounds.y != null) {
    const inArea = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        bounds.x >= a.x - 50 &&
        bounds.y >= a.y - 50 &&
        bounds.x + width <= a.x + a.width + 50 &&
        bounds.y + height <= a.y + a.height + 50
      );
    });
    if (inArea) {
      x = bounds.x;
      y = bounds.y;
    }
  }

  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: dark ? '#131820' : '#ffffff',
      symbolColor: dark ? '#e7ebf1' : '#20242b',
      height: 48,
    },
    backgroundColor: dark ? '#0e1116' : '#fbfaf7',
    title: '灵墨',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // 先挂事件再加载页面：本地文件很快，避免 ready-to-show 比监听器先到
  let shown = false;
  const showWindow = () => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    win.show();
    if (pendingFile) {
      win.webContents.send('file:open-request', pendingFile);
      pendingFile = '';
    }
  };
  win.once('ready-to-show', showWindow);
  // 兜底：个别环境（禁用 GPU / 远程会话）不会触发 ready-to-show
  win.webContents.once('did-finish-load', () => setTimeout(showWindow, 150));

  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  let saveTimer = null;
  const persistBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) saveState({ bounds: win.getBounds() });
    }, 400);
  };
  win.on('resize', persistBounds);
  win.on('move', persistBounds);

  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (waitingForClose) return;
    waitingForClose = true;
    const request = ++closeRequest;
    // 超时只询问用户。正常响应后可一直停留在确认或另存为对话框。
    closeTimer = setTimeout(async () => {
      if (!waitingForClose || request !== closeRequest) return;
      ++closeRequest;
      try {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning', message: '编辑器暂时没有响应',
          detail: '强制退出会丢失尚未保存的修改。',
          buttons: ['继续等待', '强制退出'], defaultId: 0, cancelId: 0,
        });
        waitingForClose = false;
        if (response === 1) quitWindow();
        else if (win && !win.isDestroyed()) win.close();
      } catch (error) {
        waitingForClose = false;
        console.error('[LingMark] 关闭确认失败', error);
      }
    }, 8000);
    if (!win.webContents.isDestroyed()) win.webContents.send('app:will-close', request);
  });

  win.on('closed', () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    win = null;
  });

  return win;
}

function openFileInWindow(file) {
  if (!win || win.isDestroyed()) {
    pendingFile = file;
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
  win.webContents.send('file:open-request', file);
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => send('file:new') },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => send('file:open-dialog') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('file:save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('file:save-as') },
        { type: 'separator' },
        { label: '导出为 HTML…', click: () => send('file:export-html') },
        { type: 'separator' },
        { label: '在文件管理器中显示', click: () => currentFile && shell.showItemInFolder(currentFile) },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找与替换', accelerator: 'CmdOrCtrl+F', click: () => send('editor:find') },
        { label: '命令面板', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('editor:command') },
        { label: '专注模式', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('editor:zen') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '并排', accelerator: 'CmdOrCtrl+1', click: () => send('editor:mode', 'split') },
        { label: '仅编辑', accelerator: 'CmdOrCtrl+2', click: () => send('editor:mode', 'edit') },
        { label: '仅预览', accelerator: 'CmdOrCtrl+3', click: () => send('editor:mode', 'preview') },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '快捷键一览',
          click: () => send('editor:help'),
        },
        {
          label: '关于灵墨',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: '关于灵墨',
              message: `灵墨 LingMark ${app.getVersion()}`,
              detail: '轻量 Markdown 编辑器 · 本地文件优先 · 无账号无云同步',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** 渲染层确认（或用户强制）关闭：清掉兜底定时器并放行 close */
function quitWindow() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  quitting = true;
  if (win && !win.isDestroyed()) win.close();
}

function registerIpc() {
  ipcMain.handle('file:read', (_e, file) => fsService.readFile(file));
  ipcMain.handle('file:write', (_e, file, content) => fsService.writeFile(file, content));
  ipcMain.handle('file:stat', (_e, file) => fsService.statFile(file));
  ipcMain.handle('file:save-image', (_e, baseDir, dataUrl, hint) => fsService.saveImage(baseDir, dataUrl, hint));

  ipcMain.handle('file:open-dialog', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '打开 Markdown 文件',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
        { name: '文本', extensions: ['txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });

  ipcMain.handle('file:save-dialog', async (_e, suggestedName) => {
    const res = await dialog.showSaveDialog(win, {
      title: '保存 Markdown 文件',
      defaultPath: suggestedName || '未命名.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('file:export-html-dialog', async (_e, suggestedName) => {
    const res = await dialog.showSaveDialog(win, {
      title: '导出为 HTML',
      defaultPath: (suggestedName || '未命名').replace(/\.md$/i, '') + '.html',
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('recent:list', () => recent.list);
  ipcMain.handle('recent:add', (_e, file) => {
    recent.add(file);
    return recent.list;
  });
  ipcMain.handle('recent:remove', (_e, file) => {
    recent.remove(file);
    return recent.list;
  });
  ipcMain.handle('recent:clear', () => {
    recent.clear();
    return recent.list;
  });

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:current-file', () => currentFile);
  ipcMain.handle('app:confirm', async (_e, opts) => {
    const res = await dialog.showMessageBox(win, {
      type: opts && opts.type === 'error' ? 'warning' : 'question',
      buttons: (opts && opts.buttons) || ['确定', '取消'],
      defaultId: 0,
      cancelId: opts?.cancelId ?? Math.min(1, (opts?.buttons || ['确定', '取消']).length - 1),
      title: (opts && opts.title) || '灵墨',
      message: (opts && opts.message) || '',
      detail: (opts && opts.detail) || '',
    });
    return { response: res.response, confirmed: res.response === 0 };
  });

  ipcMain.handle('shell:show-item', (_e, p) => {
    try {
      shell.showItemInFolder(p);
      return true;
    } catch (_) {
      return false;
    }
  });

  ipcMain.handle('shell:open-external', (_e, url) => {
    try {
      const target = String(url || '');
      if (!/^(https?:|mailto:)/i.test(target)) return false;
      shell.openExternal(target);
      return true;
    } catch (_) {
      return false;
    }
  });

  // 把 .md / .markdown 的默认打开方式指向当前 LingMark
  ipcMain.handle('shell:set-default-md', () => {
    try {
      const exe = process.execPath;
      if (!exe || !fs.existsSync(exe)) return { ok: false, error: '找不到 LingMark.exe' };
      const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
      const command = `"${exe}" "%1"`;
      const writes = [
        ['HKCU\\Software\\Classes\\.md', 'LingMark.md'],
        ['HKCU\\Software\\Classes\\.markdown', 'LingMark.md'],
        ['HKCU\\Software\\Classes\\LingMark.md', 'Markdown 文档'],
        ['HKCU\\Software\\Classes\\LingMark.md\\shell\\open\\command', command],
      ];
      for (const [key, value] of writes) {
        execFileSync(reg, ['add', key, '/ve', '/d', value, '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      }
      return { ok: true, exe };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // 渲染层切换主题时，把原生标题栏按钮的颜色一起换掉
  ipcMain.on('theme:apply', (_e, isDark) => {
    if (!win || win.isDestroyed()) return;
    try {
      win.setTitleBarOverlay({
        color: isDark ? '#131820' : '#ffffff',
        symbolColor: isDark ? '#e7ebf1' : '#20242b',
        height: 48,
      });
    } catch (_) {}
  });

  ipcMain.handle('window:close', () => {
    if (win) win.close();
    return true;
  });

  ipcMain.handle('window:close-reply', (_e, request, decision) => {
    if (!waitingForClose || request !== closeRequest) return false;
    clearTimeout(closeTimer);
    closeTimer = null;
    if (decision === 'responding') return true;
    waitingForClose = false;
    if (decision === 'close') quitWindow();
    return true;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = fileFromArgv(argv);
    if (file) openFileInWindow(file);
    else if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    recent = new fsService.RecentFiles(path.join(app.getPath('userData'), 'recent.json'));
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // macOS 文件关联
  app.on('open-file', (e, file) => {
    e.preventDefault();
    if (app.isReady()) openFileInWindow(file);
    else pendingFile = file;
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (watcher) watcher();
  });
}
