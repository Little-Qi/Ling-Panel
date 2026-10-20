/**
 * 截图收件箱测试：目录扫描、文件名时间解析、内容去重
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const shotLib = require('../src/main/shot-lib');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ling-shot-'));
}

/** 造一张 1x1 的 PNG */
function writePng(dir, name, filler = '') {
  const p = path.join(dir, name);
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  if (filler) fs.appendFileSync(p, filler);
  return p;
}

test('isImage 只认图片扩展名', () => {
  for (const ok of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp', 'g.PNG']) {
    assert.strictEqual(shotLib.isImage(ok), true, `${ok} 应被认作图片`);
  }
  for (const no of ['a.pdf', 'b.txt', 'c.md', 'd', 'e.mp4']) {
    assert.strictEqual(shotLib.isImage(no), false, `${no} 不应被认作图片`);
  }
});

test('listImages 列出目录里的图片并忽略其它文件', () => {
  const dir = tmpDir();
  writePng(dir, 'a.png');
  writePng(dir, 'b.png');
  fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
  const list = shotLib.listImages(dir);
  assert.strictEqual(list.length, 2);
  assert.ok(list.every((f) => shotLib.isImage(f.name)));
});

test('listImages 对不存在的目录返回空数组', () => {
  assert.deepStrictEqual(shotLib.listImages('D:\\绝对不存在\\xxx'), []);
});

test('parseShotTime 能从 Snipaste 命名还原时间', () => {
  const t = shotLib.parseShotTime('2026-10-20_143022.png', 0);
  const d = new Date(t);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 9);
  assert.strictEqual(d.getDate(), 20);
  assert.strictEqual(d.getHours(), 14);
  assert.strictEqual(d.getMinutes(), 30);
});

test('parseShotTime 支持紧凑命名', () => {
  const t = shotLib.parseShotTime('20261020_143022.png', 0);
  const d = new Date(t);
  assert.strictEqual(d.getMonth(), 9);
  assert.strictEqual(d.getDate(), 20);
});

test('parseShotTime 无法解析时退回文件修改时间', () => {
  const t = shotLib.parseShotTime('截图.png', 1700000000000);
  assert.strictEqual(t, 1700000000000);
});

test('scanShots 找出新截图并带上时间与指纹', () => {
  const dir = tmpDir();
  // 两者内容必须不同，否则会被内容去重合并掉
  writePng(dir, '2026-10-20_143022.png', 'A');
  writePng(dir, '2026-10-19_090000.png', 'B');
  const items = shotLib.scanShots(dir, []);
  assert.strictEqual(items.length, 2);
  assert.ok(items.every((i) => i.fp && i.fp.startsWith('sha1:')));
  assert.ok(items.every((i) => i.at > 0));
  // 新的在前
  assert.ok(items[0].at >= items[1].at);
});

test('scanShots 跳过同路径已收录的', () => {
  const dir = tmpDir();
  const p = writePng(dir, 'a.png');
  const first = shotLib.scanShots(dir, []);
  assert.strictEqual(first.length, 1);
  const second = shotLib.scanShots(dir, [{ path: p, fp: first[0].fp }]);
  assert.strictEqual(second.length, 0, '同路径不应重复出现');
});

test('scanShots 按内容指纹去重：同一张图改名不重复收录', () => {
  const dir = tmpDir();
  writePng(dir, 'a.png');
  fs.copyFileSync(path.join(dir, 'a.png'), path.join(dir, 'b.png'));
  const items = shotLib.scanShots(dir, []);
  assert.strictEqual(items.length, 1, '内容相同的两个文件只收一个');
});

test('scanShots 对已收录的相同内容不再重复', () => {
  const dir = tmpDir();
  writePng(dir, 'a.png');
  const first = shotLib.scanShots(dir, []);
  fs.copyFileSync(path.join(dir, 'a.png'), path.join(dir, 'copy.png'));
  const second = shotLib.scanShots(dir, [{ path: path.join(dir, 'a.png'), fp: first[0].fp }]);
  assert.strictEqual(second.length, 0);
});

test('scanShots 尊重 limit 上限', () => {
  const dir = tmpDir();
  for (let i = 0; i < 5; i++) writePng(dir, `s${i}.png`, String(i));
  const items = shotLib.scanShots(dir, [], { limit: 3 });
  assert.strictEqual(items.length, 3);
});

test('toNoteAsset 复制到 assets 并给出 file:// URL', () => {
  const dataDir = tmpDir();
  const src = tmpDir();
  const p = writePng(src, 'shot.png');
  const r = shotLib.toNoteAsset(dataDir, p, null);
  assert.strictEqual(r.ok, undefined); // toNoteAsset 不返回 ok
  assert.ok(fs.existsSync(r.path));
  assert.ok(r.path.startsWith(path.join(dataDir, 'assets')));
  assert.match(r.url, /^file:\/\/\//);
  assert.ok(!r.url.includes('\\'), 'URL 里不应有反斜杠');
});

test('readAsDataUrl 生成可用的 data URL', () => {
  const dir = tmpDir();
  const p = writePng(dir, 'x.png');
  const url = shotLib.readAsDataUrl(p);
  assert.match(url, /^data:image\/png;base64,/);
});

test('copyIntoLibrary 复制到库目录并避免重名覆盖', () => {
  const dataDir = tmpDir();
  const src = tmpDir();
  const p = writePng(src, 'shot.png');
  const a = shotLib.copyIntoLibrary(dataDir, p);
  const b = shotLib.copyIntoLibrary(dataDir, p);
  assert.notStrictEqual(a, b, '重名时应另起文件名');
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
});
