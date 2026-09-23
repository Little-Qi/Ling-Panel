const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const aiLog = require('../src/main/ai-log');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-log-'));
}

test('createSession and listSessions', () => {
  const root = tmpRoot();
  const s = aiLog.createSession(root, 'ChatGPT · 推荐系统调研');
  assert.ok(s.id);
  assert.strictEqual(s.title, 'ChatGPT · 推荐系统调研');
  assert.strictEqual(aiLog.listSessions(root).length, 1);
});

test('addItem creates session with auto title from content', () => {
  const root = tmpRoot();
  const r = aiLog.addItem(root, {
    role: 'q',
    content: '帮我解释一下序列推荐里的 SASRec 和 BERT4Rec 有什么区别？',
    source: 'clipboard',
    autoTitle: true,
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.sessionId);
  const sess = aiLog.listSessions(root)[0];
  assert.match(sess.title, /SASRec|序列推荐/);
  assert.strictEqual(aiLog.listItems(root, r.sessionId)[0].role, 'q');
});

test('addItem distinguishes Q and A in same session', () => {
  const root = tmpRoot();
  const s = aiLog.createSession(root, 'LLM chat');
  aiLog.addItem(root, { sessionId: s.id, role: 'q', content: 'What is RAG?', source: 'clipboard' });
  aiLog.addItem(root, { sessionId: s.id, role: 'a', content: 'Retrieval Augmented Generation…', source: 'clipboard' });
  const items = aiLog.listItems(root, s.id);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].role, 'q');
  assert.strictEqual(items[1].role, 'a');
});

test('suggestNextRole alternates after last item', () => {
  const root = tmpRoot();
  const s = aiLog.createSession(root, 't');
  assert.strictEqual(aiLog.suggestNextRole(root, s.id), 'q');
  aiLog.addItem(root, { sessionId: s.id, role: 'q', content: 'question here' });
  assert.strictEqual(aiLog.suggestNextRole(root, s.id), 'a');
  aiLog.addItem(root, { sessionId: s.id, role: 'a', content: 'answer here' });
  assert.strictEqual(aiLog.suggestNextRole(root, s.id), 'q');
});

test('updateItem can flip role', () => {
  const root = tmpRoot();
  const r = aiLog.addItem(root, { role: 'q', content: 'flip me', autoTitle: true });
  const updated = aiLog.updateItem(root, r.item.id, { role: 'a' });
  assert.strictEqual(updated.role, 'a');
});

test('reorderItems persists display order', () => {
  const { loadAiLog, saveAiLog, addItem, listItems, reorderItems } = require('../src/main/ai-log');
  const root = path.join(os.tmpdir(), `ling-ai-reorder-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  const a = addItem(root, { sessionId: 's1', role: 'q', content: 'A' }).item;
  const b = addItem(root, { sessionId: 's1', role: 'a', content: 'B' }).item;
  const c = addItem(root, { sessionId: 's1', role: 'q', content: 'C' }).item;
  assert.deepStrictEqual(listItems(root, 's1').map((x) => x.id), [a.id, b.id, c.id]);
  reorderItems(root, 's1', [c.id, a.id, b.id]);
  assert.deepStrictEqual(listItems(root, 's1').map((x) => x.id), [c.id, a.id, b.id]);
});

test('removeSession drops its items', () => {
  const root = tmpRoot();
  const s = aiLog.createSession(root, 'gone');
  aiLog.addItem(root, { sessionId: s.id, role: 'q', content: 'x' });
  aiLog.removeSession(root, s.id);
  assert.strictEqual(aiLog.listSessions(root).length, 0);
  assert.strictEqual(aiLog.listItems(root).length, 0);
});

test('addItem rejects empty content', () => {
  const root = tmpRoot();
  const r = aiLog.addItem(root, { role: 'q', content: '   ' });
  assert.strictEqual(r.ok, false);
});
