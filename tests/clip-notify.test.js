const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// clip-notify 在 load 时 require('electron')，测试里先塞假 Notification
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    class FakeNotification {
      static isSupported() {
        return true;
      }
      constructor(opts) {
        this.opts = opts;
        this.handlers = {};
      }
      on(ev, fn) {
        this.handlers[ev] = fn;
      }
      show() {
        this.shown = true;
      }
    }
    return { Notification: FakeNotification };
  }
  return origLoad.apply(this, arguments);
};

const clipNotify = require('../src/main/clip-notify');
const aiLog = require('../src/main/ai-log');

function tmpStore() {
  const data = { clips: [], notes: [], links: [], todos: [] };
  return {
    getSection: (k) => data[k],
    setSection: (k, v) => {
      data[k] = v;
      return data;
    },
    _data: data,
  };
}

test('previewText collapses whitespace and truncates', () => {
  assert.strictEqual(clipNotify.previewText('  a\n\n b  ', 10), 'a b');
  assert.strictEqual(clipNotify.previewText('x'.repeat(50), 10).length, 10);
});

test('buildActions for normal text: no link button', () => {
  const acts = clipNotify.buildActions('普通一段文字');
  const ids = acts.map((a) => a.id);
  assert.deepStrictEqual(ids, ['clip', 'note', 'ai-q', 'ai-a', 'ignore']);
});

test('buildActions for URL inserts link', () => {
  const acts = clipNotify.buildActions('https://example.com/a');
  const ids = acts.map((a) => a.id);
  assert.ok(ids.includes('link'));
  assert.ok(ids.indexOf('link') < ids.indexOf('ai-q'));
});

test('applyArchive clip goes to clips not AI', () => {
  const store = tmpStore();
  const r = clipNotify.applyArchive('clip', { text: 'hello world' }, { store });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.dest, 'clip');
  assert.strictEqual(store._data.clips.length, 1);
  assert.strictEqual(store._data.clips[0].content, 'hello world');
  assert.strictEqual(store._data.notes.length, 0);
});

test('applyArchive note creates note', () => {
  const store = tmpStore();
  const r = clipNotify.applyArchive('note', { text: 'note body here' }, { store });
  assert.strictEqual(r.dest, 'note');
  assert.strictEqual(store._data.notes.length, 1);
  assert.match(store._data.notes[0].title, /note body/);
});

test('applyArchive link for URL', () => {
  const store = tmpStore();
  const r = clipNotify.applyArchive('link', { text: 'https://example.com/x' }, { store });
  assert.strictEqual(r.dest, 'link');
  assert.strictEqual(store._data.links[0].url, 'https://example.com/x');
});

test('applyArchive ai-q / ai-a only when chosen', () => {
  const store = tmpStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-ai-'));
  const deps = { store, aiLog, aiRoot: root };
  const r = clipNotify.applyArchive('ai-q', { text: 'What is RAG?' }, deps);
  assert.strictEqual(r.dest, 'ai');
  assert.strictEqual(r.role, 'q');
  const items = aiLog.listItems(root);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].role, 'q');
  // 普通 clip 不会进 AI
  clipNotify.applyArchive('clip', { text: 'just a snippet' }, deps);
  assert.strictEqual(aiLog.listItems(root).length, 1);
});

test('applyArchive ignore is skip', () => {
  const store = tmpStore();
  const r = clipNotify.applyArchive('ignore', { text: 'x y z' }, { store });
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(store._data.clips.length, 0);
});
