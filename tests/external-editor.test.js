/**
 * 外部 Markdown 编辑器（灵墨）集成测试
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ed = require('../src/main/external-editor');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('resolveEditor 识别用户显式指定的路径', () => {
  const dir = tmpDir('ling-ed-');
  const exe = path.join(dir, 'LingMark.exe');
  fs.writeFileSync(exe, 'fake');
  const r = ed.resolveEditor(exe);
  assert.ok(r, '应能解析出编辑器');
  assert.strictEqual(r.exe, exe);
  assert.strictEqual(r.source, 'configured');
  assert.deepStrictEqual(r.args, []);
});

test('resolveEditor 支持 "exe 参数" 的复合写法（开发态指向 electron）', () => {
  const dir = tmpDir('ling-ed2-');
  const exe = path.join(dir, 'electron.exe');
  fs.writeFileSync(exe, 'fake');
  const appDir = path.join(dir, 'app');
  fs.mkdirSync(appDir);
  const r = ed.resolveEditor(`"${exe}" "${appDir}"`);
  assert.ok(r);
  assert.strictEqual(r.exe, exe);
  assert.deepStrictEqual(r.args, [appDir]);
});

test('resolveEditor 对不存在的路径返回 null（不静默乱指）', () => {
  assert.strictEqual(ed.resolveEditor('D:\\根本不存在\\xx.exe'), null);
});

test('resolveEditor 留空时走自动探测', () => {
  const r = ed.resolveEditor('');
  // 探测结果依赖机器上是否装了灵墨：有则返回 auto/dev，无则 null
  if (r) {
    assert.ok(['auto', 'dev'].includes(r.source), `来源应是 auto/dev，实际 ${r.source}`);
    assert.ok(fs.existsSync(r.exe));
  } else {
    assert.ok(Array.isArray(ed.candidatePaths()));
  }
});

test('exportNote 写出 <noteId>.md', () => {
  const dir = tmpDir('ling-note-');
  const file = ed.exportNote(dir, 'note_abc', '# 标题\n\n正文');
  assert.strictEqual(path.basename(file), 'note_abc.md');
  assert.strictEqual(path.dirname(file), ed.notesDir(dir));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '# 标题\n\n正文');
});

test('exportNote 覆盖已有文件', () => {
  const dir = tmpDir('ling-note2-');
  ed.exportNote(dir, 'n1', '第一版');
  const f = ed.exportNote(dir, 'n1', '第二版');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '第二版');
});

test('noteIdFromFile 从文件名取回 id', () => {
  assert.strictEqual(ed.noteIdFromFile('C:\\x\\notes\\note_abc.md'), 'note_abc');
  assert.strictEqual(ed.noteIdFromFile('/tmp/notes/n1.markdown'), 'n1.markdown');
});
