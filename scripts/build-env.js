/**
 * 打包环境修复（Windows）。
 *
 * 解决的问题：
 * 1) NSIS(makensis) 会在 %TEMP% 留临时文件；残留一多，它编译时会发
 *    "you may have one or two (large) stale temporary file(s)" 警告。
 *    electron-builder 永远给 makensis 传 -WX（警告即错误），于是整包构建失败。
 *    → 这里给构建指定一个专用的干净临时目录。
 * 2) electron-builder 在 Windows 上给子进程设置 env 时是「整个替换」而非合并
 *    （builder-util/out/util.js 的 getProcessEnv：win32 分支直接 return env），
 *    导致 TEMP/TMP 丢失。→ 这里给所有子进程补回 TEMP/TMP。
 *
 * 用法：node --require ./scripts/build-env.js ./node_modules/electron-builder/out/cli/cli.js --win nsis
 */
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.join(__dirname, '..');
const tempDir = path.join(root, '.build-temp');

// 专用临时目录：每次构建前清空，保证 NSIS 看不到历史残留
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch (_) {}
try {
  fs.mkdirSync(tempDir, { recursive: true });
} catch (_) {}
process.env.TEMP = tempDir;
process.env.TMP = tempDir;

function withTemp(env) {
  if (!env || env.TEMP) return env;
  const fixed = { ...env };
  fixed.TEMP = tempDir;
  fixed.TMP = tempDir;
  return fixed;
}

const origExecFile = childProcess.execFile;
childProcess.execFile = function patchedExecFile(file, args, options, callback) {
  if (Array.isArray(args)) {
    if (options && options.env) options = { ...options, env: withTemp(options.env) };
    return origExecFile.call(childProcess, file, args, options, callback);
  }
  if (args && args.env) {
    return origExecFile.call(childProcess, file, { ...args, env: withTemp(args.env) }, options);
  }
  return origExecFile.apply(childProcess, arguments);
};

const origSpawn = childProcess.spawn;
childProcess.spawn = function patchedSpawn(command, args, options) {
  if (options && options.env) options = { ...options, env: withTemp(options.env) };
  return origSpawn.apply(childProcess, arguments);
};
