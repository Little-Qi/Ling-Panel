/**
 * 灵墨 Markdown 渲染层测试
 * 注意：node 环境没有 DOM，DOMPurify 不可用，走内置的保守净化分支；
 * 浏览器里的 DOMPurify 路径由应用本身保证（见 markdown.js 的 hook）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function loadMarkdown() {
  // 注意：不要预设 globalThis，否则 marked 的 UMD 会挂到那个对象上而不是沙箱本身
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  // 先加载 marked（UMD 挂到 globalThis），再同步到 window，
  // 与真实渲染环境一致：两个 script 标签按序加载
  const markedCode = fs.readFileSync(path.join(root, 'src/renderer/lib/vendor/marked.min.js'), 'utf8');
  vm.runInContext(markedCode, sandbox);
  sandbox.window.marked = sandbox.marked;
  const katexCode = fs.readFileSync(path.join(root, 'src/renderer/lib/vendor/katex.min.js'), 'utf8');
  vm.runInContext(katexCode, sandbox);
  sandbox.window.katex = sandbox.katex;
  const code = fs.readFileSync(path.join(root, 'src/renderer/lib/markdown.js'), 'utf8');
  vm.runInContext(code.replace("typeof window !== 'undefined' ? window : globalThis", 'window'), sandbox);
  return sandbox.window.LingMarkdown;
}

const MD = loadMarkdown();

test('marked 已就位（vendored 依赖可用）', () => {
  assert.strictEqual(MD.hasMarked, true, 'marked 应被正确加载');
});

test('渲染标题并带锚点 id', () => {
  const html = MD.renderMarkdown('# 你好 世界');
  assert.match(html, /<h1[^>]*id="[^"]+"[^>]*>你好 世界/);
});

test('渲染基本行内格式', () => {
  const html = MD.renderMarkdown('**粗** *斜* ~~删~~ `码`');
  assert.match(html, /<strong>粗<\/strong>/);
  assert.match(html, /<em>斜<\/em>/);
  assert.match(html, /<del>删<\/del>/);
  assert.match(html, /<code>码<\/code>/);
});

test('渲染任务清单为 checkbox', () => {
  const html = MD.renderMarkdown('- [x] done\n- [ ] todo');
  assert.match(html, /<input[^>]*type="checkbox"/);
  assert.match(html, /checked/);
});

test('渲染表格', () => {
  const html = MD.renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td>1<\/td>/);
});

test('渲染围栏代码块并带语言类', () => {
  const html = MD.renderMarkdown('```js\nconst x = 1;\n```');
  assert.match(html, /class="language-js"/);
  assert.match(html, /const x = 1;/);
});

test('代码块内容被转义，不会变成可执行标签', () => {
  const html = MD.renderMarkdown('```\n<script>alert(1)</script>\n```');
  assert.ok(!html.includes('<script>'), '代码块内不得出现原始 script 标签');
});

test('裸 HTML 不会作为可执行脚本输出', () => {
  const html = MD.renderMarkdown('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), '不得输出可执行 script');
});

test('危险协议被拦截', () => {
  assert.strictEqual(MD.safeUrl('javascript:alert(1)'), '#');
  assert.strictEqual(MD.safeUrl('  vbscript:x'), '#');
  assert.strictEqual(MD.safeUrl('data:text/html,<script>'), '#');
  assert.strictEqual(MD.safeUrl('https://example.com'), 'https://example.com');
  assert.strictEqual(MD.safeUrl('data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
  assert.strictEqual(MD.safeUrl('./local.png'), './local.png');
});

test('sanitize 去掉事件属性', () => {
  const out = MD.sanitize('<img src="x" onerror="alert(1)">');
  assert.ok(!/onerror/i.test(out), '不得保留 on* 事件属性');
});

test('extractOutline 提取标题层级与行号', () => {
  const md = ['# 一', '', '## 二', '', '### 三', '', '正文'].join('\n');
  const outline = MD.extractOutline(md);
  assert.strictEqual(outline.length, 3);
  // 数组来自 vm 沙箱（跨 realm），Array.from 转回本 realm 才能 deepStrictEqual
  assert.deepStrictEqual(Array.from(outline, (o) => o.level), [1, 2, 3]);
  assert.strictEqual(outline[0].text, '一');
  assert.strictEqual(outline[0].line, 0);
  assert.strictEqual(outline[1].line, 2);
  assert.strictEqual(outline[2].line, 4);
});

test('extractOutline 忽略代码块里的 # 号', () => {
  const md = ['# 真标题', '', '```bash', '# 这是注释', '```', '', '## 另一个'].join('\n');
  const outline = MD.extractOutline(md);
  assert.strictEqual(outline.length, 2);
  assert.deepStrictEqual(Array.from(outline, (o) => o.text), ['真标题', '另一个']);
});

test('extractTasks 按源码顺序取出任务项', () => {
  const md = ['- [x] 甲', '- [ ] 乙', '普通行', '- [X] 丙'].join('\n');
  const tasks = MD.extractTasks(md);
  assert.strictEqual(tasks.length, 3);
  assert.strictEqual(tasks[0].checked, true);
  assert.strictEqual(tasks[1].checked, false);
  assert.strictEqual(tasks[1].text, '乙');
  assert.strictEqual(tasks[2].checked, true, '大写 X 也应识别为已完成');
});

test('countWords 分别统计中英文', () => {
  const r = MD.countWords('你好世界 hello world');
  assert.strictEqual(r.cjk, 4);
  assert.strictEqual(r.words, 2);
  assert.strictEqual(r.total, 6);
});

test('slugify 生成稳定锚点', () => {
  assert.strictEqual(MD.slugify('Hello World'), 'hello-world');
  assert.strictEqual(MD.slugify('中文标题'), '中文标题');
  assert.strictEqual(MD.slugify(''), 'section');
});

test('exportHtml 产出独立可用文档', () => {
  const html = MD.exportHtml('# 标题\n\n正文', '我的文档');
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<title>我的文档<\/title>/);
  assert.match(html, /<h1[^>]*>标题/);
  assert.match(html, /<style>/);
});

test('空输入返回空串而不是报错', () => {
  assert.strictEqual(MD.renderMarkdown(''), '');
  assert.strictEqual(MD.renderMarkdown(null), '');
  assert.strictEqual(MD.renderMarkdown(undefined), '');
});

test('文件带 UTF-8 BOM 时仍能识别标题与正文', () => {
  const src = '\uFEFF# 标题\n\n正文';
  const html = MD.renderMarkdown(src);
  assert.match(html, /<h1[^>]*>标题/);
  assert.strictEqual(MD.extractOutline(src).length, 1);
  assert.strictEqual(MD.countWords(src).cjk, 4);
});

test('支持大模型常用的 \\(...\\) 行内公式', () => {
  const html = MD.renderMarkdown('质能方程 \\(E=mc^2\\) 很简单');
  assert.match(html, /<math/);
  assert.ok(!html.includes('\\(E=mc^2\\)'), '占位符应已被渲染');
});

test('支持 \\[...\\] 与 $$...$$ 块级公式', () => {
  const a = MD.renderMarkdown('\\[\\frac{a}{b}\\]');
  const b = MD.renderMarkdown('$$\n\\int_0^1 x dx\n$$');
  assert.match(a, /<math[^>]*display="block"/);
  assert.match(b, /<math[^>]*display="block"/);
  assert.match(a, /<div class="math-display">/);
});

test('行内代码与代码块里的 $ 不当公式', () => {
  const html = MD.renderMarkdown('`$x$`\n\n```\n$y$\n```');
  assert.ok(!html.includes('<math'));
  assert.match(html, /<code>\$x\$<\/code>/);
});

test('金额不会被误判成公式', () => {
  const html = MD.renderMarkdown('价格 $5.00 和 $12，还有 $ 符号');
  assert.ok(!html.includes('<math'));
});
