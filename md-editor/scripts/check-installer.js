/**
 * 打包产物体检（LingMark 版）。
 *
 * 背景：electron-builder 收尾时会「跑一遍刚生成的安装包」来提取卸载程序。
 * 这一步一旦被 NSIS 弹窗卡住，构建进程会被杀掉/超时，但 dist 里已经留下一个
 * 几百 KB 的残缺 setup.exe —— 看上去构建「成功」了，装的时候才发现是坏包。
 *
 * 这里在 build:win 之后检查产物大小与配套文件，发现残缺直接失败。
 *
 * 注意：不要在这里给 dist 打完整性标签。构建/打包用的 7za、makensis 都位于
 * 项目内，在受限工作区里会以低完整性运行；把产物标成 Medium 会让下一次构建
 * 无法覆盖旧文件（7-Zip 报「拒绝访问」）。低完整性安装器的临时目录问题由
 * scripts/build-env.js 处理（确保 %TEMP%\Low 可写）。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

function fail(message) {
  console.error(`[check-installer] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(dist)) fail('dist 不存在，构建没有产出。');

const installers = fs
  .readdirSync(dist)
  .filter((name) => /^LingMark-.*-setup\.exe$/i.test(name))
  .map((name) => {
    const file = path.join(dist, name);
    const stat = fs.statSync(file);
    return { name, file, size: stat.size, mtime: stat.mtimeMs };
  })
  .sort((a, b) => b.mtime - a.mtime);

if (installers.length === 0) fail('dist 里没有找到 LingMark-*-setup.exe。');

const latest = installers[0];
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

const MIN_SIZE = 20 * 1024 * 1024;
if (latest.size < MIN_SIZE) {
  fail(
    `${latest.name} 只有 ${mb(latest.size)}，明显是残缺包。\n` +
      '  多半是 NSIS 在「提取卸载程序」阶段弹窗卡住后被中断。\n' +
      '  请确认 %TEMP%\\Low 可被安装器写入后重新执行 npm run build:win。'
  );
}

const blockmap = latest.file + '.blockmap';
if (!fs.existsSync(blockmap)) {
  fail(`缺少 ${path.basename(blockmap)}，构建可能未正常结束。`);
}

console.log(`[check-installer] OK  ${latest.name}  ${mb(latest.size)}`);
