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

test('todo-like arrays roundtrip', () => {
  const store = new Store();
  const todos = [{ id: 'a', title: '写测试', status: 'today' }];
  store.setSection('todos', todos);
  const store2 = new Store();
  store2.cache = null;
  assert.strictEqual(store2.getSection('todos')[0].title, '写测试');
});
