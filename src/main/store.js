const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
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
    capsuleAlive: true,
    capsulePoem: true,
    showInsights: true,
    insightsTargetMin: 240,
    enableKeyHook: false,
    mdEditorPath: '',
    shotsDir: '',
    firstRunDone: false,
  },
  activity: {
    date: '',
    workMs: 0,
    readChars: 0,
    typedKeys: 0,
    typedChars: 0,
    apps: {},
    hours: [],
    history: [],
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
  shots: [],
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

/** 仅对有保留期限的收件箱/历史列表截断。 */
const CAPS = {
  clips: 500,
  clipInbox: 300,
  shots: 300,
};

function capList(key, list) {
  const max = CAPS[key];
  if (!max || !Array.isArray(list)) return list;
  return list.length > max ? list.slice(0, max) : list;
}

function readWorkspace(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工作区格式错误');
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!(key in raw)) continue; // 早期版本没有全部分区
    if (!raw[key] || typeof raw[key] !== 'object' || Array.isArray(raw[key]) !== Array.isArray(value)) {
      throw new Error(`工作区分区 ${key} 格式错误`);
    }
  }
  return deepMerge(structuredClone(DEFAULTS), raw);
}

function snapshot(file, dest) {
  const tmp = dest + '.' + randomUUID() + '.tmp';
  try {
    try {
      fs.linkSync(file, tmp);
    } catch {
      fs.copyFileSync(file, tmp);
    }
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

class Store {
  constructor() {
    this.cache = null;
    this.newWorkspace = false;
    this.activityDirty = false;
    this.flushTimer = null;
  }

  load() {
    if (this.cache) return this.cache;
    const file = storePath();
    try {
      this.cache = readWorkspace(file);
      this.newWorkspace = false;
    } catch (err) {
      if (err.code !== 'ENOENT' || fs.existsSync(file + '.bak')) throw err;
      this.newWorkspace = true;
      this.cache = structuredClone(DEFAULTS);
    }
    return this.cache;
  }

  commit(next, backup = 'rolling') {
    const file = storePath();
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
      if (backup && fs.existsSync(file)) {
        snapshot(file, backup === 'rolling' ? file + '.bak' : backup);
      }
      fs.renameSync(tmp, file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    this.cache = next;
    this.newWorkspace = false;
    this.activityDirty = false;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    return next;
  }

  save(partial = {}) {
    const next = { ...this.load() };
    for (const [key, value] of Object.entries(partial)) {
      // 跨天时要用整份新统计替换旧日期的软件和小时明细。
      next[key] = key === 'activity' ? value : deepMerge(next[key], value);
    }
    return this.commit(next);
  }

  flush() {
    if (this.activityDirty) this.commit(this.cache);
  }

  importFile(source) {
    return this.replace(readWorkspace(source));
  }

  replace(next) {
    this.flush();
    const file = storePath();
    const backup = fs.existsSync(file) ? file + '.bak-' + randomUUID() : '';
    this.commit(next, backup);
    return backup;
  }

  getSection(key) {
    return this.load()[key];
  }

  setSection(key, value) {
    if (key === 'activity') {
      this.cache = { ...this.load(), activity: value };
      this.activityDirty = true;
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          try { this.flush(); } catch (err) { console.error('[store] activity flush failed', err); }
        }, 60000);
        this.flushTimer.unref?.();
      }
      return this.cache;
    }
    return this.save({ [key]: capList(key, value) });
  }

  reset() {
    return this.commit(structuredClone(DEFAULTS));
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
    if (!this.newWorkspace) {
      if (
        !settings.firstRunDone ||
        patched.compactWidth !== settings.compactWidth ||
        patched.compactHeight !== settings.compactHeight ||
        patched.expandedWidth !== settings.expandedWidth ||
        patched.expandedHeight !== settings.expandedHeight
      ) {
        return this.save({ settings: { ...patched, firstRunDone: true } });
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
    return this.commit(next);
  }
}

module.exports = {
  Store,
  DEFAULTS,
  SEED,
  CAPS,
  capList,
  dataDir,
  storePath,
  deepMerge,
};
