const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// store.js requires electron — stub before load
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: () => path.join(os.tmpdir(), 'ling-panel-test-userData'),
      },
    };
  }
  return origLoad(request, parent, isMain);
};

const tmpData = path.join(os.tmpdir(), `ling-panel-data-${Date.now()}`);
process.env.LING_PANEL_DATA = tmpData;

const { Store, DEFAULTS, deepMerge } = require('../src/main/store');

test('deepMerge patches nested objects', () => {
  const out = deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 9 } });
  assert.deepStrictEqual(out, { a: { b: 9, c: 2 } });
});

test('store loads defaults', () => {
  const store = new Store();
  const data = store.load();
  assert.strictEqual(data.settings.theme, DEFAULTS.settings.theme);
  assert.strictEqual(Array.isArray(data.workflows), true);
  assert.ok(data.workflows.length >= 4);
});

test('store persists section updates', () => {
  const store = new Store();
  store.setSection('notes', [{ id: 'n1', title: 't', content: '# hi' }]);
  const again = new Store();
  again.cache = null;
  const notes = again.getSection('notes');
  assert.strictEqual(notes[0].title, 't');
});

test('用户记录跨越 500 条仍全部保存，临时收件箱保留上限', () => {
  const store = new Store();
  const many = Array.from({ length: 800 }, (_, i) => ({ id: 'n' + i, title: 't' + i, content: 'c' }));
  for (const key of ['notes', 'todos', 'links']) {
    store.setSection(key, many);
    assert.deepStrictEqual(new Store().getSection(key), many);
  }
  store.setSection('clipInbox', many);
  assert.strictEqual(new Store().getSection('clipInbox').length, 300);
});

test('笔记、待办和链接翻到末页可读回早期记录，笔记列表只传摘要', () => {
  const { notePage, groupPages } = require('../src/shared/workspace-lists');
  const rows = Array.from({ length: 803 }, (_, n) => ({
    id: 'id-' + n, title: '标题 ' + n, content: '正文 ' + n, status: 'today', group: '默认', dueAt: n,
  }));
  const last = notePage(rows, { offset: 800 });
  assert.strictEqual(last.total, 803);
  assert.deepStrictEqual(last.items.map((x) => x.id), ['id-800', 'id-801', 'id-802']);
  assert.ok(last.items.every((x) => !('content' in x)));
  assert.strictEqual(notePage(rows, { query: '正文 802' }).items[0].id, 'id-802');
  for (const [field, key] of [['status', 'today'], ['group', '默认']]) {
    const [page] = groupPages(rows, field, { [key]: 16 });
    assert.strictEqual(page.pageCount, 17);
    assert.deepStrictEqual(page.items.map((x) => x.id), last.items.map((x) => x.id));
  }
});

test('todo-like arrays roundtrip', () => {
  const store = new Store();
  const todos = [{ id: 'a', title: '写测试', status: 'today' }];
  store.setSection('todos', todos);
  const store2 = new Store();
  store2.cache = null;
  assert.strictEqual(store2.getSection('todos')[0].title, '写测试');
});

test('损坏的工作区原样保留，可从上一份有效快照恢复', (t) => {
  process.env.LING_PANEL_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ling-recovery-'));
  t.after(() => { process.env.LING_PANEL_DATA = tmpData; });
  const store = new Store();
  store.setSection('notes', [{ id: 'original' }]);
  store.setSection('links', [{ id: 'link' }]);
  const file = path.join(process.env.LING_PANEL_DATA, 'workspace.json');
  fs.writeFileSync(file, '{"notes":[');
  const restarted = new Store();
  assert.throws(() => restarted.ensureSeed());
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"notes":[');
  const preserved = restarted.importFile(file + '.bak');
  assert.strictEqual(fs.readFileSync(preserved, 'utf8'), '{"notes":[');
  assert.deepStrictEqual(new Store().getSection('notes'), [{ id: 'original' }]);
});

test('已有空库不重新填入示例，统计可在导出或退出前刷盘', () => {
  const store = new Store();
  store.reset();
  const restarted = new Store();
  restarted.ensureSeed();
  assert.deepStrictEqual(restarted.getSection('notes'), []);
  restarted.setSection('activity', { ...restarted.getSection('activity'), typedChars: 17 });
  assert.strictEqual(restarted.getSection('activity').typedChars, 17);
  assert.strictEqual(new Store().getSection('activity').typedChars, 0);
  restarted.flush();
  assert.strictEqual(new Store().getSection('activity').typedChars, 17);
});

test('收件箱按所选 ID 一次提交，失败可重试，途中收到的条目仍在', (t) => {
  const { applyInboxAction } = require('../src/shared/workspace-lists');
  const store = new Store();
  store.reset();
  const picked = { id: 'old', content: 'selected' };
  const arrived = { id: 'new', content: 'new arrival' };
  store.setSection('clipInbox', [arrived, picked]);
  const rename = fs.renameSync;
  const fail = t.mock.method(fs, 'renameSync', (src, dest) => {
    if (dest.endsWith('workspace.json')) throw Error('simulated disk failure');
    return rename(src, dest);
  });
  assert.throws(() => applyInboxAction(store, ['old'], 'note'), /disk failure/);
  assert.strictEqual(store.getSection('notes').length, 0);
  assert.strictEqual(store.getSection('clipInbox').length, 2);
  fail.mock.restore();
  assert.strictEqual(applyInboxAction(store, ['old'], 'note'), 1);
  assert.strictEqual(applyInboxAction(store, ['old'], 'note'), 0);
  assert.deepStrictEqual(new Store().getSection('clipInbox'), [arrived]);
  assert.strictEqual(new Store().getSection('notes').length, 1);
});
