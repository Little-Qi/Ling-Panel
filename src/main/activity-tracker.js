/**
 * 本机工作量：净工作时长（键鼠活跃）、软件使用时长、阅读/摘录字量。
 * 附带 24 小时分布与近 14 天摘要，供「节律」页可视化。仅本地，不上传。
 */
const { spawn } = require('child_process');

const HISTORY_LIMIT = 14;

function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyHours() {
  return Array.from({ length: 24 }, () => 0);
}

function emptyDay(date = dayKey()) {
  return {
    date,
    workMs: 0,
    readChars: 0,
    typedKeys: 0,
    typedChars: 0,
    apps: {},
    hours: emptyHours(),
    updatedAt: Date.now(),
  };
}

function normalizeDay(stats, date) {
  const hours = emptyHours();
  if (stats && Array.isArray(stats.hours)) {
    for (let i = 0; i < 24; i++) hours[i] = Number(stats.hours[i]) || 0;
  }
  return {
    date: date || (stats && stats.date) || dayKey(),
    workMs: Number(stats && stats.workMs) || 0,
    readChars: Number(stats && stats.readChars) || 0,
    typedKeys: Number(stats && stats.typedKeys) || 0,
    typedChars: Number(stats && stats.typedChars) || 0,
    apps: stats && stats.apps && typeof stats.apps === 'object' ? { ...stats.apps } : {},
    hours,
    updatedAt: Number(stats && stats.updatedAt) || Date.now(),
  };
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => normalizeDay(d, d && d.date))
    .filter((d) => d.date)
    .slice(-HISTORY_LIMIT);
}

/** 跨天：把旧日归档进 history，重开当天 */
function rollDay(stats, now = new Date()) {
  const key = dayKey(now);
  const history = normalizeHistory(stats && stats.history);
  if (stats && stats.date === key) {
    const day = normalizeDay(stats, key);
    day.history = history.filter((h) => h.date !== key);
    return day;
  }
  if (stats && stats.date) {
    const prev = normalizeDay(stats, stats.date);
    history.push(prev);
    while (history.length > HISTORY_LIMIT) history.shift();
  }
  const day = emptyDay(key);
  day.history = history.filter((h) => h.date !== key);
  return day;
}

/** 合并一个采样窗口 */
function applySample(stats, sample, now = Date.now()) {
  const when = new Date(now);
  const next = rollDay(stats, when);
  const hour = when.getHours();
  if (sample.activeMs) {
    next.workMs += Math.max(0, sample.activeMs);
    next.hours[hour] = (next.hours[hour] || 0) + Math.max(0, sample.activeMs);
  }
  if (sample.readChars) next.readChars += Math.max(0, sample.readChars);
  if (sample.writeChars) next.readChars += Math.max(0, sample.writeChars);
  if (sample.typedKeys) next.typedKeys = (next.typedKeys || 0) + Math.max(0, sample.typedKeys);
  if (sample.typedChars) next.typedChars = (next.typedChars || 0) + Math.max(0, sample.typedChars);
  if (sample.app && sample.appMs) {
    next.apps[sample.app] = (next.apps[sample.app] || 0) + Math.max(0, sample.appMs);
  }
  next.updatedAt = now;
  return next;
}

function topApps(stats, limit = 8) {
  const apps = (stats && stats.apps) || {};
  return Object.entries(apps)
    .map(([name, ms]) => ({ id: name, name: prettifyApp(name), ms: Number(ms) || 0 }))
    .filter((a) => a.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);
}

function topApp(stats) {
  const list = topApps(stats, 1);
  return list[0] ? { name: list[0].id, ms: list[0].ms } : null;
}

function summarize(stats) {
  const s = stats || emptyDay();
  const top = topApp(s);
  return {
    date: s.date,
    workMs: s.workMs,
    workMin: Math.floor(s.workMs / 60000),
    readChars: s.readChars,
    typedKeys: s.typedKeys || 0,
    typedChars: s.typedChars || 0,
    topApp: top ? prettifyApp(top.name) : '',
    topAppMs: top ? top.ms : 0,
    apps: s.apps,
  };
}

/** 「节律」页数据包：展示当前存储日，不强制滚到系统今天 */
function insightsPayload(stats) {
  const today = normalizeDay(stats, stats && stats.date);
  const history = normalizeHistory(stats && stats.history).filter((h) => h.date !== today.date);
  const days = [...history, today].slice(-14);
  return {
    date: today.date,
    workMs: today.workMs,
    workMin: Math.floor(today.workMs / 60000),
    readChars: today.readChars,
    typedKeys: today.typedKeys || 0,
    typedChars: today.typedChars || 0,
    hours: today.hours.slice(),
    apps: topApps(today, 10),
    days: days.map((d) => ({
      date: d.date,
      workMin: Math.floor(d.workMs / 60000),
      workMs: d.workMs,
      readChars: d.readChars,
      typedChars: d.typedChars || 0,
      typedKeys: d.typedKeys || 0,
    })),
  };
}

function prettifyApp(name) {
  const n = String(name || '').replace(/\.exe$/i, '');
  const map = {
    Code: 'VS Code',
    chrome: 'Chrome',
    msedge: 'Edge',
    firefox: 'Firefox',
    WeChat: '微信',
    Weixin: '微信',
    weixin: '微信',
    WXWork: '企业微信',
    WeCom: '企业微信',
    DingTalk: '钉钉',
    explorer: '资源管理器',
    WindowsTerminal: '终端',
    idea64: 'IDEA',
    devenv: 'Visual Studio',
    pwsh: 'PowerShell',
    cmd: '命令提示符',
    LingPanel: '灵动手边',
    ApplicationFrameHost: '系统应用',
    SearchHost: '搜索',
    StartMenuExperienceHost: '开始菜单',
    ShellExperienceHost: '系统界面',
  };
  return map[n] || n;
}

/** 不参与「主力软件」的进程 */
const IGNORED_APPS = new Set([
  '',
  'explorer',
  'SearchHost',
  'StartMenuExperienceHost',
  'ShellExperienceHost',
  'ApplicationFrameHost',
  'ShellHost',
  'TextInputHost',
  'LingPanel',
  'ling-panel',
]);

function normalizeAppName(raw) {
  return String(raw || '')
    .trim()
    .split(/\r?\n/)
    .pop()
    .replace(/\.exe$/i, '')
    .trim();
}

/** Windows：读前台进程名（超时返回空） */
function probeForeground(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $sig = @'
using System;
using System.Runtime.InteropServices;
public class LingFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@
  try { Add-Type -TypeDefinition $sig -ErrorAction Stop } catch {}
  $h = [LingFg]::GetForegroundWindow()
  $procId = 0
  [void][LingFg]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($procId) { (Get-Process -Id $procId -ErrorAction Stop).ProcessName }
} catch {}
`;
    let out = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(out.trim().split(/\r?\n/).pop() || '');
    };
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch (_) {}
        finish();
      }, timeoutMs);
      child.stdout.on('data', (c) => {
        out += c.toString('utf8');
      });
      child.on('error', () => {
        clearTimeout(timer);
        finish();
      });
      child.on('close', () => {
        clearTimeout(timer);
        finish();
      });
    } catch (_) {
      finish();
    }
  });
}

class ActivityTracker {
  constructor(opts = {}) {
    this.store = opts.store;
    this.getIdleMs = opts.getIdleMs || defaultIdleMs;
    this.probeApp = opts.probeApp || probeForeground;
    // 10s 采样：进程探测会 spawn PowerShell，不宜过密
    this.intervalMs = opts.intervalMs || 10000;
    this._timer = null;
    // 连续两次看到同一前台进程才计入，减少通知弹窗抢焦点的误差
    this._stableApp = '';
    this._candidateApp = '';
    this._lastProbedApp = '';
    this._probeTick = 0;
  }

  load() {
    return rollDay(this.store.getSection('activity'));
  }

  save(stats) {
    this.store.setSection('activity', stats);
    return stats;
  }

  addReadChars(n) {
    const stats = rollDay(this.store.getSection('activity'));
    stats.readChars += Math.max(0, Number(n) || 0);
    stats.updatedAt = Date.now();
    return this.save(stats);
  }

  addWriteChars(n) {
    return this.addReadChars(n);
  }

  addTypedKeys(n) {
    const stats = rollDay(this.store.getSection('activity'));
    stats.typedKeys = (stats.typedKeys || 0) + Math.max(0, Number(n) || 0);
    stats.updatedAt = Date.now();
    return this.save(stats);
  }

  /** 跨天后把键数基线交给新一天（钩子累计值继续用） */
  rolloverDayIfNeeded() {
    const stats = rollDay(this.store.getSection('activity'));
    return this.save(stats);
  }

  addTypedChars(n) {
    const stats = rollDay(this.store.getSection('activity'));
    stats.typedChars = (stats.typedChars || 0) + Math.max(0, Number(n) || 0);
    stats.updatedAt = Date.now();
    return this.save(stats);
  }

  sampleActive(windowMs) {
    const idleMs = Math.max(0, Number(this.getIdleMs()) || 0);
    let credited;
    if (idleMs < windowMs * 0.33) credited = windowMs;
    else if (idleMs >= windowMs) credited = 0;
    else credited = Math.round(windowMs - idleMs);
    return { credited, idleMs };
  }

  async tick() {
    const now = Date.now();
    const { credited } = this.sampleActive(this.intervalMs);

    // 前台进程探测有进程创建成本：隔次探测，中间沿用上次结果
    this._probeTick += 1;
    let app = this._lastProbedApp;
    if (this._probeTick === 1 || this._probeTick % 2 === 0) {
      try {
        app = normalizeAppName((await this.probeApp()) || '');
      } catch (_) {
        app = this._lastProbedApp;
      }
      this._lastProbedApp = app;
    }
    const usable = app && !IGNORED_APPS.has(app) ? app : '';

    // 稳定前台：连续两窗相同才记，避免微信通知一闪就吃掉整段时间
    let creditApp = '';
    if (usable && usable === this._stableApp) {
      creditApp = usable;
    } else if (usable && usable === this._candidateApp) {
      this._stableApp = usable;
      creditApp = usable;
    } else if (usable) {
      this._candidateApp = usable;
    } else {
      this._candidateApp = '';
    }

    const stats = applySample(
      this.store.getSection('activity'),
      {
        activeMs: credited,
        app: creditApp || undefined,
        appMs: creditApp ? credited : 0,
      },
      now
    );
    this.save(stats);
    return summarize(stats);
  }

  insights() {
    return insightsPayload(this.store.getSection('activity'));
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.intervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}

function defaultIdleMs() {
  try {
    const { powerMonitor } = require('electron');
    return (powerMonitor.getSystemIdleTime() || 0) * 1000;
  } catch {
    return 0;
  }
}

module.exports = {
  HISTORY_LIMIT,
  dayKey,
  emptyDay,
  emptyHours,
  rollDay,
  applySample,
  topApp,
  topApps,
  summarize,
  insightsPayload,
  prettifyApp,
  probeForeground,
  IGNORED_APPS,
  normalizeAppName,
  ActivityTracker,
};
