/**
 * 全局按键计数的文件契约
 *
 * 回归 bug：keyhook.ps1 每次进程启动都会把内存计数（从 0 起）写回文件，
 * 钩子因「停止打字超过阈值」被重启时，累计值与基线一起被抹掉，
 * 表现为全局按键统计每天几乎归零。
 *
 * 修复：ps1 的 Start() 改为从既有文件续接计数，使 typed-keys.json 单调递增。
 * 这里守住读取端一侧的契约：两种历史文件形态都要能读，且阈值不得过小。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const counter = require('../src/main/typing-counter');

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ling-keys-'));
  const file = path.join(dir, name);
  if (content !== undefined) fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('readKeysFile 读取纯数字形态', () => {
  const f = tmpFile('typed-keys.json', '12345');
  const r = counter.readKeysFile(f);
  assert.strictEqual(r.count, 12345);
  assert.ok(r.mtimeMs > 0);
});

test('readKeysFile 兼容早期 JSON 形态', () => {
  const f = tmpFile('typed-keys.json', '{"count":987}');
  assert.strictEqual(counter.readKeysFile(f).count, 987);
});

test('readKeysFile 对空/损坏/缺失文件返回 0 而不抛错', () => {
  assert.strictEqual(counter.readKeysFile(tmpFile('a.json', '')).count, 0);
  assert.strictEqual(counter.readKeysFile(tmpFile('b.json', 'not-a-number')).count, 0);
  assert.strictEqual(counter.readKeysFile(path.join(os.tmpdir(), 'ling-no-such-file.json')).count, 0);
});

test('STALE_MS 不得小于正常打字间隔', () => {
  // 文件只在按键时刷新，阈值过小会导致频繁重启（每次都要 spawn PowerShell + Add-Type）
  assert.ok(counter.STALE_MS >= 120000, `阈值应至少 2 分钟，实际 ${counter.STALE_MS}ms`);
  assert.ok(counter.STALE_MS <= 600000, '阈值也不宜过大，否则休眠后恢复太慢');
});

test('keyhook.ps1 启动时从既有文件续接计数（回归：重启归零）', () => {
  const ps1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'keyhook.ps1'), 'utf8');
  const startIdx = ps1.indexOf('public static void Start(string path)');
  assert.ok(startIdx > 0, '应能找到 Start 方法');
  // Start 里的恢复逻辑必须在 Flush() 之前，否则会把恢复的值又覆盖成 0
  const body = ps1.slice(startIdx, ps1.indexOf('public static void Pump'));
  const resumeAt = body.indexOf('_count = v;');
  const flushAt = body.indexOf('Flush();');
  assert.ok(resumeAt > 0, 'Start 必须从既有文件恢复 _count');
  assert.ok(flushAt > 0, 'Start 必须仍会写一次文件');
  assert.ok(resumeAt < flushAt, '恢复计数必须发生在 Flush 之前，否则恢复值被覆盖');
});

test('keyhook.ps1 必须是纯 ASCII（回归：中文注释导致编译失败）', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'keyhook.ps1'));
  // C# 源码位于 PowerShell here-string 中，而 PowerShell 5.1 会按系统 ANSI
  // （zh-CN 下即 GBK）解码无 BOM 的 .ps1。混入非 ASCII 字节会让 C# 编译失败，
  // 表现为钩子静默不启动、按键统计恒为 0。
  const bad = [...buf].filter((b) => b > 127);
  assert.strictEqual(bad.length, 0, `ps1 含 ${bad.length} 个非 ASCII 字节，会破坏 Add-Type 编译`);
  assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), '不应带 UTF-8 BOM');
});

test('keyhook.ps1 大括号配平', () => {
  const ps1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'keyhook.ps1'), 'utf8');
  // 只统计 C# 部分（here-string 内部），剔除注释与字符串字面量里的干扰
  const cs = ps1.slice(ps1.indexOf('using System;'), ps1.indexOf("'@"));
  const stripped = cs
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    assert.ok(depth >= 0, '出现了多余的右括号');
  }
  assert.strictEqual(depth, 0, 'C# 大括号未配平，Add-Type 会编译失败');
});