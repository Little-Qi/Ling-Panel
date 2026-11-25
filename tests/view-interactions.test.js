const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMockDom } = require('./helpers/mock-dom');
const lists = require('../src/shared/workspace-lists');

function panel(views, api = {}) {
  const { document, collect } = createMockDom();
  const events = {};
  const listeners = [];
  const notifications = [];
  const sandbox = {
    console, document, URLSearchParams, location: { search: '?mode=compact' },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    addEventListener: (type) => listeners.push(type),
    ling: {
      store: { get: async () => ({ dock: 'left-edge' }) },
      events: { on: (name, callback) => { events[name] = callback; } },
      app: { notify: (msg) => notifications.push(msg) },
      todo: { openCount: async () => 0 },
      ...api,
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  function load(file) {
    const name = path.join(__dirname, '../src/renderer', file + '.js');
    vm.runInContext(fs.readFileSync(name, 'utf8'), sandbox, { filename: name });
  }
  load('lib/util');
  load('lib/markdown');
  load('app');
  for (const view of views) {
    const node = document.createElement('div');
    node.id = 'view-' + view;
    document.body.appendChild(node);
    load('views/' + view);
  }
  function byId(id) { return document.getElementById(id); }
  function button(root, label) {
    const found = collect(root, []).find((n) => n.tagName === 'BUTTON' && n.textContent.startsWith(label));
    assert.ok(found, '缺少按钮 ' + label);
    return found._listeners.click[0]({});
  }
  return { sandbox, app: sandbox.App, events, listeners, notifications, document, byId, button };
}

test('从首页进入 A 后切换 B，A 的异步保存和再次刷新均保留正确的正文、标题和预览', async () => {
  const rows = [{ id: 'a', title: '甲', content: 'A' }, { id: 'b', title: '乙', content: 'B' }];
  const requested = [];
  let finishWrite;
  const p = panel(['notes'], { note: {
    page: async (q) => lists.notePage(rows, q),
    get: async (id) => { requested.push(id); return { ...rows.find((x) => x.id === id) }; },
    update: async (id, patch) => {
      await new Promise((r) => { finishWrite = r; });
      return Object.assign(rows.find((x) => x.id === id), patch);
    },
  } });
  await p.app.go('notes', 'a');
  const title = p.byId('noteTitle');
  const editor = p.byId('noteEditor');
  title.value = '甲改';
  editor.value = '# 编辑 A';
  title.dispatch('input', { target: title });
  editor.dispatch('input', { target: editor });
  const switching = p.button(p.byId('view-notes'), '乙');
  await new Promise(setImmediate);
  assert.equal(typeof finishWrite, 'function');
  finishWrite();
  await switching;
  await p.app.refreshCurrent();
  assert.deepEqual(requested, ['a', 'b', 'b']);
  assert.equal(rows[0].content, '# 编辑 A');
  assert.equal(rows[0].title, '甲改');
  assert.equal(p.byId('noteEditor').value, 'B');
  assert.equal(p.byId('noteTitle').value, '乙');
  assert.match(p.byId('mdPreview').innerHTML, />B</);
});

test('笔记写盘失败时保留原编辑框和草稿，再次切换可重试', async () => {
  const rows = [{ id: 'a', title: '甲', content: '' }, { id: 'b', title: '乙', content: '' }];
  let fail = true;
  const p = panel(['notes'], { note: {
    page: async (q) => lists.notePage(rows, q),
    get: async (id) => rows.find((r) => r.id === id),
    update: async (id, patch) => {
      if (fail) throw Error('磁盘写入失败');
      return Object.assign(rows.find((r) => r.id === id), patch);
    },
  } });
  await p.app.go('notes', 'a');
  const editor = p.byId('noteEditor');
  editor.value = '保留草稿';
  editor.dispatch('input', { target: editor });
  await p.button(p.byId('view-notes'), '乙');
  assert.equal(p.byId('noteEditor'), editor);
  assert.equal(editor.value, '保留草稿');
  assert.match(p.notifications[0].message, /磁盘/);
  fail = false;
  await p.button(p.byId('view-notes'), '乙');
  assert.equal(rows[0].content, '保留草稿');
  assert.equal(p.byId('noteTitle').value, '乙');
});

test('首页收到剪贴和归档事件后，速记输入、光标和焦点均保留', async (t) => {
  const data = { todos: [], notes: [], links: [], clips: [], clipInbox: [] };
  const store = { getSection: (key) => data[key] };
  let overviewReads = 0;
  const p = panel(['home'], {
    home: { overview: async () => { overviewReads++; return lists.homeOverview(store); } },
    clip: { summary: async () => lists.clipSummary(store) },
  });
  p.app.mode = 'expanded';
  p.app.bindEvents();
  await p.app.go('home');
  const input = p.byId('homeQuickTodo');
  input.value = '未提交的待办';
  input.selectionStart = input.selectionEnd = 2;
  input.focus();
  data.clipInbox.push({ id: 'new', content: '刚复制的文本' });
  p.events['clipboard:changed']({ inboxId: 'new', text: '刚复制的文本' });
  t.after(() => clearTimeout(p.app._clipToastTimer));
  assert.ok(p.byId('clipToast'));
  await new Promise(setImmediate);
  assert.equal(overviewReads, 1);
  assert.match(p.byId('view-home').textContent, /刚复制的文本/);
  data.notes.push({ id: 'a', title: '归档后的笔记' });
  await p.events['clipboard:archived']();
  assert.equal(overviewReads, 2);
  assert.match(p.byId('view-home').textContent, /归档后的笔记/);
  assert.equal(p.byId('homeQuickTodo'), input);
  assert.equal(p.document.activeElement, input);
  assert.equal(input.value, '未提交的待办');
  assert.equal(input.selectionStart, 2);
});

test('截图连续选择不重新读取列表或笔记，保持滚动位置且无窗口级拖拽监听', async () => {
  const files = ['a', 'b', 'c'].map((id, at) => ({ id, at, name: id + '.png', path: id + '.png' }));
  let listReads = 0;
  let noteReads = 0;
  const p = panel(['shots'], {
    shot: { info: async () => ({}), list: async () => { listReads++; return files; } },
    note: { page: async () => { noteReads++; return { items: [] }; } },
  });
  await p.app.go('shots');
  const root = p.byId('view-shots');
  const strip = root.querySelector('.shot-strip');
  const cards = strip.childNodes.slice();
  strip.scrollLeft = 120;
  for (let i = 0; i < 20; i++) cards[i % cards.length]._listeners.click[0]();
  assert.equal(root.querySelector('.shot-strip'), strip);
  assert.equal(strip.scrollLeft, 120);
  assert.equal(listReads, 1);
  assert.equal(noteReads, 0);
  assert.deepEqual(p.listeners, []);
  await p.button(root, '存进笔记');
  assert.equal(noteReads, 1);
});

test('52 × 176 侧边胶囊以原生状态启动，一次展开只渲染一次首页', async () => {
  let renders = 0;
  const p = panel(['home'], {
    panel: {
      state: async () => 'compact',
      expand: (tab) => p.events['panel:state']({ state: 'expanded', tab }),
    },
  });
  p.sandbox.innerWidth = 52;
  p.sandbox.innerHeight = 176;
  p.sandbox.HomeView.render = async () => { renders++; };
  await p.app.boot();
  assert.equal(p.document.body.dataset.orient, 'vertical');
  assert.equal(p.document.body.dataset.mode, 'compact');
  assert.equal(renders, 0);
  assert.ok(!p.listeners.includes('resize'));
  await p.app.expandFromUi('home');
  assert.equal(renders, 1);
  assert.equal(p.document.body.dataset.mode, 'expanded');
});

test('番茄暂停后离开再回来保持剩余时间，预设可重设并正确开始、暂停', async () => {
  let config = { focusMin: 25, history: [] };
  const p = panel(['pomodoro'], { pomodoro: {
    get: async () => structuredClone(config),
    save: async (v) => { config = structuredClone(v); },
  } });
  let now = Date.now();
  p.sandbox.Date = class extends Date { static now() { return now; } };
  await p.app.go('pomodoro');
  const root = p.byId('view-pomodoro');
  await p.button(root, '开始');
  now += 5 * 60000;
  await p.button(root, '暂停');
  await p.app.go('home');
  await p.app.go('pomodoro');
  assert.equal(p.sandbox.__lingPomodoro.timer.remainMs, 20 * 60000);
  assert.equal(p.byId('pomoToggle').textContent, '继续');
  await p.button(root, '15 分');
  assert.equal(config.focusMin, 15);
  assert.equal(p.sandbox.__lingPomodoro.timer.remainMs, 15 * 60000);
  await p.button(root, '开始');
  await p.button(root, '暂停');
  assert.equal(p.byId('pomoToggle').textContent, '继续');
});

test('会话翻页可打开旧会话，切换 Q/A 和收到剪贴时保留手写草稿', async () => {
  const sessions = Array.from({ length: 201 }, (_, n) => ({ id: String(n), title: '会话 ' + n }));
  const p = panel(['ailog'], { ai: { sessions: async () => sessions, items: async () => [] } });
  p.app.mode = 'expanded';
  await p.app.go('ailog');
  const root = p.byId('view-ailog');
  await p.button(root, '下一页');
  await p.button(root, '下一页');
  await p.button(root, '会话 200');
  assert.equal(p.sandbox.AiLogView.getSessionId(), '200');
  const input = root.querySelector('textarea');
  input.value = '正在撰写的回答';
  await p.button(root, '回答 A');
  p.sandbox.AiLogView.setPending({ text: '刚刚复制' });
  assert.equal(root.querySelector('textarea'), input);
  assert.equal(input.value, '正在撰写的回答');
  assert.match(p.byId('aiPending').textContent, /存为回答/);
});

test('论文扫描期间可以切页，文献库可以翻页并搜索第 81 份以后的记录', async () => {
  let finish;
  const files = Array.from({ length: 83 }, (_, n) => ({ fileName: 'Paper-' + n, title: 'Paper ' + n, topic: 'Topic' }));
  const p = panel(['papers'], { paper: {
    info: async () => ({ root: 'papers', downloads: 'downloads', topics: [], venues: [] }),
    scan: () => new Promise((r) => { finish = r; }), listIgnored: async () => [], list: async () => files,
  } });
  await p.app.go('papers');
  assert.equal(typeof finish, 'function');
  await p.app.go('home');
  assert.equal(p.app.currentTab, 'home');
  finish({ ok: true, items: [], nonPapers: [] });
  await new Promise(setImmediate);
  await p.app.go('papers');
  const root = p.byId('view-papers');
  await p.button(root, '刷新库');
  await p.button(root, '文献库');
  assert.doesNotMatch(root.textContent, /Paper-82/);
  await p.button(root, '下一页');
  assert.match(root.textContent, /Paper-82/);
  await p.button(root, '上一页');
  const input = root.querySelector('input');
  input.value = 'Paper-82';
  input.dispatch('input', { target: input });
  assert.match(root.textContent, /Paper-82/);
  assert.doesNotMatch(root.textContent, /Paper-81/);
});
