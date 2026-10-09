/**
 * ClipManager 选中集与「已选 N」计数的同步测试
 *
 * 回归 bug：全选 / 清空选中 / 批量操作都直接改写 state.selected，
 * 但计数 span 只在单条 checkbox 的 onchange 里被手动更新过一次，
 * 导致「查看所有 → 全选」后计数仍停在「已选 0」。
 *
 * 修复：抽出 syncCount() 作为唯一同步点，paint() 内兜底调用。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createMockDom() {
  class Node {
    constructor(type) {
      this.nodeType = type;
      this.childNodes = [];
      this.parentNode = null;
      this._listeners = {};
    }
    appendChild(child) {
      if (child == null || typeof child !== 'object' || (child.nodeType !== 1 && child.nodeType !== 3)) {
        throw new TypeError('parameter 1 is not of type "Node".');
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
    }
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    removeEventListener() {}
    dispatch(type, event) {
      for (const fn of this._listeners[type] || []) fn(event);
    }
    setAttribute(k, v) {
      this[k] = v;
    }
    matches() {
      return false;
    }
    closest() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    focus() {}
    remove() {
      if (this.parentNode) {
        const i = this.parentNode.childNodes.indexOf(this);
        if (i >= 0) this.parentNode.childNodes.splice(i, 1);
        this.parentNode = null;
      }
    }
    /** 按 '.class' 递归查找；'#id' 走 id */
    querySelector(sel) {
      const all = [];
      collect(this, all);
      const s = String(sel);
      if (s.startsWith('.')) {
        const cls = s.slice(1);
        return all.find((n) => String(n.className || '').split(/\s+/).includes(cls)) || null;
      }
      if (s.startsWith('#')) return all.find((n) => n.id === s.slice(1)) || null;
      return all.find((n) => String(n.tagName || '').toLowerCase() === s.toLowerCase()) || null;
    }
  }

  function collect(node, out) {
    for (const c of node.childNodes || []) {
      if (c.nodeType === 1) {
        out.push(c);
        collect(c, out);
      }
    }
    return out;
  }

  class Element extends Node {
    constructor(tag) {
      super(1);
      this.tagName = String(tag).toUpperCase();
      this.className = '';
      this.style = {};
      this.hidden = false;
      this.value = '';
      this.checked = false;
      this._classes = new Set();
      this.dataset = {};
      const self = this;
      this.classList = {
        add(c) {
          self._classes.add(c);
          self.className = [...self._classes].join(' ');
        },
        remove(c) {
          self._classes.delete(c);
          self.className = [...self._classes].join(' ');
        },
        contains(c) {
          return self._classes.has(c);
        },
        toggle(c, force) {
          const want = force === undefined ? !self._classes.has(c) : !!force;
          if (want) self._classes.add(c);
          else self._classes.delete(c);
          self.className = [...self._classes].join(' ');
          return want;
        },
      };
    }
    set textContent(v) {
      this._text = v;
      this.childNodes = [];
    }
    get textContent() {
      return this._text != null ? this._text : this.childNodes.map((c) => c.textContent).join('');
    }
    set innerHTML(v) {
      this._html = v;
      this.childNodes = [];
    }
    get innerHTML() {
      return this._html || '';
    }
  }

  class Text extends Node {
    constructor(data) {
      super(3);
      this.data = data;
    }
    get textContent() {
      return this.data;
    }
  }

  const body = new Element('body');
  const document = {
    createElement: (tag) => new Element(tag),
    createTextNode: (data) => new Text(data),
    getElementById: () => null,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    // applyMood 会写 documentElement.style 上的 CSS 变量
    documentElement: { style: { setProperty: () => {} } },
    body,
    activeElement: null,
  };

  return { document, Element, Text, Node, collect };
}

function loadScript(file, sandbox) {
  const code = fs.readFileSync(file, 'utf8');
  vm.runInNewContext(code, sandbox, { filename: file });
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush() {
  await tick();
  await tick();
  await tick();
}

function boot(seedInbox = [], seedClips = []) {
  const { document, Element, Text, collect } = createMockDom();
  const clipInbox = [...seedInbox];
  const clips = [...seedClips];

  const notified = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document,
    navigator: { clipboard: { writeText: async () => true } },
    LingUtil: null,
    App: { refreshCurrent: async () => {}, go: async () => {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.ling = {
    store: {
      get: async (k) => (k === 'clipInbox' ? clipInbox : k === 'clips' ? clips : null),
      set: async (k, v) => {
        if (k === 'clipInbox') {
          clipInbox.length = 0;
          clipInbox.push(...(v || []));
        } else if (k === 'clips') {
          clips.length = 0;
          clips.push(...(v || []));
        }
        return v;
      },
    },
    app: {
      clipboardWrite: async () => true,
      notify: async (p) => {
        notified.push(p);
      },
    },
    todo: { create: async () => ({}) },
    note: { create: async () => ({}) },
  };

  const root = path.join(__dirname, '..');
  loadScript(path.join(root, 'src/renderer/lib/util.js'), sandbox);
  loadScript(path.join(root, 'src/renderer/lib/clip-manager.js'), sandbox);

  return { sandbox, document, Element, Text, collect, clipInbox, clips, notified };
}

function collectDeep(node) {
  const all = [];
  (function walk(n) {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 1) {
        all.push(c);
        walk(c);
      }
    }
  })(node);
  return all;
}

function countNode(overlay) {
  return overlay.querySelector('.clip-mgr-bulk-count');
}

function findButton(overlay, text) {
  return collectDeep(overlay).find((n) => n.tagName === 'BUTTON' && n.textContent === text) || null;
}

/** 只取行内的勾选框，排除头部搜索框 */
function rowChecks(overlay) {
  return collectDeep(overlay).filter((n) => n.tagName === 'INPUT' && n.type === 'checkbox');
}

function inbox(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'in' + (i + 1),
    content: '剪贴内容 ' + (i + 1),
    createdAt: Date.now(),
    status: 'pending',
  }));
}

async function openWith(seed) {
  const env = boot(seed);
  env.overlayHolder = env.sandbox.ClipManager;
  env.sandbox.ClipManager.open({ tab: 'inbox' });
  await flush();
  const overlay = env.document.body.childNodes.find((c) =>
    String(c.className || '').includes('clip-mgr-overlay')
  );
  return { ...env, overlay };
}

test('全选后「已选 N」立即更新（回归 bug）', async () => {
  const { overlay } = await openWith(inbox(3));
  assert.ok(overlay, 'overlay 应已挂载');
  assert.strictEqual(countNode(overlay).textContent, '已选 0');

  const btnAll = findButton(overlay, '全选');
  assert.ok(btnAll, '应存在「全选」按钮');
  await btnAll._listeners.click[0]({ target: btnAll });

  assert.strictEqual(countNode(overlay).textContent, '已选 3');
});

test('全选会同步勾选每一行的 checkbox', async () => {
  const { overlay } = await openWith(inbox(3));
  const btnAll = findButton(overlay, '全选');
  await btnAll._listeners.click[0]({ target: btnAll });

  const checks = rowChecks(overlay);
  assert.strictEqual(checks.length, 3);
  assert.ok(
    checks.every((c) => c.checked === true),
    '全选后每行 checkbox 都应处于勾选态'
  );
});

test('单条勾选 / 取消勾选都实时更新计数', async () => {
  const { overlay } = await openWith(inbox(2));
  const checks = rowChecks(overlay);

  checks[0].dispatch('change', { target: { checked: true } });
  assert.strictEqual(countNode(overlay).textContent, '已选 1');

  checks[1].dispatch('change', { target: { checked: true } });
  assert.strictEqual(countNode(overlay).textContent, '已选 2');

  checks[0].dispatch('change', { target: { checked: false } });
  assert.strictEqual(countNode(overlay).textContent, '已选 1');
});

test('取消选择把计数归零（只清选中态，不删内容）', async () => {
  const { overlay, clipInbox } = await openWith(inbox(3));
  await findButton(overlay, '全选')._listeners.click[0]({});
  assert.strictEqual(countNode(overlay).textContent, '已选 3');

  await findButton(overlay, '取消选择')._listeners.click[0]({});
  assert.strictEqual(countNode(overlay).textContent, '已选 0');
  assert.strictEqual(clipInbox.length, 3, '「取消选择」不应删除任何待归档内容');
});

test('按钮标签不与删除类操作混淆', async () => {
  const { overlay } = await openWith(inbox(2));
  const cancel = findButton(overlay, '取消选择');
  assert.ok(cancel, '应存在「取消选择」按钮');
  assert.strictEqual(cancel.title, '仅取消勾选，不会删除内容');
  assert.ok(findButton(overlay, '丢弃'), 'inbox 页真正的删除动作叫「丢弃」');
  assert.ok(!findButton(overlay, '清空选中'), '旧歧义标签应已移除');
});

test('isOpen 反映浮层开关状态', async () => {
  const { sandbox, overlay } = await openWith(inbox(1));
  assert.strictEqual(sandbox.ClipManager.isOpen(), true);
  sandbox.ClipManager.close();
  assert.strictEqual(sandbox.ClipManager.isOpen(), false);
  assert.ok(!overlay.parentNode, '关闭后应从 DOM 摘除');
  // 重复 close 需幂等（收起路径可能反复触发）
  sandbox.ClipManager.close();
  assert.strictEqual(sandbox.ClipManager.isOpen(), false);
});

test('批量操作后计数归零（而非停在操作前的数字）', async () => {
  const { overlay, clipInbox } = await openWith(inbox(3));
  await findButton(overlay, '全选')._listeners.click[0]({});
  assert.strictEqual(countNode(overlay).textContent, '已选 3');

  // 「丢弃」批量动作
  const dropBtn = findButton(overlay, '丢弃');
  assert.ok(dropBtn, '应存在「丢弃」按钮');
  await dropBtn._listeners.click[0]({ target: dropBtn });

  assert.strictEqual(countNode(overlay).textContent, '已选 0');
  assert.strictEqual(clipInbox.length, 0, '待归档应被清空');
});

test('搜索过滤后全选只选中匹配项', async () => {
  const seed = [
    { id: 'a', content: '苹果派做法', createdAt: Date.now(), status: 'pending' },
    { id: 'b', content: '香蕉船做法', createdAt: Date.now(), status: 'pending' },
    { id: 'c', content: '苹果汁', createdAt: Date.now(), status: 'pending' },
  ];
  const { overlay } = await openWith(seed);

  const searchInput = collectDeep(overlay).find((n) => n.tagName === 'INPUT' && n.className === 'input');
  assert.ok(searchInput, '应存在搜索框');
  searchInput.dispatch('input', { target: { value: '苹果' } });
  await flush();

  await findButton(overlay, '全选')._listeners.click[0]({});
  assert.strictEqual(countNode(overlay).textContent, '已选 2', '只应选中 2 条含「苹果」的');
});

test('切换 tab 后计数归零', async () => {
  const { overlay } = await openWith(inbox(2));
  await findButton(overlay, '全选')._listeners.click[0]({});
  assert.strictEqual(countNode(overlay).textContent, '已选 2');

  await findButton(overlay, '已收藏')._listeners.click[0]({});
  await flush();
  assert.strictEqual(countNode(overlay).textContent, '已选 0');
});

test('空列表时全选不会产生负数或异常计数', async () => {
  const { overlay } = await openWith([]);
  await findButton(overlay, '全选')._listeners.click[0]({});
  assert.strictEqual(countNode(overlay).textContent, '已选 0');
});

// ---------------------------------------------------------------------------
// 面板收起时的浮层清理（回归：收起后展开，剪贴板浮层原地复活）
// ---------------------------------------------------------------------------

/** 在 boot 基础上再加载 app.js 并真正跑一遍 boot()，让 bindEvents 生效 */
function bootWithApp() {
  const env = boot(inbox(2));
  const { sandbox, document } = env;
  const winListeners = {};
  const docListeners = {};
  sandbox.addEventListener = (type, fn) => {
    (winListeners[type] = winListeners[type] || []).push(fn);
  };
  // ClipManager 把 Esc 挂在 document 上，App 挂在 window 上；
  // 真实浏览器里 keydown 由 document 冒泡到 window，这里照此顺序派发，
  // 并支持 stopPropagation 中断冒泡
  document.addEventListener = (type, fn) => {
    (docListeners[type] = docListeners[type] || []).push(fn);
  };
  document.removeEventListener = (type, fn) => {
    const list = docListeners[type] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  sandbox.dispatch = (type, event) => {
    const ev = Object.assign({ _stopped: false }, event, {
      stopPropagation() {
        this._stopped = true;
      },
    });
    for (const fn of docListeners[type] || []) {
      fn(ev);
      if (ev._stopped) return;
    }
    for (const fn of winListeners[type] || []) {
      fn(ev);
      if (ev._stopped) return;
    }
  };
  // startCapsuleLife 的定时器在测试里无意义，且会吊住 node:test 进程
  sandbox.setInterval = () => 0;
  sandbox.clearInterval = () => {};
  sandbox.location = { search: '?mode=expanded' };
  sandbox.URLSearchParams = URLSearchParams;
  sandbox.window.ling.todo = { list: async () => [] };
  sandbox.window.ling.activity = { summary: async () => ({ workMs: 0 }) };
  sandbox.window.ling.panel = {
    collapse: async () => {},
    inputFocus: async () => {},
    inputBlur: async () => {},
  };
  sandbox.window.ling.events = { on: () => {} };
  loadScript(path.join(__dirname, '..', 'src/renderer/app.js'), sandbox);
  return { ...env, winListeners };
}

async function bootExpanded() {
  const env = bootWithApp();
  await env.sandbox.App.boot();
  await flush();
  return env;
}

function findOverlay(document) {
  return document.body.childNodes.find((c) => String(c.className || '').includes('clip-mgr-overlay'));
}

test('面板收起时剪贴板浮层必须一并关闭（回归 bug）', async () => {
  const { sandbox, document } = await bootExpanded();
  assert.strictEqual(sandbox.App.mode, 'expanded', '前置：应处于展开态');

  sandbox.ClipManager.open({ tab: 'inbox' });
  await flush();
  assert.ok(findOverlay(document), '浮层应已打开');

  sandbox.App.showCompact();

  assert.strictEqual(findOverlay(document), undefined, '收起后 body 上不应残留浮层 DOM');
  assert.strictEqual(sandbox.ClipManager.isOpen(), false, '收起后浮层状态应复位');
});

test('浮层开着时 Esc 只关浮层，不连带收起面板', async () => {
  const { sandbox } = await bootExpanded();
  sandbox.ClipManager.open({ tab: 'inbox' });
  await flush();
  assert.strictEqual(sandbox.ClipManager.isOpen(), true);

  sandbox.dispatch('keydown', { key: 'Escape' });
  await flush();

  assert.strictEqual(sandbox.ClipManager.isOpen(), false, 'Esc 应关闭浮层');
  assert.strictEqual(sandbox.App.mode, 'expanded', '面板不应被连带收起');
});

test('连续按两次 Esc：先关浮层，再收面板', async () => {
  const { sandbox } = await bootExpanded();
  sandbox.ClipManager.open({ tab: 'inbox' });
  await flush();

  // 第一次：只关浮层（onEsc 已摘除自身监听）
  sandbox.dispatch('keydown', { key: 'Escape' });
  await flush();
  assert.strictEqual(sandbox.ClipManager.isOpen(), false);
  assert.strictEqual(sandbox.App.mode, 'expanded');

  // 第二次：浮层监听已移除，这次落到面板的 Esc 处理上
  sandbox.dispatch('keydown', { key: 'Escape' });
  await flush();
  assert.strictEqual(sandbox.App.mode, 'compact');
});

test('浮层关闭后 Esc 才能收起面板', async () => {
  const { sandbox } = await bootExpanded();
  assert.strictEqual(sandbox.App.mode, 'expanded');

  sandbox.dispatch('keydown', { key: 'Escape' });
  await flush();

  assert.strictEqual(sandbox.App.mode, 'compact', '无浮层时 Esc 应正常收起面板');
});