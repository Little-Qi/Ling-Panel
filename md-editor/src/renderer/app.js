/**
 * 灵墨 LingMark — 渲染层应用外壳
 * 负责：文件打开/保存/另存为、导出 HTML、最近文件、未保存改动保护、菜单事件。
 */
(function () {
  const host = document.getElementById('editorHost');
  let editor = null;
  let currentPath = '';
  let currentName = '';

  function fileBaseName(p) {
    const s = String(p || '');
    const i = s.lastIndexOf('\\') >= 0 ? s.lastIndexOf('\\') : s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function fileDir(p) {
    const s = String(p || '');
    const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i >= 0 ? s.slice(0, i) : '';
  }

  function applyFileInfo(info) {
    currentPath = (info && info.path) || '';
    currentName = (info && info.name) || fileBaseName(currentPath);
    if (editor) {
      editor.setFileInfo({
        name: currentName,
        path: currentPath,
        baseDir: (info && info.baseDir) || fileDir(currentPath),
      });
    }
    document.title = (currentName || '未命名.md') + (editor && editor.isDirty() ? ' ●' : '') + ' — 灵墨';
  }

  async function openFile(file) {
    if (!file) return;
    if (editor && editor.isDirty()) {
      const res = await window.lm.app.confirm({
        title: '有未保存的修改',
        message: '当前文档尚未保存',
        detail: '打开新文件会丢弃这些修改。',
        buttons: ['放弃并打开', '取消'],
      });
      if (!res || !res.confirmed) return;
    }
    const res = await window.lm.file.read(file);
    if (!res || !res.ok) {
      await window.lm.app.confirm({
        type: 'error',
        title: '打开失败',
        message: '无法打开该文件',
        detail: (res && res.error) || file,
        buttons: ['好'],
      });
      return;
    }
    if (editor) {
      editor.setValue(res.content, { silent: true });
      editor.markClean();
    }
    applyFileInfo(res);
    await window.lm.recent.add(file);
  }

  async function saveFile() {
    if (!editor) return false;
    if (!currentPath) return saveFileAs();
    const res = await window.lm.file.write(currentPath, editor.getValue());
    if (!res || !res.ok) {
      await window.lm.app.confirm({
        type: 'error',
        title: '保存失败',
        message: '写入文件时出错',
        detail: (res && res.error) || '',
        buttons: ['好'],
      });
      return false;
    }
    editor.markClean();
    applyFileInfo({ path: currentPath, name: currentName, baseDir: fileDir(currentPath) });
    return true;
  }

  async function saveFileAs() {
    if (!editor) return false;
    const res = await window.lm.file.saveDialog(currentName || '未命名.md');
    if (!res || !res.ok) return false;
    const w = await window.lm.file.write(res.path, editor.getValue());
    if (!w || !w.ok) {
      await window.lm.app.confirm({
        type: 'error',
        title: '保存失败',
        message: '写入文件时出错',
        detail: (w && w.error) || '',
        buttons: ['好'],
      });
      return false;
    }
    currentPath = res.path;
    currentName = fileBaseName(res.path);
    editor.markClean();
    applyFileInfo({ path: currentPath, name: currentName, baseDir: fileDir(currentPath) });
    await window.lm.recent.add(currentPath);
    return true;
  }

  async function newFile() {
    if (!editor) return;
    if (editor.isDirty()) {
      const res = await window.lm.app.confirm({
        title: '有未保存的修改',
        message: '当前文档尚未保存',
        detail: '新建文档会丢弃这些修改。',
        buttons: ['放弃并新建', '取消'],
      });
      if (!res || !res.confirmed) return;
    }
    editor.setValue('', { silent: true });
    editor.markClean();
    currentPath = '';
    currentName = '';
    applyFileInfo({ path: '', name: '', baseDir: '' });
  }

  async function openDialog() {
    const res = await window.lm.file.openDialog();
    if (res && res.ok) await openFile(res.path);
  }

  async function exportHtml() {
    if (!editor) return;
    const res = await window.lm.file.exportHtmlDialog(currentName || '未命名.md');
    if (!res || !res.ok) return;
    const html = window.LingMarkdown.exportHtml(editor.getValue(), currentName || '未命名');
    const w = await window.lm.file.write(res.path, html);
    if (!w || !w.ok) {
      await window.lm.app.confirm({
        type: 'error',
        title: '导出失败',
        message: '写入 HTML 时出错',
        detail: (w && w.error) || '',
        buttons: ['好'],
      });
      return;
    }
    await window.lm.app.confirm({
      title: '导出完成',
      message: '已导出为 HTML',
      detail: res.path,
      buttons: ['好'],
    });
  }

  function bindEvents() {
    const on = (ch, fn) => {
      if (window.lm && window.lm.events && window.lm.events.on) window.lm.events.on(ch, fn);
    };

    on('file:open-request', (file) => openFile(file));
    on('file:new', newFile);
    on('file:open-dialog', openDialog);
    on('file:save', saveFile);
    on('file:save-as', saveFileAs);
    on('file:export-html', exportHtml);
    on('editor:find', () => editor && editor.toggleFind());
    on('editor:zen', () => editor && editor.toggleZen());
    on('editor:command', () => editor && editor.openCommandPalette(''));
    on('editor:mode', (m) => editor && editor.setMode(m));
    on('editor:help', showHelp);

    // 主进程在关闭前询问：是否放弃未保存的修改
    on('app:will-close', async () => {
      if (!editor || !editor.isDirty()) {
        await window.lm.app.confirmClose();
        return;
      }
      const res = await window.lm.app.confirm({
        title: '有未保存的修改',
        message: '是否保存当前文档？',
        detail: '不保存将丢弃这些修改。',
        buttons: ['保存', '不保存', '取消'],
      });
      if (!res) return;
      if (res.response === 0) {
        const ok = await saveFile();
        if (ok) await window.lm.app.confirmClose();
      } else if (res.response === 1) {
        await window.lm.app.confirmClose();
      }
    });

    // Ctrl+S
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) saveFileAs();
        else saveFile();
      }
    });
  }

  function showHelp() {
    const rows = [
      ['Ctrl+B / Ctrl+I', '加粗 / 斜体'],
      ['Ctrl+K', '插入链接'],
      ['Ctrl+`', '行内代码'],
      ['Ctrl+Shift+X', '删除线'],
      ['Ctrl+Alt+1…6 / Ctrl+Alt+0', '标题级别 / 退回正文'],
      ['Ctrl+Shift+8 / 7 / 9', '无序 / 有序 / 任务列表'],
      ['Ctrl+1 / 2 / 3', '并排 / 仅编辑 / 仅预览'],
      ['Ctrl+Shift+P', '命令面板'],
      ['Ctrl+Shift+F', '专注模式'],
      ['Ctrl+F', '查找与替换'],
      ['Ctrl+S / Ctrl+Shift+S', '保存 / 另存为'],
      ['输入 “/”', '呼出命令菜单'],
      ['Tab / Shift+Tab', '缩进 / 反缩进'],
      ['Enter', '列表自动续行'],
    ];
    const lines = rows.map(([k, v]) => `${k}  —  ${v}`).join('\n');
    window.lm.app.confirm({
      title: '快捷键',
      message: '灵墨快捷键一览',
      detail: lines,
      buttons: ['好'],
    });
  }

  async function boot() {
    editor = window.LingMDEditor.create(host, {
      value: '',
      mode: 'split',
      onChange: () => {
        document.title = (currentName || '未命名.md') + (editor.isDirty() ? ' ●' : '') + ' — 灵墨';
      },
      onCommand: (name) => {
        if (name === 'save') saveFile();
        else if (name === 'export') exportHtml();
      },
    });
    bindEvents();

    // 命令行 / 文件关联传入的文件，由主进程在 ready-to-show 后推送
    const cur = await window.lm.file.current();
    if (cur) await openFile(cur);
    else applyFileInfo({ path: '', name: '', baseDir: '' });
  }

  document.addEventListener('DOMContentLoaded', () => {
    boot().catch((err) => {
      console.error('boot failed', err);
    });
  });
})();
