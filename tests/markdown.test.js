const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'lib', 'markdown.js'),
  'utf8'
);
const sandbox = { window: {}, globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(src.replace('typeof window !== \'undefined\' ? window : globalThis', 'window'), sandbox);
const { renderMarkdown } = sandbox.window.LingMarkdown;

test('renders headings', () => {
  const html = renderMarkdown('# Hello');
  assert.match(html, /<h1>Hello<\/h1>/);
});

test('renders bold and inline code', () => {
  const html = renderMarkdown('**bold** and `code`');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
});

test('renders lists', () => {
  const html = renderMarkdown('- a\n- b');
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
});

test('renders fenced code block', () => {
  const html = renderMarkdown('```js\nconst x = 1;\n```');
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const x = 1;/);
});

test('escapes html in paragraphs', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renders blockquote', () => {
  const html = renderMarkdown('> noted');
  assert.match(html, /<blockquote>.*noted.*<\/blockquote>/s);
});

test('renders links', () => {
  const html = renderMarkdown('[site](https://example.com)');
  assert.match(html, /<a href="https:\/\/example.com"[^>]*>site<\/a>/);
});

test('renders table', () => {
  const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td>1<\/td>/);
});
