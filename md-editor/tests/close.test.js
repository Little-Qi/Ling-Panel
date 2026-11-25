const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

// 连接实际的关闭 IPC 与渲染层，只替换 Electron 窗口、系统对话框和时钟。
async function editorWindow({ confirm = () => 2, saveDialog, write, renderer = true } = {}) {
  const ipc = {};
  const events = {};
  const dialogs = [];
  const timers = new Map();
  let nextTimer = 0;
  let win;
  let reply;
  let dirty = true;
  let content = '未保存的正文';
  class Window extends EventEmitter {
    constructor() {
      super();
      win = this;
      this.closed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        isDestroyed: () => this.closed,
        send: (name, id) => { reply = events[name]?.(id); },
      });
    }
    isDestroyed() { return this.closed; }
    loadFile() {}
    close() {
      let prevented = false;
      this.emit('close', { preventDefault() { prevented = true; } });
      if (!prevented) { this.closed = true; this.emit('closed'); }
    }
  }
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
    whenReady: async () => {}, getPath: () => '.', quit() {},
  });
  const electron = {
    app, BrowserWindow: Window, nativeTheme: {}, shell: {},
    screen: { getPrimaryDisplay: () => ({ workArea: { width: 1200, height: 800 } }) },
    Menu: { buildFromTemplate() {}, setApplicationMenu() {} },
    ipcMain: { on() {}, handle: (name, fn) => { ipc[name] = fn; } },
    dialog: {
      showMessageBox: async (_, options) => {
        dialogs.push(options);
        return { response: await confirm(options) };
      },
      showSaveDialog: saveDialog || (async () => ({ filePath: '文档.md' })),
    },
  };
  const dir = path.join(__dirname, '..');
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'main.js'), 'utf8'), {
    __dirname: dir, console, process: { argv: ['LingMark.exe'] },
    require: (id) => {
      if (id === 'electron') return electron;
      if (id === './src/main/fs-service') return { RecentFiles: class { add() {} }, writeFile: write || (() => ({ ok: true })) };
      if (id === 'fs') return { readFileSync: () => '{}' };
      return require(id);
    },
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
  });
  await new Promise(setImmediate);
  const invoke = (name) => (...args) => ipc[name]({}, ...args);
  if (renderer) {
    let start;
    const window = {
      addEventListener() {},
      lm: {
        file: { current: async () => '', saveDialog: invoke('file:save-dialog'), write: invoke('file:write') },
        app: { confirm: invoke('app:confirm'), closeReply: invoke('window:close-reply') },
        recent: { add: invoke('recent:add') }, events: { on: (name, fn) => { events[name] = fn; } },
      },
      LingMDEditor: { create: () => ({
        isDirty: () => dirty, getValue: () => content, markClean() { dirty = false; }, setFileInfo() {},
      }) },
    };
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'src/renderer/app.js'), 'utf8'), {
      window, console, document: { getElementById() {}, addEventListener: (_, fn) => { start = fn; } },
    });
    start();
    await new Promise(setImmediate);
  }
  return {
    win, timers, dialogs, dirty: () => dirty, edit: (value) => { content = value; dirty = true; },
    close: () => { invoke('window:close')(); return reply; },
    async timeout() {
      const timer = [...timers].find(([, entry]) => entry.ms === 8000);
      assert.ok(timer, '应存在等待渲染进程的计时器');
      timers.delete(timer[0]);
      await timer[1].fn();
    },
  };
}

test('Esc 取消关闭后文档可继续编辑，再次关闭可以明确放弃', async () => {
  let discard = false;
  const e = await editorWindow({ confirm: (opts) => discard ? 1 : opts.cancelId });
  await e.close();
  assert.equal(e.dialogs[0].cancelId, 2);
  assert.equal(e.win.closed, false);
  assert.equal(e.dirty(), true);
  assert.equal(e.timers.size, 0);
  discard = true;
  await e.close();
  assert.equal(e.win.closed, true);
});

test('等待用户选择或另存为期间不会超时，取消另存为保留文档', async () => {
  let choose;
  const e = await editorWindow({
    confirm: () => new Promise((resolve) => { choose = resolve; }),
    saveDialog: async () => ({ canceled: true }),
  });
  const closing = e.close();
  await new Promise(setImmediate);
  assert.equal(e.timers.size, 0);
  assert.equal(e.win.closed, false);
  choose(0);
  await closing;
  assert.equal(e.timers.size, 0);
  assert.equal(e.win.closed, false);
  assert.equal(e.dirty(), true);
});

test('磁盘写入失败保留脏文档，重试保存成功才退出', async () => {
  let fail = true;
  const e = await editorWindow({
    confirm: () => 0,
    write: (filename, body) => {
      assert.equal(filename, '文档.md');
      assert.equal(body, '未保存的正文');
      return fail ? { ok: false, error: '磁盘已满' } : { ok: true };
    },
  });
  await e.close();
  assert.equal(e.win.closed, false);
  assert.equal(e.dirty(), true);
  assert.equal(e.dialogs.at(-1).detail, '磁盘已满');
  fail = false;
  await e.close();
  assert.equal(e.win.closed, true);
  assert.equal(e.dirty(), false);
});

test('写入期间新输入的修改仍标记为未保存', async () => {
  let finish;
  const e = await editorWindow({ confirm: () => 0, write: () => new Promise((r) => { finish = r; }) });
  const closing = e.close();
  await new Promise(setImmediate);
  e.edit('写入期间的新增内容');
  finish({ ok: true });
  await closing;
  assert.equal(e.win.closed, false);
  assert.equal(e.dirty(), true);
});

test('渲染进程无响应时可继续等待，只有明确选择强制退出才关闭', async () => {
  let force = false;
  const e = await editorWindow({ renderer: false, confirm: () => force ? 1 : 0 });
  e.close();
  await e.timeout();
  assert.equal(e.dialogs[0].cancelId, 0);
  assert.equal(e.win.closed, false);
  force = true;
  await e.timeout();
  assert.equal(e.win.closed, true);
});
