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
 * 3) 沙箱 / 低完整性进程（以及被降权的安装器）会把 NSIS 的 $TEMP 解析成
 *    %TEMP%\Low。如果这个目录不存在、或是普通权限进程留下的空壳，安装器写不进去，
 *    NSIS 就弹：
 *      Error writing temporary file. Make sure your temp folder is valid.
 *    构建时它卡住的是 electron-builder 的「提取卸载程序」那一步，
 *    产物只剩几百 KB；安装时它会让安装器直接退出。
 *    → 这里确保 %TEMP%\Low 存在，并显式设成 Low 完整性（低权限进程可写）。
 *
 * 用法：node --require ./scripts/build-env.js ./node_modules/electron-builder/out/cli/cli.js --win nsis
 */
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.join(__dirname, '..');
const tempDir = path.join(root, '.build-temp');
const userTemp = process.env.TEMP || process.env.TMP || '';

/**
 * 低完整性安装器的临时目录是 %TEMP%\Low。
 * 旧版本 / 沙箱留下的 Low 目录常常是普通权限的空目录，安装器写不进去，
 * 于是报「Error writing temporary file」。
 * 这里把它建出来，并把完整性级别显式设为 Low（低权限进程可写、高权限进程也能写）。
 */
function ensureLowIntegrityTemp() {
  if (process.platform !== 'win32' || !userTemp) return;
  const low = path.join(userTemp, 'Low');
  try {
    if (!fs.existsSync(low)) fs.mkdirSync(low, { recursive: true });
  } catch (err) {
    console.warn(`[build-env] 无法创建 ${low}：${err.message}`);
    return;
  }
  const icacls = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe');
  if (!fs.existsSync(icacls)) return;
  try {
    childProcess.execFileSync(icacls, [low, '/setintegritylevel', '(OI)(CI)L', '/T', '/C', '/Q'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    console.log(`[build-env] 已确保 ${low} 为低完整性可写目录`);
  } catch (err) {
    console.warn(`[build-env] 设置 ${low} 的完整性级别失败（可忽略）：${err.message}`);
  }
}

ensureLowIntegrityTemp();

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
