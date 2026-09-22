/**
 * 本机工作量：净工作时长（键鼠活跃）、软件使用时长、阅读/摘录字量。
 * 仅本地统计，不上传。可在 node:test 中用注入时钟/前台探测单测。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyDay(date = dayKey()) {
  return {
    date,
    workMs: 0,
    readChars: 0,
    apps: {},
    updatedAt: Date.now(),
  };
}

/** 跨天滚动：只保留当天 */
function rollDay(stats, now = new Date()) {
  const key = dayKey(now);
  if (!stats || stats.date !== key) return emptyDay(key);
  return {
    date: stats.date,
    workMs: Number(stats.workMs) || 0,
    readChars: Number(stats.readChars) || 0,
    apps: stats.apps && typeof stats.apps === 'object' ? { ...stats.apps } : {},
    updatedAt: Number(stats.updatedAt) || Date.now(),
  };
}

/** 合并一个采样窗口 */
function applySample(stats, sample, now = Date.now()) {
  const next = rollDay(stats, new Date(now));
  if (sample.activeMs) next.workMs += Math.max(0, sample.activeMs);
  if (sample.readChars) next.readChars += Math.max(0, sample.readChars);
  if (sample.writeChars) next.readChars += Math.max(0, sample.writeChars);
  if (sample.app && sample.appMs) {
    next.apps[sample.app] = (next.apps[sample.app] || 0) + Math.max(0, sample.appMs);
  }
  next.updatedAt = now;
  return next;
}

function topApp(stats) {
  const apps = (stats && stats.apps) || {};
  let best = null;
  let bestMs = 0;
  for (const [name, ms] of Object.entries(apps)) {
    if (ms > bestMs) {
      bestMs = ms;
      best = name;
    }
  }
  return best ? { name: best, ms: bestMs } : null;
}

function summarize(stats) {
  const s = stats || emptyDay();
  const top = topApp(s);
  return {
    date: s.date,
    workMs: s.workMs,
    workMin: Math.floor(s.workMs / 60000),
    readChars: s.readChars,
    topApp: top ? prettifyApp(top.name) : '',
    topAppMs: top ? top.ms : 0,
    apps: s.apps,
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
    WXWork: '企业微信',
    DingTalk: '钉钉',
    explorer: '资源管理器',
    WindowsTerminal: '终端',
    idea64: 'IDEA',
    devenv: 'Visual Studio',
    pwsh: 'PowerShell',
    cmd: '命令提示符',
    LingPanel: '灵动手边',
  };
  return map[n] || n;
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
  /**
   * @param {object} opts
   *  store: { getSection, setSection }
   *  getIdleMs: () => number  （默认用 electron powerMonitor）
   *  probeApp: async () => string
   *  intervalMs: 采样间隔
   */
  constructor(opts = {}) {
    this.store = opts.store;
    this.getIdleMs = opts.getIdleMs || defaultIdleMs;
    this.probeApp = opts.probeApp || probeForeground;
    this.intervalMs = opts.intervalMs || 15000;
    this._timer = null;
    this._saving = false;
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

  /** 根据空闲时长折算本采样窗口的净工作毫秒 */
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
    let app = '';
    try {
      app = (await this.probeApp()) || '';
    } catch (_) {}
    if (app && /^(explorer|ShellExperienceHost|SearchHost|StartMenuExperienceHost)$/i.test(app)) {
      // 资源管理器/开始菜单不算主力软件
      app = app === 'explorer' ? 'explorer' : '';
    }
    const stats = applySample(this.store.getSection('activity'), {
      activeMs: credited,
      app: app || undefined,
      appMs: credited,
    }, now);
    this.save(stats);
    return summarize(stats);
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
  dayKey,
  emptyDay,
  rollDay,
  applySample,
  topApp,
  summarize,
  prettifyApp,
  probeForeground,
  ActivityTracker,
};
