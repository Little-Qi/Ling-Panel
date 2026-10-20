/**
 * 灵墨 LingMark — 独立 Markdown 编辑器主进程
 *
 * 定位：本地文件优先、秒开、所见即所得。
 * 与 LingPanel 完全独立（不共享代码、不共享数据目录），
 * 但可被 LingPanel 以命令行方式唤起：LingMark.exe <文件路径>
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

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
  let width = Number(bounds.width) || 1180;
  let height = Number(bounds.height) || 780;
  if (bounds.x != null && bounds.y != null) {
    // 落在已断开的显示器上时回退到主屏
    const inArea = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        bounds.x >= a.x - 50 &&
        bounds.y >= a.y - 50 &&
        bounds.x + width <= a.x + a.width + 50 &&
        bounds.y + height <= a.y + a.height + 50
      );
    });
    if (!inArea) {
      width = 1180;
      height = 780;
    }
  }

  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#111418',
    title: '灵墨',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    if (pendingFile) {
      win.webContents.send('file:open-request', pendingFile);
      pendingFile = '';
    }
  });

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
    // 交给渲染层确认未保存改动
    e.preventDefault();
    win.webContents.send('app:will-close');
  });

  win.on('closed', () => {
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
      cancelId: 1,
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

  ipcMain.handle('window:close', () => {
    quitting = true;
    if (win) win.close();
    return true;
  });

  ipcMain.handle('window:confirm-close', () => {
    quitting = true;
    if (win) win.close();
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

  app.on('before-quit', () => {
    quitting = true;
    if (watcher) watcher();
  });
}
