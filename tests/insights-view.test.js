/**
 * 「节律」页日期切换 + 指标切换测试
 *
 * 背景：insightsPayload 改为让 days 每条都带明细（hours / apps），
 * 渲染层据此在本地切换日期，无需新增 IPC。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createMockDom() {
  class Node {
    constructor(type) {
      this.nodeType = type;
      this.childNodes = [];
      this.parentNode = null;
      this._listeners = {};
    }
    appendChild(child) {
      if (child == null || typeof child !== 'object' || (child.nodeType !== 1 && child.nodeType !== 3)) {
        throw new TypeError('parameter 1 is not of type "Node".');
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
    }
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    removeEventListener() {}
    setAttribute(k, v) {
      this[k] = v;
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    matches() {
      return false;
    }
    closest() {
      return null;
    }
    focus() {}
    remove() {}
  }

  class Element extends Node {
    constructor(tag) {
      super(1);
      this.tagName = String(tag).toUpperCase();
      this.className = '';
      this.style = {};
      this.hidden = false;
      this.value = '';
      this.dataset = {};
    }
    set textContent(v) {
      this._text = v;
      this.childNodes = [];
    }
    get textContent() {
      return this._text != null ? this._text : this.childNodes.map((c) => c.textContent).join('');
    }
    set innerHTML(v) {
      this._html = v;
      this.childNodes = [];
    }
    get innerHTML() {
      return this._html || '';
    }
  }

  class Text extends Node {
    constructor(data) {
      super(3);
      this.data = data;
    }
    get textContent() {
      return this.data;
    }
  }

  const body = new Element('body');
  const document = {
    createElement: (tag) => new Element(tag),
    createTextNode: (data) => new Text(data),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: { style: { setProperty: () => {} } },
    body,
    activeElement: null,
  };
  return { document, Element, Text };
}

function loadScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

function collectDeep(node) {
  const all = [];
  (function walk(n) {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 1) {
        all.push(c);
        walk(c);
      }
    }
  })(node);
  return all;
}

function mkDay(date, { workMin = 0, readChars = 0, typedChars = 0, apps = [], hour = 0, hourMs = 0 } = {}) {
  const hours = new Array(24).fill(0);
  hours[hour] = hourMs;
  return {
    date,
    workMs: workMin * 60000,
    workMin,
    readChars,
    typedKeys: typedChars,
    typedChars,
    hours,
    apps: apps.map((a) => ({ id: a, name: a, ms: workMin * 60000 })),
  };
}

const DAYS = [
  mkDay('2026-09-07', { workMin: 30, readChars: 100, typedChars: 10, apps: ['VS Code'], hour: 9, hourMs: 30 * 60000 }),
  mkDay('2026-09-08', { workMin: 120, readChars: 5000, typedChars: 900, apps: ['Chrome', 'VS Code'], hour: 14, hourMs: 120 * 60000 }),
  mkDay('2026-09-09', { workMin: 45, readChars: 300, typedChars: 60, apps: ['微信'], hour: 20, hourMs: 45 * 60000 }),
];

function boot(settings = {}) {
  const { document, Element, Text } = createMockDom();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    document,
    LingUtil: null,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // insights.js 末尾有 module.exports 出口，供断言其中的纯函数
  sandbox.module = { exports: {} };
  sandbox.window.ling = {
    activity: { insights: async () => ({ ...DAYS[2], days: DAYS.map((d) => ({ ...d })) }) },
    store: { get: async () => settings },
  };
  const root = path.join(__dirname, '..');
  loadScript(path.join(root, 'src/renderer/lib/util.js'), sandbox);
  loadScript(path.join(root, 'src/renderer/views/insights.js'), sandbox);
  const view = document.createElement('div');
  return { sandbox, document, Element, Text, root: view };
}

function btn(root, text) {
  return collectDeep(root).find((n) => n.tagName === 'BUTTON' && n.textContent === text) || null;
}

function allBtns(root) {
  return collectDeep(root).filter((n) => n.tagName === 'BUTTON');
}

/** mock 里 style 是原始字符串，需要自行解析出百分比柱高 */
function barHeights(root) {
  return collectDeep(root)
    .filter((n) => n.className === 'insight-day-bar')
    .map((b) => {
      const m = String(b.style || '').match(/height:\s*([\d.]+)%/);
      return m ? Number(m[1]) : NaN;
    });
}

test('默认展示今天，且日期导航可用', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  const text = root.textContent;
  assert.match(text, /9\/9 周三/);
  assert.match(text, /今天 · 实时累计中/);
  assert.ok(btn(root, '‹'), '应有前一天按钮');
  assert.ok(btn(root, '›'), '应有后一天按钮');
  assert.ok(!btn(root, '回今天'), '已在今天时不应显示「回今天」');
});

test('前一天按钮切到昨天，KPI 与图表数据随之改变', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  assert.match(root.textContent, /45 分/, '今天专注 45 分');

  await btn(root, '‹')._listeners.click[0]({});

  assert.match(root.textContent, /9\/8 周二/);
  assert.match(root.textContent, /2 小时/, '昨天专注 120 分 = 2 小时');
  assert.ok(btn(root, '回今天'), '离开今天后应出现「回今天」');
});

test('可以一路往前翻到最早一天，且首日「‹」被禁用', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  const prev = btn(root, '‹');
  await prev._listeners.click[0]({});
  await btn(root, '‹')._listeners.click[0]({});

  assert.match(root.textContent, /9\/7 周一/);
  assert.match(root.textContent, /30 分/);
  assert.strictEqual(btn(root, '‹').disabled, true, '首日的「‹」应禁用');
});

test('最后一天的「›」被禁用', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  assert.strictEqual(btn(root, '›').disabled, true, '今天已是最新，应禁用「›」');
});

test('「回今天」把视图带回今天', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  await btn(root, '‹')._listeners.click[0]({});
  await btn(root, '‹')._listeners.click[0]({});
  assert.match(root.textContent, /9\/7/);

  await btn(root, '回今天')._listeners.click[0]({});
  assert.match(root.textContent, /9\/9 周三/);
  assert.match(root.textContent, /45 分/);
});

test('切换指标改变趋势图口径与柱体高度', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  assert.match(root.textContent, /每天投入了多少/, '默认指标是专注时长');

  await btn(root, '阅读字数')._listeners.click[0]({});

  assert.match(root.textContent, /复制与笔记里的字数/, '应切到阅读字数口径');
  // 三天阅读字数分别 100 / 5000 / 300，最大值 5000 → 2% / 100% / 6%（最低按 3% 兜底）
  assert.deepStrictEqual(barHeights(root), [3, 100, 6]);

  await btn(root, '手动键入')._listeners.click[0]({});
  assert.match(root.textContent, /在本应用输入框里敲下的字/);
});

test('切回专注时长后柱高恢复', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  const before = barHeights(root);
  // 专注时长 30 / 120 / 45，最大 120 → 25% / 100% / 37.5%→38%
  assert.deepStrictEqual(before, [25, 100, 38]);

  await btn(root, '阅读字数')._listeners.click[0]({});
  await btn(root, '专注时长')._listeners.click[0]({});

  assert.deepStrictEqual(barHeights(root), before, '切回原指标应还原柱高');
});

test('趋势图高亮当前查看的那一天', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  let active = collectDeep(root).filter((n) =>
    String(n.className || '').includes('insight-day-col is-active')
  );
  assert.strictEqual(active.length, 1, '每一天只应有一根高亮');
  assert.strictEqual(active[0].title, '2026-09-09 · 45 分 · 当前查看');

  await btn(root, '‹')._listeners.click[0]({});
  active = collectDeep(root).filter((n) => String(n.className || '').includes('insight-day-col is-active'));
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].title, '2026-09-08 · 2 小时 · 当前查看');
});

test('切换到历史日期时文案随之变化（不再是「今天」）', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  await btn(root, '‹')._listeners.click[0]({});
  const text = root.textContent;
  assert.match(text, /历史记录/, '应标记为历史记录');
  assert.match(text, /9\/8 节奏/, '小时图标题应带日期');
  assert.match(text, /当日目标/, 'KPI 应改为「当日目标」');
});

test('日期导航是轻量胶囊，不再占用整张卡片', () => {
  const { sandbox, root } = boot();
  return sandbox.InsightsView.render(root).then(() => {
    const nav = collectDeep(root).find((n) => n.className === 'insight-datenav');
    assert.ok(nav, '应使用 .insight-datenav 胶囊容器');
    assert.ok(!/card/.test(String(nav.className)), '日期导航不应再是 card，避免与 KPI 抢视觉重量');
  });
});

test('历史日期切换软件占用列表', async () => {
  const { sandbox, root } = boot();
  await sandbox.InsightsView.render(root);
  assert.match(root.textContent, /微信/, '今天只有微信');

  await btn(root, '‹')._listeners.click[0]({});
  const text = root.textContent;
  assert.match(text, /Chrome/, '昨天有 Chrome');
  assert.ok(!text.includes('微信'), '昨天的记录里不该出现今天的软件');
});

test('关闭统计时给出提示而非空白', async () => {
  const { sandbox, root } = boot({ showInsights: false });
  await sandbox.InsightsView.render(root);
  assert.match(root.textContent, /节律统计已在设置中关闭/);
});

test('dateLabel 解析不依赖时区', () => {
  const { sandbox } = boot();
  // insights.js 顶部就解构 LingUtil，无法直接 require；这里走 vm 里的 module 出口
  const { dateLabel } = sandbox.module.exports;
  assert.strictEqual(dateLabel('2026-09-09'), '9/9 周三');
  assert.strictEqual(dateLabel('2026-01-04'), '1/4 周日');
  assert.strictEqual(dateLabel('bad'), 'bad');
});