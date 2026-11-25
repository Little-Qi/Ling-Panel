const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { createMockDom } = require('./helpers/mock-dom');

function loadUtil() {
  const { document, Element } = createMockDom();
  const sandbox = { document, console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const code = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/lib/util.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'util.js' });
  return sandbox.LingUtil;
}

test('expandableText short text has no toggle', () => {
  const { expandableText } = loadUtil();
  const node = expandableText('短文本', { limit: 80 });
  assert.strictEqual(node.nodeType, 1);
  assert.strictEqual(node.textContent, '短文本');
  assert.strictEqual(node.childNodes.length, 0);
});

test('expandableText long text collapses then expands', () => {
  const { expandableText } = loadUtil();
  const long = '字'.repeat(200);
  const wrap = expandableText(long, { limit: 50 });
  // wrap = [body, toggle]
  assert.strictEqual(wrap.childNodes.length, 2);
  const body = wrap.childNodes[0];
  const toggle = wrap.childNodes[1];
  assert.ok(body.textContent.endsWith('…'));
  assert.ok(body.textContent.length <= 51);
  assert.strictEqual(toggle.textContent, '展开');

  // 点击展开
  toggle.dispatch('click', { stopPropagation() {} });
  assert.strictEqual(body.textContent, long);
  assert.strictEqual(toggle.textContent, '收起');
  assert.ok(body.classList.contains('is-open'));

  // 再点收起
  toggle.dispatch('click', { stopPropagation() {} });
  assert.ok(body.textContent.endsWith('…'));
  assert.strictEqual(toggle.textContent, '展开');
});

test('HomeView clip rows use expandable preview (long clip)', async () => {
  const { document, Element } = createMockDom();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document,
    window: null,
    App: { go: () => {}, refreshCurrent: async () => {}, refreshBadge: async () => {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.ling = {
    home: { overview: async () => ({ openCount: 0, overdueCount: 0, due: [], notes: [], links: [] }) },
    clip: { summary: async () => ({ inbox: [{ id: 'c1', content: '很长的剪贴内容'.repeat(20) }], inboxCount: 1, clipCount: 0 }) },
    todo: { list: async () => [] },
    note: { list: async () => [] },
    link: { list: async () => [] },
    pomodoro: { get: async () => ({ focusMin: 25, history: [] }) },
    store: {
      get: async (k) =>
        k === 'clipInbox'
          ? [{ id: 'c1', content: '很长的剪贴内容'.repeat(20), createdAt: Date.now() }]
          : k === 'clips'
            ? []
            : {},
    },
  };
  const root = path.join(__dirname, '..');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/renderer/lib/util.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/renderer/views/home.js'), 'utf8'), sandbox);
  const host = sandbox.document.createElement('div');
  await sandbox.HomeView.render(host);
  const text = host.textContent;
  assert.match(text, /展开/);
  assert.match(text, /…/);
});
