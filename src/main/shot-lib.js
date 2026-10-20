/**
 * 截图收件箱：扫描截图目录（Snipaste 的 Auto Save 目录等），
 * 把新截图收录进来，按内容指纹去重。
 *
 * 与论文库同构：扫描目录 → 识别新增 → 内容哈希去重 → 归档/忽略。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { contentFingerprint } = require('./paper-lib');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

/** Snipaste 默认把自动保存的截图放在「图片\Snipaste」 */
function defaultShotsDir() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Pictures', 'Snipaste'),
    path.join(home, '图片', 'Snipaste'),
    path.join(home, 'Pictures'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  return path.join(home, 'Pictures', 'Snipaste');
}

/** 统一库目录：把收录的截图集中放一份，便于后续引用 */
function libraryRoot(dataDir) {
  return path.join(dataDir, 'shots');
}

function isImage(file) {
  return IMAGE_EXT.has(path.extname(String(file || '')).toLowerCase());
}

/** 目录里所有图片文件（单层，Snipaste 不会自己建子目录） */
function listImages(dir) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return out;
  }
  for (const name of names) {
    if (!isImage(name)) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      out.push({
        path: full,
        name,
        size: st.size,
        mtimeMs: st.mtimeMs || 0,
      });
    } catch (_) {}
  }
  return out;
}

/** 从文件名里提取时间：Snipaste 默认命名 2026-10-20_143022.png */
function parseShotTime(name, mtimeMs) {
  const s = String(name || '');
  const m = s.match(/(\d{4})[-_](\d{2})[-_](\d{2})[ _-](\d{2})(\d{2})(\d{2})/);
  if (m) {
    const t = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    );
    if (!Number.isNaN(t.getTime())) return t.getTime();
  }
  const m2 = s.match(/(\d{4})(\d{2})(\d{2})[ _-](\d{2})(\d{2})(\d{2})/);
  if (m2) {
    const t = new Date(
      Number(m2[1]),
      Number(m2[2]) - 1,
      Number(m2[3]),
      Number(m2[4]),
      Number(m2[5]),
      Number(m2[6])
    );
    if (!Number.isNaN(t.getTime())) return t.getTime();
  }
  return mtimeMs || Date.now();
}

/**
 * 扫描截图目录，找出「还没收录过」的新截图。
 * 判重两道：
 *  1. 同路径已收录 → 跳过
 *  2. 内容指纹相同（同一张图换了名字）→ 跳过
 *
 * @param {string} dir 截图目录
 * @param {Array} known 已收录列表（含 path / fp）
 * @param {{limit?:number}} [opts]
 */
function scanShots(dir, known, opts = {}) {
  const limit = Math.max(1, Math.min(Number(opts.limit) || 60, 300));
  const knownPaths = new Set((known || []).map((s) => s.path));
  const knownFps = new Set((known || []).map((s) => s.fp).filter(Boolean));

  // 先算捕获时间，再按它倒序。
  // 不能用文件 mtime 排序：截图被复制/移动后 mtime 就会变，
  // 而 Snipaste 的文件名里带的是真正的拍摄时刻。
  const files = listImages(dir)
    .map((f) => ({ ...f, at: parseShotTime(f.name, f.mtimeMs) }))
    .sort((a, b) => b.at - a.at);

  const fresh = [];
  for (const f of files) {
    if (knownPaths.has(f.path)) continue;
    if (fresh.length >= limit) break;
    fresh.push({ ...f, fp: '' });
  }

  // 内容指纹去重：同一张图改名重复保存的，不重复收录
  const out = [];
  const seenThisScan = new Set();
  for (const f of fresh) {
    const fp = contentFingerprint(f.path);
    if (fp && (knownFps.has(fp) || seenThisScan.has(fp))) continue;
    if (fp) seenThisScan.add(fp);
    out.push({ ...f, fp });
  }
  return out;
}

/** 复制到库目录，返回库内文件路径 */
function copyIntoLibrary(dataDir, srcPath) {
  const root = libraryRoot(dataDir);
  fs.mkdirSync(root, { recursive: true });
  const base = path.basename(srcPath);
  let name = base;
  let full = path.join(root, name);
  let n = 1;
  while (fs.existsSync(full)) {
    const ext = path.extname(base);
    name = `${path.basename(base, ext)}-${n}${ext}`;
    full = path.join(root, name);
    n += 1;
  }
  fs.copyFileSync(srcPath, full);
  return full;
}

/**
 * 把截图图片转成可被笔记引用的形式：
 * 复制到 assets 目录，并返回 file:// URL。
 * 笔记存在 workspace.json 里（不是磁盘上的 .md），所以这里必须用绝对 file:// URL。
 */
function toNoteAsset(dataDir, srcPath, dataUrl) {
  const assetsDir = path.join(dataDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const ext = path.extname(srcPath) || '.png';
  const stem = path.basename(srcPath, ext).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40) || 'shot';
  let name = `${stem}-${Date.now().toString(36)}${ext}`;
  let full = path.join(assetsDir, name);
  let n = 1;
  while (fs.existsSync(full)) {
    name = `${stem}-${Date.now().toString(36)}-${n}${ext}`;
    full = path.join(assetsDir, name);
    n += 1;
  }
  if (dataUrl) {
    const m = String(dataUrl).match(/^data:[^;]+;base64,(.+)$/s);
    if (m) fs.writeFileSync(full, Buffer.from(m[1], 'base64'));
    else fs.copyFileSync(srcPath, full);
  } else {
    fs.copyFileSync(srcPath, full);
  }
  return {
    path: full,
    url: 'file:///' + full.replace(/\\/g, '/').replace(/^\/+/, ''),
  };
}

/** 读图片为 data URL（用于复制到剪贴板） */
function readAsDataUrl(file) {
  try {
    const ext = path.extname(file).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.gif' ? 'image/gif'
      : ext === '.webp' ? 'image/webp'
      : ext === '.bmp' ? 'image/bmp'
      : 'application/octet-stream';
    const buf = fs.readFileSync(file);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (_) {
    return '';
  }
}

module.exports = {
  IMAGE_EXT,
  defaultShotsDir,
  libraryRoot,
  isImage,
  listImages,
  parseShotTime,
  scanShots,
  copyIntoLibrary,
  toNoteAsset,
  readAsDataUrl,
};
