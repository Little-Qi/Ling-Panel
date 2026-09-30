/**
 * 手动键入统计
 * - 全局键数：keyhook.ps1（LL keyboard hook + 消息泵），只计次数
 * - 应用内字数：渲染层 beforeinput/composition
 * 仅本地，不记录键值。全局钩子由设置开关控制（默认关）。
 *
 * 注意：累计键数写在 typed-keys.json（进程生命周期内单调增）。
 * 跨天/重启时用「基线」取增量，避免把历史总数灌进今天。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function keysPath(dataDir) {
  return path.join(dataDir, 'typed-keys.json');
}

function readKeysFile(file) {
  try {
    if (!fs.existsSync(file)) return { count: 0, mtimeMs: 0 };
    const st = fs.statSync(file);
    const raw = fs.readFileSync(file, 'utf8').trim();
    let count = 0;
    if (/^\d+$/.test(raw)) count = Number(raw);
    else {
      try {
        count = Number(JSON.parse(raw).count) || 0;
      } catch {
        count = 0;
      }
    }
    return { count, mtimeMs: st.mtimeMs || 0 };
  } catch {
    return { count: 0, mtimeMs: 0 };
  }
}

function startKeyHook(dataDir) {
  const file = keysPath(dataDir);
  const script = path.join(__dirname, 'keyhook.ps1');
  let child = null;
  let lastCount = null; // null = 尚未建立基线
  let stopped = false;
  let starting = false;

  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (_) {}

  function spawnHook() {
    if (!fs.existsSync(script)) return null;
    try {
      const c = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-OutFile', file],
        { windowsHide: true, stdio: 'ignore' }
      );
      c.on('error', () => {});
      c.unref?.();
      return c;
    } catch {
      return null;
    }
  }

  function isAlive() {
    return !!(child && child.exitCode === null && !child.killed);
  }

  function ensureAlive() {
    if (stopped) return false;
    if (isAlive()) return true;
    if (starting) return false;
    starting = true;
    try {
      child = spawnHook();
    } finally {
      starting = false;
    }
    return isAlive();
  }

  function restart() {
    try {
      if (child && !child.killed) child.kill();
    } catch (_) {}
    child = spawnHook();
  }

  if (!fs.existsSync(script)) {
    return { stop() {}, readDelta: () => 0, ensureAlive: () => false };
  }

  child = spawnHook();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        if (child && !child.killed) child.kill();
      } catch (_) {}
    },
    ensureAlive,
    restart,
    /** 自上次调用以来新增键数（首调用只建基线，返回 0） */
    readDelta() {
      const { count, mtimeMs } = readKeysFile(file);
      // 文件长时间不更新且进程疑似挂了 → 尝试拉起
      const stale = Date.now() - mtimeMs > 45000;
      if ((!isAlive() || stale) && !stopped) {
        restart();
      }
      if (lastCount === null) {
        lastCount = count;
        return 0;
      }
      const delta = Math.max(0, count - lastCount);
      lastCount = count;
      return delta;
    },
  };
}

module.exports = {
  keysPath,
  readKeysFile,
  startKeyHook,
};
