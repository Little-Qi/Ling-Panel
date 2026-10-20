/**
 * 编辑器文本变换测试（纯函数部分）
 * 这些函数是编辑器的核心手感：加粗是 toggle 不是包裹、标题同级再按一次退回正文、
 * 回车在空列表项上要退出列表。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function loadEditor() {
  // 不要预设 globalThis，否则 marked 的 UMD 会挂错对象
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  const markedCode = fs.readFileSync(path.join(root, 'src/renderer/lib/vendor/marked.min.js'), 'utf8');
  vm.runInContext(markedCode, sandbox);
  sandbox.window.marked = sandbox.marked;
  const mdCode = fs.readFileSync(path.join(root, 'src/renderer/lib/markdown.js'), 'utf8');
  vm.runInContext(mdCode.replace("typeof window !== 'undefined' ? window : globalThis", 'window'), sandbox);
  const edCode = fs.readFileSync(path.join(root, 'src/renderer/lib/md-editor.js'), 'utf8');
  vm.runInContext(edCode.replace("typeof window !== 'undefined' ? window : globalThis", 'window'), sandbox);
  return sandbox.window.LingMDEditor;
}

const ED = loadEditor();
const sel = (start, end) => ({ start, end: end === undefined ? start : end });

test('toggleWrap：无选中时插入占位词并选中它', () => {
  const r = ED.toggleWrap('', sel(0), '**', '**', '加粗');
  assert.strictEqual(r.value, '**加粗**');
  assert.strictEqual(r.start, 2);
  assert.strictEqual(r.end, 4);
});

test('toggleWrap：包裹已有选区', () => {
  const r = ED.toggleWrap('hello', sel(0, 5), '**', '**', 'x');
  assert.strictEqual(r.value, '**hello**');
  assert.strictEqual(r.start, 2);
  assert.strictEqual(r.end, 7);
});

test('toggleWrap：已是该格式则脱掉（toggle 而非包裹）', () => {
  const r = ED.toggleWrap('**hello**', sel(0, 9), '**', '**', 'x');
  assert.strictEqual(r.value, 'hello');
  assert.strictEqual(r.start, 0);
  assert.strictEqual(r.end, 5);
});

test('toggleWrap：部分选区不算已加粗（会再包一层）', () => {
  // 选区 '**hel' 结尾不是 '**'，因此不认为已加粗
  const r = ED.toggleWrap('**hello**', sel(0, 5), '**', '**', 'x');
  assert.strictEqual(r.value, '****hel**lo**');
});

test('setHeading：加标题', () => {
  const r = ED.setHeading('正文', sel(0), 2);
  assert.strictEqual(r.value, '## 正文');
});

test('setHeading：同级再按一次退回正文', () => {
  const r = ED.setHeading('## 正文', sel(0), 2);
  assert.strictEqual(r.value, '正文');
});

test('setHeading：换级别时直接替换', () => {
  const r = ED.setHeading('## 正文', sel(0), 3);
  assert.strictEqual(r.value, '### 正文');
});

test('setHeading：level 0 移除标题', () => {
  const r = ED.setHeading('### 正文', sel(0), 0);
  assert.strictEqual(r.value, '正文');
});

test('toggleLinePrefix：加列表前缀，再按一次去掉', () => {
  const a = ED.toggleLinePrefix('条目', sel(0), '- ');
  assert.strictEqual(a.value, '- 条目');
  const b = ED.toggleLinePrefix(a.value, sel(0), '- ');
  assert.strictEqual(b.value, '条目');
});

test('toggleLinePrefix：多行选区整体加前缀', () => {
  const r = ED.toggleLinePrefix('a\nb', sel(0, 3), '- ');
  assert.strictEqual(r.value, '- a\n- b');
});

test('toggleLinePrefix：部分行已有前缀时全部补齐', () => {
  const r = ED.toggleLinePrefix('- a\nb', sel(0, 6), '- ');
  assert.strictEqual(r.value, '- - a\n- b');
});

test('toggleTask：切换勾选状态', () => {
  const a = ED.toggleTask('- [ ] 做事', sel(0));
  assert.strictEqual(a.value, '- [x] 做事');
  const b = ED.toggleTask(a.value, sel(0));
  assert.strictEqual(b.value, '- [ ] 做事');
});

test('toggleTask：非任务行不变', () => {
  const r = ED.toggleTask('普通行', sel(0));
  assert.strictEqual(r.value, '普通行');
});

test('continueList：普通行不接管回车', () => {
  assert.strictEqual(ED.continueList('普通文字', sel(4)), null);
});

test('continueList：列表项续行并自动编号', () => {
  const r = ED.continueList('1. 甲', sel(4));
  assert.strictEqual(r.type, 'continue');
  assert.strictEqual(r.text, '\n2. ');
});

test('continueList：无序列表保持同一标记', () => {
  const r = ED.continueList('- 甲', sel(3));
  assert.strictEqual(r.type, 'continue');
  assert.strictEqual(r.text, '\n- ');
});

test('continueList：空列表项应退出列表', () => {
  const r = ED.continueList('- ', sel(2));
  assert.strictEqual(r.type, 'exit');
});

test('continueList：空任务项应退出列表', () => {
  const r = ED.continueList('- [ ] ', sel(6));
  assert.strictEqual(r.type, 'exit');
});

test('continueList：任务项续行保留任务标记', () => {
  const r = ED.continueList('- [ ] 甲', sel(7));
  assert.strictEqual(r.type, 'continue');
  assert.strictEqual(r.text, '\n- [ ] ');
});

test('indentLines：Tab 缩进、Shift+Tab 反缩进', () => {
  const a = ED.indentLines('a\nb', sel(0, 3), 1);
  assert.strictEqual(a.value, '  a\n  b');
  const b = ED.indentLines(a.value, sel(0, 6), -1);
  assert.strictEqual(b.value, 'a\nb');
});

test('insertTable：生成三列表格', () => {
  const r = ED.insertTable('', sel(0));
  assert.match(r.value, /\| 列 1 \| 列 2 \| 列 3 \|/);
  assert.match(r.value, /\| --- \| --- \| --- \|/);
});

test('insertHr：插入分隔线', () => {
  const r = ED.insertHr('前', sel(1));
  assert.match(r.value, /---/);
});

test('lineRange：定位选区覆盖的行', () => {
  // '第一行\n第二行\n第三行'：第 4~5 字符落在第二行，行范围是 4..7
  const r = ED.lineRange('第一行\n第二行\n第三行', { start: 4, end: 5 });
  assert.strictEqual(r.start, 4);
  assert.strictEqual(r.end, 7);
});

test('SLASH_COMMANDS 覆盖常用块级命令', () => {
  const ids = ED.SLASH_COMMANDS.map((c) => c.id);
  for (const want of ['h1', 'h2', 'h3', 'ul', 'ol', 'task', 'quote', 'code', 'table', 'hr', 'link', 'image']) {
    assert.ok(ids.includes(want), `斜杠菜单应包含 ${want}`);
  }
});

test('斜杠命令的 run 都是纯变换，不修改入参', () => {
  for (const cmd of ED.SLASH_COMMANDS) {
    const src = 'abc';
    const r = cmd.run(src, { start: 0, end: 3 });
    assert.strictEqual(src, 'abc', `${cmd.id} 不得修改入参字符串`);
    assert.ok(typeof r.value === 'string' && typeof r.start === 'number' && typeof r.end === 'number', `${cmd.id} 应返回 {value,start,end}`);
  }
});
