/**
 * 外部 Markdown 编辑器（灵墨 LingMark）集成
 *
 * 职责：
 * 1. 定位编辑器可执行文件（优先用户在设置里指定的，其次自动探测常见安装位置）
 * 2. 把笔记导出成 .md 文件并交给外部编辑器打开
 * 3. 监听该文件被外部修改，回写进 Store —— 这才是「用外部编辑器编辑笔记」闭环的关键
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/** 灵墨的产物名，用于自动探测 */
const EDITOR_EXE = 'LingMark.exe';

/** 自动探测的候选位置（按优先级） */
function candidatePaths() {
  const list = [];
  const local = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || '';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || '';
  if (local) {
    list.push(path.join(local, 'Programs', 'LingMark', EDITOR_EXE));
    list.push(path.join(local, 'LingMark', EDITOR_EXE));
  }
  if (programFiles) list.push(path.join(programFiles, 'LingMark', EDITOR_EXE));
  if (programFilesX86) list.push(path.join(programFilesX86, 'LingMark', EDITOR_EXE));
  return list;
}

/** 开发态：仓库里的 md-editor（用父工程的 electron 跑） */
function devCandidate() {
  try {
    const here = __dirname; // src/main
    const repoRoot = path.resolve(here, '..', '..', '..');
    const appDir = path.join(repoRoot, 'md-editor');
    const electron = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (fs.existsSync(path.join(appDir, 'package.json')) && fs.existsSync(electron)) {
      return { exe: electron, args: [appDir] };
    }
  } catch (_) {}
  return null;
}

/**
 * 解析出可执行的编辑器命令
 * @param {string} configured 用户在设置里填的路径（可为空）
 * @returns {{exe:string,args:string[],source:string}|null}
 */
function resolveEditor(configured) {
  const raw = String(configured || '').trim();
  if (raw) {
    // 允许填 "exe 参数" 的形式，方便开发态指向 electron
    const parts = raw.match(/"[^"]+"|\S+/g) || [];
    if (parts.length) {
      const exe = parts[0].replace(/^"|"$/g, '');
      const args = parts.slice(1).map((x) => x.replace(/^"|"$/g, ''));
      if (fs.existsSync(exe)) return { exe, args, source: 'configured' };
    }
    return null;
  }
  for (const c of candidatePaths()) {
    if (fs.existsSync(c)) return { exe: c, args: [], source: 'auto' };
  }
  const dev = devCandidate();
  if (dev) return { ...dev, source: 'dev' };
  return null;
}

/** 笔记导出目录：<dataDir>/notes */
function notesDir(dataDir) {
  return path.join(dataDir, 'notes');
}

/** 把笔记写成 .md 文件，返回文件路径 */
function exportNote(dataDir, noteId, content) {
  const dir = notesDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${noteId}.md`);
  fs.writeFileSync(file, String(content == null ? '' : content), 'utf8');
  return file;
}

/** 启动外部编辑器打开某个文件（分离进程，编辑器关闭不影响本应用） */
function openInEditor(editor, file) {
  try {
    const child = spawn(editor.exe, [...(editor.args || []), file], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * 监听导出目录里的 .md 变化。
 * 变更时回调 (file, content)，由调用方写回 Store。
 * @returns {() => void} 停止监听
 */
function watchNotes(dataDir, onChange) {
  const dir = notesDir(dataDir);
  let timer = null;
  const pending = new Map();

  fs.mkdirSync(dir, { recursive: true });
  const watcher = fs.watch(dir, (_evt, filename) => {
    if (!filename || !String(filename).toLowerCase().endsWith('.md')) return;
    const file = path.join(dir, String(filename));
    pending.set(file, true);
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const f of pending.keys()) {
        try {
          const content = fs.readFileSync(f, 'utf8');
          onChange(f, content);
        } catch (_) {}
      }
      pending.clear();
    }, 300);
  });

  return () => {
    clearTimeout(timer);
    try {
      watcher.close();
    } catch (_) {}
  };
}

/** 文件名 <noteId>.md → noteId */
function noteIdFromFile(file) {
  return path.basename(file).replace(/\.md$/i, '');
}

module.exports = {
  EDITOR_EXE,
  candidatePaths,
  devCandidate,
  resolveEditor,
  notesDir,
  exportNote,
  openInEditor,
  watchNotes,
  noteIdFromFile,
};
