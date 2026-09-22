const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  settings: {
    theme: 'aurora',
    accent: '#6C8CFF',
    dock: 'top-center',
    compactStyle: 'capsule',
    compactWidth: 200,
    compactHeight: 36,
    compactVerticalWidth: 44,
    compactVerticalHeight: 168,
    expandedWidth: 760,
    expandedHeight: 560,
    floatCenter: false,
    alwaysOnTop: true,
    alwaysOnTopWhenDocked: true,
    pauseTopmostOnInput: true,
    autoCollapseOnBlur: false,
    edgeAutoHide: true,
    edgeHideDelayMs: 1800,
    edgePeekPx: 4,
    enableAiNotify: false,
    launchAtLogin: false,
    defaultTab: 'home',
    reminderMinutes: 60,
    paperRoot: '',
    paperArchiveMode: 'copy',
    downloadsDir: '',
    clipboardWatch: true,
    clipboardNotify: false,
    clipboardNotify: false,
    clipboardNotify: false,
    clipboardNotify: false,
    clipboardNotify: false,
    clipboardNotify: false,
    firstRunDone: false,
  },
  workflows: [
    { id: 'today', name: '今天', color: '#6C8CFF' },
    { id: 'doing', name: '进行中', color: '#F5A524' },
    { id: 'waiting', name: '待反馈', color: '#14B8A6' },
    { id: 'done', name: '已完成', color: '#22C55E' },
  ],
  todos: [],
  notes: [],
  links: [],
  clips: [],
  clipInbox: [],
  clipInbox: [],
  clipInbox: [],
  clipInbox: [],
  clipInbox: [],
  clipInbox: [],
  pomodoro: {
    focusMin: 25,
    breakMin: 5,
    longBreakMin: 15,
    cyclesBeforeLong: 4,
    history: [],
  },
  home: {
    hiddenModules: [],
  },
  meta: {
    schema: 1,
  },
};

const SEED = {
  todos: [
    {
      id: 'seed_todo_1',
      title: '欢迎使用灵动面板：点击胶囊展开/收起',
      status: 'doing',
      dueAt: Date.now() + 2 * 3600e3,
      note: 'Alt+Space 也可切换',
      priority: 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'seed_todo_2',
      title: '在「笔记」里试试 Markdown 预览',
      status: 'today',
      dueAt: (() => {
        const d = new Date();
        d.setHours(23, 30, 0, 0);
        return d.getTime();
      })(),
      note: '',
      priority: 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
  notes: [
    {
      id: 'seed_note_1',
      title: 'Markdown 示例',
      content:
        '# Markdown 已启用\n\n这是 **加粗**，这是 `行内代码`。\n\n## 列表\n\n- 待办工作流\n- 链接收藏\n- 番茄钟\n\n```js\nconsole.log("灵动面板");\n```\n\n> 点击左侧笔记可切换，右侧实时预览。\n',
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
  links: [
    {
      id: 'seed_link_1',
      url: 'https://github.com',
      title: 'GitHub',
      group: '常用',
      favicon: '',
      createdAt: Date.now(),
    },
  ],
};

function dataDir() {
  const dir = process.env.LING_PANEL_DATA || path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function storePath() {
  return path.join(dataDir(), 'workspace.json');
}

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch !== undefined ? patch : base;
  if (typeof base !== 'object' || base === null || typeof patch !== 'object' || patch === null) {
    return patch !== undefined ? patch : base;
  }
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    out[key] = deepMerge(base[key], patch[key]);
  }
  return out;
}

class Store {
  constructor() {
    this.cache = null;
  }

  load() {
    if (this.cache) return this.cache;
    const file = storePath();
    let raw = {};
    try {
      if (fs.existsSync(file)) {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (err) {
      console.error('[store] failed to read workspace, using defaults', err);
    }
    this.cache = deepMerge(DEFAULTS, raw);
    return this.cache;
  }

  save(partial) {
    const next = deepMerge(this.load(), partial || {});
    this.cache = next;
    const file = storePath();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return next;
  }

  getSection(key) {
    return this.load()[key];
  }

  setSection(key, value) {
    return this.save({ [key]: value });
  }

  reset() {
    this.cache = JSON.parse(JSON.stringify(DEFAULTS));
    this.save({});
    return this.cache;
  }

  ensureSeed() {
    const data = this.load();
    const settings = data.settings || {};
    const patched = {
      ...settings,
      compactWidth: Math.min(Math.max(Number(settings.compactWidth) || 200, 140), 260),
      compactHeight: Math.min(Math.max(Number(settings.compactHeight) || 36, 28), 44),
      expandedWidth: Math.min(Math.max(Number(settings.expandedWidth) || 760, 520), 1400),
      expandedHeight: Math.min(Math.max(Number(settings.expandedHeight) || 560, 360), 1000),
    };
    if (settings.firstRunDone) {
      if (
        patched.compactWidth !== settings.compactWidth ||
        patched.compactHeight !== settings.compactHeight
      ) {
        this.cache = { ...data, settings: patched };
        return this.save(this.cache);
      }
      return data;
    }
    const next = {
      ...data,
      todos: Array.isArray(data.todos) && data.todos.length ? data.todos : JSON.parse(JSON.stringify(SEED.todos)),
      notes: Array.isArray(data.notes) && data.notes.length ? data.notes : JSON.parse(JSON.stringify(SEED.notes)),
      links: Array.isArray(data.links) && data.links.length ? data.links : JSON.parse(JSON.stringify(SEED.links)),
      settings: { ...patched, firstRunDone: true },
    };
    this.cache = next;
    return this.save(next);
  }
}

module.exports = {
  Store,
  DEFAULTS,
  SEED,
  dataDir,
  storePath,
  deepMerge,
};
