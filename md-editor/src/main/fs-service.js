/**
 * 文件服务：读写 Markdown、原子保存、最近文件、图片落盘。
 * 全部走 Node fs，渲染进程只能通过 IPC 触达。
 */
const fs = require('fs');
const path = require('path');

const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

/** 原子写：先写 .tmp 再 rename，避免半截文件 */
function writeFileAtomic(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

function readFile(file) {
  try {
    return {
      ok: true,
      content: fs.readFileSync(file, 'utf8'),
      path: file,
      name: path.basename(file),
      // 图片粘贴时要落到文档同级目录，渲染层拿不到 node 的 path，这里一并给出
      baseDir: path.dirname(file),
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err), path: file };
  }
}

function writeFile(file, content) {
  try {
    writeFileAtomic(file, String(content == null ? '' : content));
    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, error: String(err.message || err), path: file };
  }
}

function statFile(file) {
  try {
    const st = fs.statSync(file);
    return { ok: true, mtimeMs: st.mtimeMs || 0, size: st.size };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** 最近文件：存 userData/recent.json，最多 10 条 */
class RecentFiles {
  constructor(file, limit = 10) {
    this.file = file;
    this.limit = limit;
    this.list = [];
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.list = Array.isArray(raw) ? raw.filter((x) => x && x.path) : [];
    } catch (_) {
      this.list = [];
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.list, null, 2), 'utf8');
    } catch (_) {}
  }

  add(file, name) {
    if (!file) return;
    this.list = this.list.filter((x) => x.path !== file);
    this.list.unshift({ path: file, name: name || path.basename(file), at: Date.now() });
    if (this.list.length > this.limit) this.list.length = this.limit;
    this.save();
  }

  remove(file) {
    this.list = this.list.filter((x) => x.path !== file);
    this.save();
  }

  clear() {
    this.list = [];
    this.save();
  }
}

/**
 * 保存图片到文档同级的 assets 目录，返回相对路径。
 * baseDir 为当前 .md 所在目录；没有则退回用户主目录下的 LingMark/assets。
 */
function saveImage(baseDir, dataUrl, hintName) {
  try {
    const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) return { ok: false, error: '不是有效的 data URL' };
    const mime = m[1].toLowerCase();
    const ext = IMAGE_EXT[mime];
    if (!ext) return { ok: false, error: `不支持的图片类型：${mime}` };
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return { ok: false, error: '图片内容为空' };

    const dir = baseDir ? path.join(baseDir, 'assets') : null;
    if (!dir) return { ok: false, error: '没有可用的保存目录' };
    fs.mkdirSync(dir, { recursive: true });

    const stem = (hintName || 'image').replace(/[^\w一-龥-]+/g, '_').slice(0, 40) || 'image';
    let name = `${stem}-${Date.now().toString(36)}${ext}`;
    let full = path.join(dir, name);
    let n = 1;
    while (fs.existsSync(full)) {
      name = `${stem}-${Date.now().toString(36)}-${n}${ext}`;
      full = path.join(dir, name);
      n += 1;
    }
    fs.writeFileSync(full, buf);
    return { ok: true, path: full, rel: path.join('assets', name).replace(/\\/g, '/') };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** 监听文件变化（外部编辑器改动了同一文件时通知渲染层） */
function watchFile(file, onChange) {
  let timer = null;
  try {
    fs.watch(file, () => {
      clearTimeout(timer);
      timer = setTimeout(() => onChange(), 250);
    });
  } catch (_) {}
  return () => {
    clearTimeout(timer);
  };
}

module.exports = {
  writeFileAtomic,
  readFile,
  writeFile,
  statFile,
  saveImage,
  watchFile,
  RecentFiles,
  IMAGE_EXT,
};
