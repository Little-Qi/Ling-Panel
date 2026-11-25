/**
 * preload 与 renderer fallback API 的一致性守卫
 *
 * 背景：src/renderer/app.js 的 createFallbackApi() 手工复制了 preload 暴露的全部 API。
 * preload 失败时（demo 模式）会用它整体替换 window.ling，
 * 因此任何新增的 ling.* API 如果没同步进 fallback，demo 模式会直接 TypeError。
 *
 * 这条测试把「必须同步」变成硬约束：新增域或方法时忘了改 fallback，这里立刻红。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const root = path.join(__dirname, '..');

/** 真实加载 preload.js，抓取它真正暴露给页面的对象 */
function loadPreloadApi() {
  let exposed = null;
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld: (_key, api) => {
            exposed = api;
          },
        },
        ipcRenderer: {
          invoke: async () => undefined,
          on: () => {},
          removeListener: () => {},
        },
      };
    }
    return origLoad(request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(path.join(root, 'preload.js'))];
    require(path.join(root, 'preload.js'));
  } finally {
    Module._load = origLoad;
  }
  assert.ok(exposed, 'preload 应当调用 contextBridge.exposeInMainWorld');
  return exposed;
}

/** 加载 app.js 并跑一次 boot（无 window.ling 时会装上 fallback），取回 fallback API */
async function loadFallbackApi() {
  const noop = () => {};
  function makeEl(tag) {
    return {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      className: '',
      style: {},
      dataset: {},
      hidden: false,
      value: '',
      checked: false,
      childNodes: [],
      _text: '',
      set textContent(v) {
        this._text = v;
      },
      get textContent() {
        return this._text;
      },
      set innerHTML(v) {
        this._html = v;
        this.childNodes = [];
      },
      get innerHTML() {
        return this._html || '';
      },
      appendChild(c) {
        this.childNodes.push(c);
        return c;
      },
      append() {},
      addEventListener: noop,
      removeEventListener: noop,
      setAttribute(k, v) {
        this[k] = v;
      },
      removeAttribute: noop,
      focus: noop,
      blur: noop,
      remove: noop,
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      matches: () => false,
    };
  }

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: noop,
    URLSearchParams,
    location: { search: '' },
    innerHeight: 0,
    addEventListener: noop,
    removeEventListener: noop,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    createElement: makeEl,
    createTextNode: (d) => ({ nodeType: 3, textContent: d }),
    // applyMood 会写 documentElement.style 上的 CSS 变量
    documentElement: { style: { setProperty: () => {} } },
    body: makeEl('body'),
    activeElement: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/shared/workspace-lists.js'), 'utf8'), sandbox);

  // app.js 的 boot 依赖 LingUtil
  const utilCode = fs.readFileSync(path.join(root, 'src/renderer/lib/util.js'), 'utf8');
  vm.runInContext(utilCode, sandbox, { filename: 'util.js' });

  const code = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'app.js' });
  assert.ok(sandbox.App, 'app.js 应当挂上 window.App');
  await sandbox.App.boot();
  assert.ok(sandbox.window.ling, 'boot 后应当存在 window.ling');
  assert.strictEqual(sandbox.window.ling.__fallback, true, '无 preload 时应装上 fallback');
  return sandbox.window.ling;
}

function domainsOf(api) {
  const out = {};
  for (const key of Object.keys(api)) {
    const v = api[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[key] = Object.keys(v).filter((m) => typeof v[m] === 'function');
    }
  }
  return out;
}

test('fallback API 覆盖 preload 暴露的每一个域', async () => {
  const preload = domainsOf(loadPreloadApi());
  const fallback = domainsOf(await loadFallbackApi());
  const missing = Object.keys(preload).filter((d) => !(d in fallback));
  assert.deepStrictEqual(missing, [], `fallback 缺少这些域：${missing.join(', ')}`);
});

test('fallback API 覆盖 preload 暴露的每一个方法', async () => {
  const preload = domainsOf(loadPreloadApi());
  const fallback = domainsOf(await loadFallbackApi());
  const missing = [];
  for (const [domain, methods] of Object.entries(preload)) {
    const have = new Set(fallback[domain] || []);
    for (const m of methods) {
      if (!have.has(m)) missing.push(`${domain}.${m}`);
    }
  }
  assert.deepStrictEqual(missing, [], `fallback 缺少这些方法：${missing.join(', ')}`);
});

test('preload 的事件白名单与 app.js 实际监听的通道一致', () => {
  const preloadSrc = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const m = preloadSrc.match(/const allowed = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, '应能找到 preload 的 allowed 集合');
  const allowed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const used = [...appSrc.matchAll(/on\('([^']+)'/g)].map((x) => x[1]);
  const notAllowed = used.filter((c) => !allowed.includes(c));
  assert.deepStrictEqual(notAllowed, [], `app.js 监听了未放行的通道：${notAllowed.join(', ')}`);
});
