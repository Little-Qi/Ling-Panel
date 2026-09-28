/**
 * 手动键入统计
 * - 全局键数：keyhook.ps1（系统级键盘钩子 + WinForms 消息循环），只计次数
 * - 应用内字数：渲染层 beforeinput/composition 统计
 * 仅本地，不记录键值内容。全局钩子由设置开关控制（默认关）。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function keysPath(dataDir) {
  return path.join(dataDir, 'typed-keys.json');
}

/** 文件内容为纯数字累计键数；兼容旧 JSON {count} */
function readKeysFile(file) {
  try {
    if (!fs.existsSync(file)) return { count: 0 };
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return { count: 0 };
    if (/^\d+$/.test(raw)) return { count: Number(raw) };
    const j = JSON.parse(raw);
    return { count: Number(j && j.count) || 0 };
  } catch {
    return { count: 0 };
  }
}

function startKeyHook(dataDir) {
  const file = keysPath(dataDir);
  const script = path.join(__dirname, 'keyhook.ps1');
  let child = null;
  let lastCount = 0;
  let stopped = false;

  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (_) {}

  if (!fs.existsSync(script)) {
    return {
      stop() {},
      readDelta: () => 0,
    };
  }

  try {
    child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        script,
        '-OutFile',
        file,
      ],
      { windowsHide: true, stdio: 'ignore' }
    );
    child.on('error', () => {});
    child.unref?.();
  } catch {
    child = null;
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        if (child && !child.killed) child.kill();
      } catch (_) {}
    },
    readDelta() {
      const { count } = readKeysFile(file);
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
