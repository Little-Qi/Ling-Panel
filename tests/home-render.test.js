/**
 * 轻量 DOM mock：覆盖 LingUtil.el / HomeView.render 的真实渲染路径
 * 复现 issue：appendChild 收到嵌套数组时抛 "parameter 1 is not of type 'Node'"
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
      if (child == null) throw new Error('parameter 1 is not of type "Node". (null)');
      if (typeof child !== 'object' || child.nodeType !== 1 && child.nodeType !== 3) {
        const kind = Array.isArray(child) ? 'Array' : typeof child;
        const err = new Error(
          `Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'. (${kind})`
        );
        err.name = 'TypeError';
        throw err;
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
    setAttribute(k, v) {
      this[k] = v;
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    closest() {
      return null;
    }
    matches() {
      return false;
    }
  }

  class Element extends Node {
    constructor(tag) {
      super(1);
      this.tagName = String(tag).toUpperCase();
      this.className = '';
      this.style = {};
      this.hidden = false;
      this.value = '';
      this.dataset = {};
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

  const document = {
    createElement: (tag) => new Element(tag),
    createTextNode: (data) => new Text(data),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: new Element('body'),
    activeElement: null,
  };

  return { document, Element, Text, Node };
}

function loadScript(file, sandbox) {
  const code = fs.readFileSync(file, 'utf8');
  vm.runInNewContext(code, sandbox, { filename: file });
}

function boot() {
  const { document, Element, Text } = createMockDom();
  const todos = [];
  const notes = [];
  const links = [];
  const clips = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document,
    window: null,
    LingUtil: null,
    App: {
      go: () => {},
      refreshCurrent: async () => {},
      refreshBadge: async () => {},
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.ling = {
    todo: {
      list: async () => todos,
      create: async (p) => {
        const item = { id: 't' + Date.now(), status: 'today', ...p };
        todos.unshift(item);
        return item;
      },
    },
    note: {
      list: async () => notes,
      create: async (p) => {
        const item = { id: 'n' + Date.now(), updatedAt: Date.now(), ...p };
        notes.unshift(item);
        return item;
      },
    },
    link: {
      list: async () => links,
      create: async (p) => {
        const item = { id: 'l' + Date.now(), ...p };
        links.unshift(item);
        return item;
      },
    },
    pomodoro: {
      get: async () => ({ focusMin: 25, breakMin: 5, history: [] }),
      save: async () => {},
    },
    store: {
      get: async (k) => (k === 'clips' ? clips : { theme: 'aurora' }),
      set: async (k, v) => {
        if (k === 'clips') {
          clips.length = 0;
          clips.push(...(v || []));
        }
        return v;
      },
    },
  };

  const root = path.join(__dirname, '..');
  loadScript(path.join(root, 'src/renderer/lib/util.js'), sandbox);
  loadScript(path.join(root, 'src/renderer/views/home.js'), sandbox);
  return { sandbox, clips, notes, todos, links, document, Element, Text };
}

test('el flattens nested .map() children (regression: appendChild Array)', () => {
  const { sandbox, document } = boot();
  const { el } = sandbox.LingUtil;
  const items = ['a', 'b', 'c'].map((t) => el('span', { text: t }));
  const node = el('div', {}, [el('p', { text: 'head' }), items, el('p', { text: 'tail' })]);
  assert.strictEqual(node.nodeType, 1);
  // head + 3 spans + tail
  assert.strictEqual(node.childNodes.length, 5);
  assert.strictEqual(node.childNodes[0].textContent, 'head');
  assert.strictEqual(node.childNodes[1].textContent, 'a');
  assert.strictEqual(node.childNodes[4].textContent, 'tail');
});

test('el still accepts map result as sole children array', () => {
  const { sandbox } = boot();
  const { el } = sandbox.LingUtil;
  const node = el('ul', {}, [1, 2, 3].map((n) => el('li', { text: String(n) })));
  assert.strictEqual(node.childNodes.length, 3);
});

test('HomeView.render with empty clips does not throw', async () => {
  const { sandbox, document } = boot();
  const root = document.createElement('div');
  await sandbox.HomeView.render(root);
  assert.ok(root.childNodes.length > 0);
  const text = root.textContent;
  assert.match(text, /剪贴板/);
  assert.match(text, /复制先放这儿|一张一张决定|待处理/);
});

test('HomeView.render with non-empty clips does not throw (was broken path)', async () => {
  const { sandbox, document, clips } = boot();
  clips.push(
    { id: 'c1', content: '第一段剪贴内容', createdAt: Date.now() },
    { id: 'c2', content: '第二段', createdAt: Date.now() },
    { id: 'c3', content: '第三段', createdAt: Date.now() },
    { id: 'c4', content: '第四段不应出现', createdAt: Date.now() }
  );
  const root = document.createElement('div');
  await sandbox.HomeView.render(root);
  const html = root.textContent;
  assert.match(html, /剪贴板/);
  assert.match(html, /4/);
});

test('HomeView.render with notes/todos/links also works', async () => {
  const { sandbox, document, notes, todos, links } = boot();
  notes.push({ id: 'n1', title: '笔记甲', content: 'x', updatedAt: Date.now() });
  todos.push({ id: 't1', title: '待办甲', status: 'today', dueAt: Date.now() + 10 * 60e3 });
  links.push({ id: 'l1', title: '链接甲', url: 'https://example.com' });
  const root = document.createElement('div');
  await sandbox.HomeView.render(root);
  const html = root.textContent;
  assert.match(html, /笔记甲/);
  assert.match(html, /待办甲/);
  assert.match(html, /链接甲/);
});
