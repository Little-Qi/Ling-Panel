/**
 * afterPack：把 assets/app-icon.ico 写入 LingPanel.exe
 * 离线可用，不依赖 electron-builder 联网拉 winCodeSign。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findRcedit() {
  const candidates = [
    path.join(
      process.env.LOCALAPPDATA || '',
      'electron-builder',
      'Cache',
      'winCodeSign',
      'winCodeSign-2.6.0',
      'rcedit-x64.exe'
    ),
    path.join(
      process.env.LOCALAPPDATA || '',
      'electron-builder',
      'Cache',
      'winCodeSign-2.6.0',
      'rcedit-x64.exe'
    ),
    path.join(__dirname, 'rcedit-x64.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const appOutDir = context.appOutDir;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(appOutDir, exeName);
  const icoPath = path.join(projectDir, 'assets', 'app-icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe not found:', exePath);
    return;
  }
  if (!fs.existsSync(icoPath)) {
    console.warn('[afterPack] ico not found:', icoPath);
    return;
  }

  const rcedit = findRcedit();
  if (!rcedit) {
    console.warn('[afterPack] rcedit not found, skip icon embed');
    return;
  }

  console.log('[afterPack] set icon', icoPath, '->', exePath);
  execFileSync(rcedit, ['--set-icon', icoPath, exePath], { stdio: 'inherit' });
  // 同步产品名，资源管理器显示更完整
  try {
    execFileSync(
      rcedit,
      [
        '--set-version-string',
        'ProductName',
        context.packager.appInfo.productName,
        '--set-version-string',
        'FileDescription',
        context.packager.appInfo.productName,
        '--set-file-version',
        context.packager.appInfo.version,
        '--set-product-version',
        context.packager.appInfo.version,
        exePath,
      ],
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.warn('[afterPack] version string skip:', err.message);
  }
  console.log('[afterPack] icon embed ok');
};
