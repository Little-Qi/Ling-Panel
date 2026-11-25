/**
 * 灵墨 LingMark — 编辑器组件
 *
 * 设计原则：
 * 1. 编辑区始终是原生 <textarea>：IME 组合、撤销栈、无障碍、选区全部交给浏览器，
 *    不自造 input 引擎（这是自研编辑器最容易做砸的地方）。
 * 2. 所有文本变换都是纯函数（value, sel) => {value, start, end}，可独立测试。
 * 3. 预览与编辑共用同一份 Markdown 源，渲染层负责净化，不在 DOM 上做富文本编辑。
 */
(function (global) {
  const MD = global.LingMarkdown;

  // ────────────────────────── 纯文本变换 ──────────────────────────

  function lineRange(text, sel) {
    const start = text.lastIndexOf('\n', Math.max(0, sel.start - 1)) + 1;
    let end = text.indexOf('\n', sel.end);
    if (end === -1) end = text.length;
    return { start, end };
  }

  function splice(text, sel, replacement, newStart, newEnd) {
    return {
      value: text.slice(0, sel.start) + replacement + text.slice(sel.end),
      start: newStart,
      end: newEnd,
    };
  }

  /** 加粗/斜体/删除线/行内代码：已是该格式则脱掉（toggle 语义） */
  function toggleWrap(text, sel, before, after, placeholder) {
    const b = before.length;
    const a = after.length;
    const selected = text.slice(sel.start, sel.end);
    if (selected.length >= b + a && selected.startsWith(before) && selected.endsWith(after)) {
      const inner = selected.slice(b, selected.length - a);
      return splice(text, sel, inner, sel.start, sel.start + inner.length);
    }
    const inner = selected || placeholder || '';
    return splice(
      text,
      sel,
      before + inner + after,
      sel.start + b,
      sel.start + b + inner.length
    );
  }

  /** 行首前缀切换：列表、引用等 */
  function toggleLinePrefix(text, sel, prefix) {
    const range = lineRange(text, sel);
    const block = text.slice(range.start, range.end);
    const lines = block.split('\n');
    const allHave = lines.every((l) => l.startsWith(prefix));
    const out = allHave
      ? lines.map((l) => l.slice(prefix.length))
      : lines.map((l) => prefix + l);
    const joined = out.join('\n');
    return {
      value: text.slice(0, range.start) + joined + text.slice(range.end),
      start: range.start,
      end: range.start + joined.length,
    };
  }

  /** 标题：同级别再按一次退回正文，换级别则改级别 */
  function setHeading(text, sel, level) {
    const range = lineRange(text, sel);
    const block = text.slice(range.start, range.end);
    const lines = block.split('\n');
    const out = lines.map((l) => {
      const m = l.match(/^(#{1,6})\s+/);
      if (!level) return m ? l.slice(m[0].length) : l;
      if (m) {
        if (m[1].length === level) return l.slice(m[0].length); // 同级 → 取消
        return '#'.repeat(level) + ' ' + l.slice(m[0].length);
      }
      return '#'.repeat(level) + ' ' + l;
    });
    const joined = out.join('\n');
    return {
      value: text.slice(0, range.start) + joined + text.slice(range.end),
      start: range.start,
      end: range.start + joined.length,
    };
  }

  /** 任务清单勾选切换 */
  function toggleTask(text, sel) {
    const range = lineRange(text, sel);
    const block = text.slice(range.start, range.end);
    const lines = block.split('\n');
    const out = lines.map((l) => {
      const m = l.match(/^(\s*[-*+]\s+)\[([ xX])\](\s+.*)$/);
      if (!m) return l;
      return m[1] + '[' + (m[2].toLowerCase() === 'x' ? ' ' : 'x') + ']' + m[3];
    });
    const joined = out.join('\n');
    return {
      value: text.slice(0, range.start) + joined + text.slice(range.end),
      start: range.start,
      end: range.start + joined.length,
    };
  }

  /** 回车时的列表续行：空条目退出列表，否则续一号 */
  function continueList(text, sel) {
    const lineStart = text.lastIndexOf('\n', Math.max(0, sel.start - 1)) + 1;
    const toCursor = text.slice(lineStart, sel.start);
    const m = toCursor.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
    if (!m) return null;
    const [, indent, marker, task, rest] = m;
    if (rest.trim() === '') {
      // 空条目：清掉标记并退出列表
      return { type: 'exit', text: '', from: lineStart };
    }
    const nextMarker = /\d/.test(marker)
      ? String(parseInt(marker, 10) + 1) + marker.slice(-1) + ' '
      : marker + ' ';
    return { type: 'continue', text: '\n' + indent + nextMarker + (task || '') };
  }

  /** Tab / Shift+Tab 缩进 */
  function indentLines(text, sel, dir) {
    const range = lineRange(text, sel);
    const block = text.slice(range.start, range.end);
    const lines = block.split('\n');
    const out = lines.map((l) => (dir > 0 ? '  ' + l : l.replace(/^ {1,2}|^\t/, '')));
    const joined = out.join('\n');
    return {
      value: text.slice(0, range.start) + joined + text.slice(range.end),
      start: range.start,
      end: range.start + joined.length,
    };
  }

  /** 插入表格 */
  function insertTable(text, sel, rows = 3, cols = 3) {
    const head = ['列 1', '列 2', '列 3', '列 4', '列 5', '列 6'].slice(0, cols);
    const sep = head.map(() => '---');
    const body = [];
    for (let r = 0; r < rows; r++) body.push(head.map((h) => '  ').join(' | ').trim());
    const block = '| ' + head.join(' | ') + ' |\n| ' + sep.join(' | ') + ' |\n' + body.join('\n');
    return splice(text, sel, '\n' + block + '\n', sel.start + 1, sel.start + 1 + block.length);
  }

  /** 分隔线 */
  function insertHr(text, sel) {
    return splice(text, sel, '\n\n---\n\n', sel.start + 2, sel.start + 2);
  }

  // ────────────────────────── 斜杠命令表 ──────────────────────────

  const SLASH_COMMANDS = [
    { id: 'h1', label: '一级标题', hint: 'Ctrl+Alt+1', run: (v, s) => setHeading(v, s, 1) },
    { id: 'h2', label: '二级标题', hint: 'Ctrl+Alt+2', run: (v, s) => setHeading(v, s, 2) },
    { id: 'h3', label: '三级标题', hint: 'Ctrl+Alt+3', run: (v, s) => setHeading(v, s, 3) },
    { id: 'ul', label: '无序列表', hint: 'Ctrl+Shift+8', run: (v, s) => toggleLinePrefix(v, s, '- ') },
    { id: 'ol', label: '有序列表', hint: 'Ctrl+Shift+7', run: (v, s) => toggleLinePrefix(v, s, '1. ') },
    { id: 'task', label: '任务清单', hint: 'Ctrl+Shift+9', run: (v, s) => toggleLinePrefix(v, s, '- [ ] ') },
    { id: 'quote', label: '引用', hint: 'Ctrl+Shift+.', run: (v, s) => toggleLinePrefix(v, s, '> ') },
    { id: 'code', label: '代码块', hint: '```', run: (v, s) => splice(v, s, '\n```\ncode\n```\n', s.start + 5, s.start + 9) },
    { id: 'table', label: '表格', hint: '3×3', run: (v, s) => insertTable(v, s) },
    { id: 'hr', label: '分隔线', hint: '---', run: (v, s) => insertHr(v, s) },
    {
      id: 'link',
      label: '链接',
      hint: 'Ctrl+K',
      run: (v, s) => toggleWrap(v, s, '[', '](https://)', '链接文字'),
    },
    { id: 'image', label: '图片', hint: '![]()', run: (v, s) => toggleWrap(v, s, '![', '](image.png)', 'alt') },
  ];

  // ────────────────────────── 编辑器组件 ──────────────────────────

  // ────────────────────────── 图标 ──────────────────────────
  // 统一用 24 视窗、1.7 描边的线条图标，避免各平台 emoji 字形不一致。
  const ICONS = {
    logo: '<path d="M12 3.2c3.6 4.2 6.2 7.2 6.2 10.3a6.2 6.2 0 0 1-12.4 0C5.8 10.4 8.4 7.4 12 3.2Z"/>',
    bold: '<path d="M7 4.5h6.2a3.9 3.9 0 0 1 0 7.8H7zM7 12.3h7a3.9 3.9 0 0 1 0 7.7H7z"/>',
    italic: '<path d="M18.5 4.5h-7M12.5 19.5h-7M15 4.5 9 19.5"/>',
    strike: '<path d="M15.6 4.8H9.8a2.9 2.9 0 0 0-1.2 5.5M13.8 13a3.4 3.4 0 0 1 .2 6.2H7.4M4 12h16"/>',
    code: '<path d="m15.5 17.5 5-5.5-5-5.5M8.5 6.5 3.5 12l5 5.5"/>',
    quote:
      '<path d="M9.5 6.5C6.6 7.9 5 10.2 5 13.2v4.3h5.2v-5.2H7.6c0-1.9.8-3.2 2.4-4.1zM19 6.5c-2.9 1.4-4.5 3.7-4.5 6.7v4.3h5.2v-5.2h-2.6c0-1.9.8-3.2 2.4-4.1z"/>',
    ul: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.2" cy="6.5" r="1.1"/><circle cx="4.2" cy="12" r="1.1"/><circle cx="4.2" cy="17.5" r="1.1"/>',
    ol: '<path d="M9.5 6.5h10.5M9.5 12H20M9.5 17.5H20M4 5.2h1.4v4M3.8 9.2h2.4M4 13.4h1.9a1 1 0 0 1 0 2H4.4a1 1 0 0 0 0 2h1.9"/>',
    task: '<path d="m4.5 12.5 2.8 2.8L12.5 9"/><path d="M20 12.5v5.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8.2"/>',
    link: '<path d="M10.2 13.8a4.2 4.2 0 0 0 6 0l2.8-2.8a4.2 4.2 0 0 0-6-6l-1.4 1.4"/><path d="M13.8 10.2a4.2 4.2 0 0 0-6 0L5 13a4.2 4.2 0 0 0 6 6l1.4-1.4"/>',
    image:
      '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="8.6" cy="9.4" r="1.5"/><path d="m20.5 16-4.6-4.6L6 20.5"/>',
    table:
      '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15"/>',
    hr: '<path d="M4 12h16"/><path d="M7 7.5h10M7 16.5h10" opacity=".35"/>',
    search: '<circle cx="11" cy="11" r="6.6"/><path d="m20.5 20.5-4.4-4.4"/>',
    command:
      '<path d="M15 6.2v11.6a2.9 2.9 0 1 0 2.9-2.9H6.1a2.9 2.9 0 1 0 2.9 2.9V6.1A2.9 2.9 0 1 0 6.1 9h11.8A2.9 2.9 0 1 0 15 6.2Z"/>',
    zen: '<path d="M8.5 3.5h-3a2 2 0 0 0-2 2v3M15.5 3.5h3a2 2 0 0 1 2 2v3M8.5 20.5h-3a2 2 0 0 1-2-2v-3M15.5 20.5h3a2 2 0 0 0 2-2v-3"/>',
    typewriter: '<path d="M4 6.5h16M4 12h16M4 17.5h11"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
    moon: '<path d="M20.5 13.4A8.2 8.2 0 1 1 10.6 3.5a6.4 6.4 0 0 0 9.9 9.9Z"/>',
    outline: '<path d="M4 6.5h5M4 12h9M4 17.5h13"/><path d="M4 3.2v17.6" opacity=".4"/>',
    split: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/>',
    edit: '<path d="M12.5 20.5H21"/><path d="M16.6 3.9a2 2 0 0 1 2.8 2.8L7.6 18.5l-3.8 1 1-3.8Z"/>',
    preview: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M5.5 15.2V6a2 2 0 0 1 2-2h9.2"/>',
    external: '<path d="M14 3.5h6.5V10M20.5 3.5 12 12"/><path d="M20 14.5v4.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2H10"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    folder:
      '<path d="M3.5 6.8a2 2 0 0 1 2-2h3.9l2 2.4h7.1a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  };

  function icon(name, extraClass) {
    const body = ICONS[name];
    if (!body) return '';
    return (
      '<svg class="mde-svg' +
      (extraClass ? ' ' + extraClass : '') +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body +
      '</svg>'
    );
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'value') node.value = v == null ? '' : String(v);
      else if (k === 'checked') node.checked = !!v;
      else if (k === 'disabled') node.disabled = !!v;
      else if (k === 'hidden') node.hidden = !!v;
      else if (k === 'placeholder') node.placeholder = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else node.setAttribute(k, v);
    }
    const flat = (c, out = []) => {
      if (c == null || c === false) return out;
      if (Array.isArray(c)) {
        for (const x of c) flat(x, out);
        return out;
      }
      out.push(c);
      return out;
    };
    for (const c of flat(children)) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function debounce(fn, wait) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function create(host, options = {}) {
    const state = {
      value: String(options.value || ''),
      mode: options.mode || 'split', // split | edit | preview
      zen: false,
      outline: true,
      themePref: 'auto',
      typewriter: false,
      fileName: options.fileName || '',
      filePath: options.filePath || '',
      dirty: false,
      baseDir: options.baseDir || '',
      slashOpen: false,
      slashQuery: '',
      slashPos: -1,
      findOpen: false,
      cmdOpen: false,
      cmdQuery: '',
      cmdIndex: 0,
    };

    let onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    const onCommand = typeof options.onCommand === 'function' ? options.onCommand : () => {};

    /** 把命令转交给宿主（保存/导出这类需要主进程参与的动作） */
    function emit(name) {
      try {
        onCommand(name);
      } catch (err) {
        console.error('[lingmark] command failed', name, err);
      }
    }

    // —— DOM ——
    const ta = el('textarea', {
      class: 'mde-input',
      spellcheck: 'false',
      placeholder: options.placeholder || '在这里写 Markdown…',
      value: state.value,
    });
    const preview = el('div', { class: 'md-body' });
    const previewScroll = el('div', { class: 'mde-view' }, [preview]);
    const outlineBox = el('div', { class: 'mde-outline' });
    const outlineWrap = el('div', { class: 'mde-outline-wrap' }, [
      el('div', { class: 'mde-outline-head' }, [
        el('span', { class: 'mde-outline-title', text: '大纲' }),
      ]),
      outlineBox,
    ]);
    const findBox = el('div', { class: 'mde-find hidden' });
    const slashBox = el('div', { class: 'mde-slash hidden' });
    const cmdBox = el('div', { class: 'mde-cmd hidden' });
    const statusLeft = el('span', { class: 'mde-status-item' });
    const statusRight = el('span', { class: 'mde-status-item' });
    const fileNameEl = el('span', { class: 'mde-filename' });
    const fileSubEl = el('span', { class: 'mde-sub' });
    const docMeta = el('div', { class: 'mde-doc' }, [fileNameEl, fileSubEl]);
    const toolbar = el('div', { class: 'mde-tools' });
    const segBox = el('div', { class: 'mde-seg', role: 'tablist' });
    const themeBtn = el('button', {
      class: 'mde-iconbtn',
      type: 'button',
      title: '切换主题',
      'aria-label': '切换主题',
      onclick: () => cycleTheme(),
    });
    const outlineBtn = el('button', {
      class: 'mde-iconbtn',
      type: 'button',
      title: '显示/隐藏大纲',
      'aria-label': '显示/隐藏大纲',
      onclick: () => {
        state.outline = !state.outline;
        applyMode();
      },
    });
    outlineBtn.innerHTML = icon('outline');
    const zenBtn = el('button', {
      class: 'mde-iconbtn',
      type: 'button',
      title: '专注模式 (Ctrl+Shift+F)',
      'aria-label': '专注模式',
      onclick: () => toggleZen(),
    });
    zenBtn.innerHTML = icon('zen');

    const openBtn = el('button', {
      class: 'mde-headbtn',
      type: 'button',
      title: '打开文件 (Ctrl+O)',
      'aria-label': '打开文件',
      html: icon('folder') + '<span>打开</span>',
      onclick: () => emit('open'),
    });
    const newBtn = el('button', {
      class: 'mde-headbtn',
      type: 'button',
      title: '新建文件 (Ctrl+N)',
      'aria-label': '新建文件',
      html: icon('plus') + '<span>新建</span>',
      onclick: () => emit('new'),
    });

    const head = el('div', { class: 'mde-head' }, [
      el('span', { class: 'mde-brand', html: icon('logo') }),
      docMeta,
      openBtn,
      newBtn,
      el('div', { class: 'mde-head-spacer' }),
      segBox,
      outlineBtn,
      themeBtn,
      zenBtn,
    ]);

    const editPane = el('div', { class: 'mde-pane mde-pane-edit' }, [ta]);
    const viewPane = el('div', { class: 'mde-pane mde-pane-view' }, [previewScroll]);
    const main = el('div', { class: 'mde-main' }, [outlineWrap, editPane, viewPane]);

    const root = el('div', { class: 'mde' }, [
      head,
      toolbar,
      main,
      findBox,
      slashBox,
      cmdBox,
      el('div', { class: 'mde-status' }, [statusLeft, statusRight]),
    ]);
    host.innerHTML = '';
    host.appendChild(root);

    // —— 主题 ——
    const THEME_KEY = 'lingmark.theme';

    function resolveTheme(pref) {
      if (pref === 'light' || pref === 'dark') return pref;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }

    function paintThemeBtn() {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
      themeBtn.title = dark ? '切换到浅色主题' : '切换到深色主题';
    }

    /** 原生标题栏按钮的颜色跟随主题 */
    function syncNativeTheme() {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (global.lm && global.lm.app && typeof global.lm.app.setTheme === 'function') {
        global.lm.app.setTheme(dark);
      }
    }

    function setThemePref(pref) {
      state.themePref = pref;
      try {
        localStorage.setItem(THEME_KEY, pref);
      } catch (_) {}
      document.documentElement.setAttribute('data-theme-pref', pref);
      document.documentElement.setAttribute('data-theme', resolveTheme(pref));
      paintThemeBtn();
      syncNativeTheme();
    }

    function cycleTheme() {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      setThemePref(dark ? 'light' : 'dark');
    }

    function initTheme() {
      let pref = 'auto';
      try {
        pref =
          localStorage.getItem(THEME_KEY) ||
          document.documentElement.getAttribute('data-theme-pref') ||
          'auto';
      } catch (_) {}
      state.themePref = pref;
      document.documentElement.setAttribute('data-theme', resolveTheme(pref));
      paintThemeBtn();
      syncNativeTheme();
      try {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener('change', () => {
          if (state.themePref === 'auto') setThemePref('auto');
        });
      } catch (_) {}
    }

    // —— 状态同步 ——
    function applyMode() {
      root.dataset.mode = state.mode;
      root.dataset.outline = state.outline ? 'on' : 'off';
      root.classList.toggle('is-zen', state.zen);
      root.classList.toggle('is-typewriter', state.typewriter);
      editPane.hidden = state.mode === 'preview';
      viewPane.hidden = state.mode === 'edit';
      outlineWrap.hidden = state.mode !== 'split' || state.zen || !state.outline;
      toolbar.hidden = state.mode === 'preview' || state.zen;
      outlineBtn.classList.toggle('is-active', state.outline);
      zenBtn.classList.toggle('is-active', state.zen);
    }

    function setMode(m) {
      state.mode = m;
      applyMode();
      buildSeg();
    }

    function toggleZen() {
      state.zen = !state.zen;
      applyMode();
    }

    function setValue(v, opts = {}) {
      state.value = String(v == null ? '' : v);
      if (ta.value !== state.value) ta.value = state.value;
      if (!opts.silent) state.dirty = true;
      paint();
      if (!opts.silent) onChange(state.value);
    }

    function getValue() {
      return ta.value;
    }

    function sel() {
      return { start: ta.selectionStart, end: ta.selectionEnd };
    }

    /** 应用一个文本变换并把光标放回正确位置 */
    function apply(res) {
      if (!res) return;
      ta.value = res.value;
      state.value = res.value;
      state.dirty = true;
      try {
        ta.setSelectionRange(res.start, res.end);
      } catch (_) {}
      paint();
      onChange(state.value);
      ta.focus();
    }

    // —— 渲染 ——
    function emptyStateHtml() {
      return (
        '<div class="mde-empty">' +
        '<div class="mde-empty-mark">' +
        icon('logo') +
        '</div>' +
        '<h1>开始写点什么</h1>' +
        '<p>左边写 Markdown，右边即时预览。文件存在本地，不经过云端。</p>' +
        '<div class="mde-empty-keys">' +
        '<span><kbd>Ctrl</kbd><kbd>N</kbd>新建</span>' +
        '<span><kbd>Ctrl</kbd><kbd>O</kbd>打开</span>' +
        '<span><kbd>Ctrl</kbd><kbd>S</kbd>保存</span>' +
        '<span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd>命令</span>' +
        '</div></div>'
      );
    }

    const paintPreview = debounce(() => {
      const top = previewScroll.scrollTop;
      const html = MD.renderMarkdown(ta.value);
      preview.innerHTML = html || emptyStateHtml();
      previewScroll.scrollTop = top;
      wirePreview();
    }, 90);

    const paintOutline = debounce(() => {
      const items = MD.extractOutline(ta.value);
      outlineBox.innerHTML = '';
      if (!items.length) {
        outlineBox.appendChild(el('div', { class: 'mde-hint', text: '暂无标题' }));
        return;
      }
      // 光标所在的章节 → 高亮对应大纲项
      const curLine = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
      let current = null;
      for (const it of items) {
        if (it.line <= curLine) current = it;
        else break;
      }
      for (const it of items) {
        outlineBox.appendChild(
          el(
            'button',
            {
              class:
                'mde-outline-item' +
                (current && current.line === it.line ? ' is-current' : ''),
              'data-level': String(it.level),
              text: it.text,
              title: `第 ${it.line + 1} 行`,
              onclick: () => {
                const lines = ta.value.split('\n');
                let pos = 0;
                for (let i = 0; i < it.line && i < lines.length; i++) pos += lines[i].length + 1;
                ta.focus();
                ta.setSelectionRange(pos, pos);
                const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
                ta.scrollTop = Math.max(0, (it.line - 3) * lineHeight);
                // 预览同步定位到对应标题
                const heading = document.getElementById(it.slug);
                if (heading && preview.contains(heading)) {
                  previewScroll.scrollTop = Math.max(0, heading.offsetTop - 28);
                }
              },
            },
          )
        );
      }
    }, 120);

    const paintStatus = debounce(() => {
      const s = ta.selectionStart;
      const before = ta.value.slice(0, s);
      const line = before.split('\n').length;
      const col = s - before.lastIndexOf('\n');
      const wc = MD.countWords(ta.value);
      statusLeft.textContent = `行 ${line} · 列 ${col}`;
      statusRight.textContent = `${wc.total} 字 · ${wc.cjk} 中文 · ${wc.words} 词`;
    }, 120);

    function paint() {
      paintPreview();
      paintOutline();
      paintStatus();
      fileNameEl.textContent = state.fileName || '未命名.md';
      fileSubEl.textContent = state.filePath ? dirLabel(state.filePath) : '';
      docMeta.classList.toggle('is-dirty', state.dirty);
    }

    function dirLabel(p) {
      const s = String(p || '');
      const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
      return i >= 0 ? s.slice(0, i) : '';
    }

    // —— 预览交互：外链、代码复制、任务清单 ——
    function wirePreview() {
      // 外链交给系统浏览器，避免把应用窗口导航走
      preview.querySelectorAll('a[href]').forEach((a) => {
        if (a.dataset.wired) return;
        a.dataset.wired = '1';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const href = a.getAttribute('href') || '';
          if (/^(https?:|mailto:)/i.test(href) && global.lm && global.lm.shell) {
            global.lm.shell.openExternal(href);
          }
        });
      });

      // 代码块一键复制
      preview.querySelectorAll('pre.md-code').forEach((pre) => {
        if (pre.querySelector('.mde-copy')) return;
        const btn = el('button', {
          class: 'mde-copy',
          type: 'button',
          title: '复制代码',
          'aria-label': '复制代码',
          html: icon('copy'),
        });
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const code = pre.querySelector('code');
          const text = code ? code.textContent : pre.textContent;
          try {
            await navigator.clipboard.writeText(text);
          } catch (_) {
            const tmp = document.createElement('textarea');
            tmp.value = text;
            document.body.appendChild(tmp);
            tmp.select();
            try {
              document.execCommand('copy');
            } catch (_) {}
            tmp.remove();
          }
          btn.classList.add('is-done');
          btn.textContent = '已复制';
          setTimeout(() => {
            btn.classList.remove('is-done');
            btn.innerHTML = icon('copy');
          }, 1400);
        });
        pre.appendChild(btn);
      });

      const boxes = preview.querySelectorAll('input[type="checkbox"]');
      if (!boxes.length) return;
      const tasks = MD.extractTasks(ta.value);
      boxes.forEach((box, i) => {
        const task = tasks[i];
        if (!task) return;
        box.checked = task.checked;
        box.addEventListener('change', () => {
          const lines = ta.value.split('\n');
          if (!lines[task.line]) return;
          lines[task.line] = lines[task.line].replace(
            /^(\s*[-*+]\s+)\[([ xX])\]/,
            (_m, pre) => pre + '[' + (box.checked ? 'x' : ' ') + ']'
          );
          const next = lines.join('\n');
          ta.value = next;
          state.value = next;
          state.dirty = true;
          paint();
          onChange(state.value);
        });
      });
    }

    // —— 工具栏 ——
    function toolButton(name, title, onclick, extraClass) {
      return el('button', {
        class: 'mde-tool' + (extraClass ? ' ' + extraClass : ''),
        type: 'button',
        title,
        'aria-label': title,
        html: icon(name),
        onclick,
      });
    }

    function headingButton(level) {
      return el('button', {
        class: 'mde-tool mde-tool-text',
        type: 'button',
        text: 'H' + level,
        title: `${level} 级标题 (Ctrl+Alt+${level})`,
        onclick: () => apply(setHeading(ta.value, sel(), level)),
      });
    }

    function buildToolbar() {
      toolbar.innerHTML = '';
      const group = (children) => el('div', { class: 'mde-tool-group' }, children);

      toolbar.appendChild(group([headingButton(1), headingButton(2), headingButton(3)]));
      toolbar.appendChild(
        group([
          toolButton('bold', '加粗 (Ctrl+B)', () =>
            apply(toggleWrap(ta.value, sel(), '**', '**', '加粗'))
          ),
          toolButton('italic', '斜体 (Ctrl+I)', () =>
            apply(toggleWrap(ta.value, sel(), '*', '*', '斜体'))
          ),
          toolButton('strike', '删除线 (Ctrl+Shift+X)', () =>
            apply(toggleWrap(ta.value, sel(), '~~', '~~', '删除'))
          ),
          toolButton('code', '行内代码 (Ctrl+`)', () =>
            apply(toggleWrap(ta.value, sel(), '`', '`', 'code'))
          ),
        ])
      );
      toolbar.appendChild(
        group([
          toolButton('ul', '无序列表 (Ctrl+Shift+8)', () =>
            apply(toggleLinePrefix(ta.value, sel(), '- '))
          ),
          toolButton('ol', '有序列表 (Ctrl+Shift+7)', () =>
            apply(toggleLinePrefix(ta.value, sel(), '1. '))
          ),
          toolButton('task', '任务清单 (Ctrl+Shift+9)', () =>
            apply(toggleTask(ta.value, sel()))
          ),
          toolButton('quote', '引用', () =>
            apply(toggleLinePrefix(ta.value, sel(), '> '))
          ),
        ])
      );
      toolbar.appendChild(
        group([
          toolButton('link', '链接 (Ctrl+K)', () =>
            apply(toggleWrap(ta.value, sel(), '[', '](https://)', '链接文字'))
          ),
          toolButton('image', '图片', () =>
            apply(toggleWrap(ta.value, sel(), '![', '](image.png)', 'alt'))
          ),
          toolButton('table', '表格', () => apply(insertTable(ta.value, sel()))),
          toolButton('hr', '分隔线', () => apply(insertHr(ta.value, sel()))),
        ])
      );

      toolbar.appendChild(el('div', { class: 'mde-tool-spacer' }));
      toolbar.appendChild(
        group([
          toolButton(
            'typewriter',
            '打字机模式：当前行始终居中',
            () => {
              state.typewriter = !state.typewriter;
              applyMode();
              buildToolbar();
            },
            state.typewriter ? 'is-active' : ''
          ),
          toolButton('search', '查找与替换 (Ctrl+F)', () => toggleFind()),
          toolButton('command', '命令面板 (Ctrl+Shift+P)', () => openCmd('')),
        ])
      );
    }

    /** 视图切换：放在文档头右侧的分段控件（图标 + 文字） */
    function buildSeg() {
      segBox.innerHTML = '';
      const modes = [
        ['split', 'split', '分栏', '1'],
        ['edit', 'edit', '编辑', '2'],
        ['preview', 'preview', '预览', '3'],
      ];
      for (const [m, ico, label, key] of modes) {
        segBox.appendChild(
          el('button', {
            class: 'mde-segbtn' + (state.mode === m ? ' is-active' : ''),
            type: 'button',
            title: `视图：${label} (Ctrl+${key})`,
            html: icon(ico) + '<span>' + label + '</span>',
            onclick: () => setMode(m),
          })
        );
      }
    }

    // —— 斜杠命令 ——
    function openSlash(query, pos) {
      state.slashOpen = true;
      state.slashQuery = query;
      state.slashPos = pos;
      renderSlash();
    }

    function closeSlash() {
      state.slashOpen = false;
      state.slashPos = -1;
      slashBox.classList.add('hidden');
      slashBox.innerHTML = '';
    }

    function slashMatches() {
      const q = state.slashQuery.toLowerCase();
      return SLASH_COMMANDS.filter(
        (c) => !q || c.label.toLowerCase().includes(q) || c.id.includes(q)
      );
    }

    function renderSlash() {
      const items = slashMatches();
      slashBox.innerHTML = '';
      if (!items.length) {
        slashBox.classList.add('hidden');
        state.slashOpen = false;
        return;
      }
      items.forEach((c, i) => {
        slashBox.appendChild(
          el(
            'button',
            {
              class: 'mde-slash-item' + (i === 0 ? ' is-active' : ''),
              'data-id': c.id,
              onclick: () => pickSlash(c),
            },
            [
              el('span', { class: 'mde-slash-label', text: c.label }),
              el('span', { class: 'mde-slash-hint', text: c.hint }),
            ]
          )
        );
      });
      slashBox.classList.remove('hidden');
      // 粗略定位：按行号估算光标位置，够用且不引入镜像 div
      const line = ta.value.slice(0, ta.selectionStart).split('\n').length;
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const top = ta.offsetTop + line * lineHeight - ta.scrollTop + 4;
      slashBox.style.top = Math.min(top, ta.offsetHeight - 40) + 'px';
      slashBox.style.left = Math.max(8, ta.offsetLeft + 24) + 'px';
    }

    function pickSlash(cmd) {
      const s = { start: state.slashPos, end: ta.selectionStart };
      const res = cmd.run(ta.value, s);
      closeSlash();
      if (res) apply(res);
    }

    function moveSlash(delta) {
      const items = slashMatches();
      if (!items.length) return;
      const cur = slashBox.querySelector('.is-active');
      let idx = items.findIndex((c) => c.id === (cur && cur.getAttribute('data-id')));
      idx = (idx + delta + items.length) % items.length;
      slashBox.querySelectorAll('.mde-slash-item').forEach((n, i) => {
        n.classList.toggle('is-active', i === idx);
      });
    }

    // —— 查找替换 ——
    function buildFind() {
      findBox.innerHTML = '';
      const input = el('input', { class: 'mde-find-input', placeholder: '查找…' });
      const replaceInput = el('input', { class: 'mde-find-input', placeholder: '替换为…' });
      const info = el('span', { class: 'mde-find-info' });
      findBox.appendChild(input);
      findBox.appendChild(replaceInput);
      findBox.appendChild(
        el('button', { class: 'mde-tb-btn', text: '↓', title: '下一个', onclick: () => findNext(1) })
      );
      findBox.appendChild(
        el('button', { class: 'mde-tb-btn', text: '↑', title: '上一个', onclick: () => findNext(-1) })
      );
      findBox.appendChild(
        el('button', { class: 'mde-tb-btn', text: '替换', onclick: () => replaceOne() })
      );
      findBox.appendChild(
        el('button', { class: 'mde-tb-btn', text: '全部', onclick: () => replaceAll() })
      );
      findBox.appendChild(info);
      findBox.appendChild(
        el('button', { class: 'mde-tb-btn', text: '✕', title: '关闭', onclick: () => toggleFind(false) })
      );

      input.addEventListener('input', () => {
        findNext(1, false);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          findNext(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          toggleFind(false);
        }
      });
    }

    let findTerm = '';
    function collectMatches(term) {
      if (!term) return [];
      const out = [];
      let i = ta.value.indexOf(term);
      while (i !== -1) {
        out.push(i);
        i = ta.value.indexOf(term, i + Math.max(1, term.length));
      }
      return out;
    }

    function findNext(dir, moveCursor = true) {
      const input = findBox.querySelector('.mde-find-input');
      const info = findBox.querySelector('.mde-find-info');
      findTerm = input ? input.value : '';
      const hits = collectMatches(findTerm);
      if (info) info.textContent = findTerm ? `${hits.length} 处` : '';
      if (!hits.length || !moveCursor) return;
      const cur = ta.selectionStart;
      let target = null;
      if (dir > 0) {
        target = hits.find((h) => h > cur);
        if (target === undefined) target = hits[0];
      } else {
        const before = hits.filter((h) => h < cur);
        target = before.length ? before[before.length - 1] : hits[hits.length - 1];
      }
      ta.focus();
      ta.setSelectionRange(target, target + findTerm.length);
      paintStatus();
    }

    function replaceOne() {
      const replaceInput = findBox.querySelectorAll('.mde-find-input')[1];
      if (!findTerm) return;
      const s = sel();
      const selected = ta.value.slice(s.start, s.end);
      if (selected === findTerm) {
        const repl = replaceInput ? replaceInput.value : '';
        ta.value = ta.value.slice(0, s.start) + repl + ta.value.slice(s.end);
        state.value = ta.value;
        state.dirty = true;
        ta.setSelectionRange(s.start, s.start + repl.length);
        paint();
        onChange(state.value);
      }
      findNext(1);
    }

    function replaceAll() {
      const replaceInput = findBox.querySelectorAll('.mde-find-input')[1];
      if (!findTerm) return;
      const repl = replaceInput ? replaceInput.value : '';
      const next = ta.value.split(findTerm).join(repl);
      ta.value = next;
      state.value = next;
      state.dirty = true;
      paint();
      onChange(state.value);
      findNext(1, false);
    }

    function toggleFind(force) {
      state.findOpen = force === undefined ? !state.findOpen : force;
      findBox.classList.toggle('hidden', !state.findOpen);
      if (state.findOpen) {
        const input = findBox.querySelector('.mde-find-input');
        if (input) {
          input.focus();
          input.select();
        }
      } else {
        ta.focus();
      }
    }

    // —— 键盘 ——
    ta.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;

      if (state.slashOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          moveSlash(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          moveSlash(-1);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const active = slashBox.querySelector('.is-active');
          const cmd = SLASH_COMMANDS.find((c) => c.id === (active && active.getAttribute('data-id')));
          if (cmd) pickSlash(cmd);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeSlash();
          return;
        }
      }

      if (mod) {
        const key = e.key.toLowerCase();
        if (key === 'b') {
          e.preventDefault();
          apply(toggleWrap(ta.value, sel(), '**', '**', '加粗'));
          return;
        }
        if (key === 'i') {
          e.preventDefault();
          apply(toggleWrap(ta.value, sel(), '*', '*', '斜体'));
          return;
        }
        if (key === 'k') {
          e.preventDefault();
          apply(toggleWrap(ta.value, sel(), '[', '](https://)', '链接文字'));
          return;
        }
        if (key === '`') {
          e.preventDefault();
          apply(toggleWrap(ta.value, sel(), '`', '`', 'code'));
          return;
        }
        if (e.shiftKey && key === 'x') {
          e.preventDefault();
          apply(toggleWrap(ta.value, sel(), '~~', '~~', '删除'));
          return;
        }
        if (e.shiftKey && key === 'f') {
          e.preventDefault();
          toggleZen();
          return;
        }
        if (e.shiftKey && key === 'p') {
          e.preventDefault();
          openCmd('');
          return;
        }
        if (!e.shiftKey && key >= '1' && key <= '3') {
          // 与原生菜单的 Ctrl+1/2/3（并排/编辑/预览）保持一致
          e.preventDefault();
          setMode(['split', 'edit', 'preview'][Number(key) - 1]);
          return;
        }
        if (e.altKey && key >= '0' && key <= '6') {
          // 标题级别用 Ctrl+Alt+0..6（Ctrl+1..3 让给视图切换）
          e.preventDefault();
          apply(setHeading(ta.value, sel(), Number(key)));
          return;
        }
        if (e.shiftKey && key === '8') {
          e.preventDefault();
          apply(toggleLinePrefix(ta.value, sel(), '- '));
          return;
        }
        if (e.shiftKey && key === '7') {
          e.preventDefault();
          apply(toggleLinePrefix(ta.value, sel(), '1. '));
          return;
        }
        if (e.shiftKey && key === '9') {
          e.preventDefault();
          apply(toggleTask(ta.value, sel()));
          return;
        }
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        apply(indentLines(ta.value, sel(), e.shiftKey ? -1 : 1));
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !mod) {
        const cont = continueList(ta.value, sel());
        if (cont) {
          e.preventDefault();
          if (cont.type === 'exit') {
            const from = cont.from;
            const next = ta.value.slice(0, from) + ta.value.slice(ta.selectionStart);
            ta.value = next;
            state.value = next;
            state.dirty = true;
            ta.setSelectionRange(from, from);
            paint();
            onChange(state.value);
          } else {
            apply({
              value: ta.value.slice(0, ta.selectionStart) + cont.text + ta.value.slice(ta.selectionEnd),
              start: ta.selectionStart + cont.text.length,
              end: ta.selectionStart + cont.text.length,
            });
          }
          return;
        }
      }
    });

    ta.addEventListener('input', () => {
      state.value = ta.value;
      state.dirty = true;
      paint();
      onChange(state.value);

      // 斜杠菜单触发
      const before = ta.value.slice(0, ta.selectionStart);
      const m = before.match(/(?:^|\s)\/([^\s/]*)$/);
      if (m) {
        const pos = ta.selectionStart - m[1].length - 1;
        openSlash(m[1], pos);
      } else if (state.slashOpen) {
        closeSlash();
      }
    });

    ta.addEventListener('click', paintStatus);
    ta.addEventListener('keyup', paintStatus);

    // —— 图片粘贴 / 拖拽 ——
    async function insertImageFile(file) {
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const dataUrl = `data:${file.type || 'image/png'};base64,${btoa(bin)}`;
        const res = await global.lm.file.saveImage(state.baseDir, dataUrl, file.name);
        if (res && res.ok) {
          apply(toggleWrap(ta.value, sel(), '![', `](${res.rel})`, file.name || 'image'));
        }
      } catch (err) {
        console.error('[lingmark] image insert failed', err);
      }
    }

    ta.addEventListener('paste', (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.indexOf('image/') === 0) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            insertImageFile(f);
            return;
          }
        }
      }
    });

    ta.addEventListener('drop', (e) => {
      const files = (e.dataTransfer && e.dataTransfer.files) || [];
      const f = Array.from(files).find((x) => x.type && x.type.indexOf('image/') === 0);
      if (f) {
        e.preventDefault();
        insertImageFile(f);
      }
    });

    // —— 命令面板 ——
    function cmdItems() {
      const items = [
        { id: 'view-split', label: '视图：并排', hint: 'Ctrl+1', run: () => setMode('split') },
        { id: 'view-edit', label: '视图：仅编辑', hint: 'Ctrl+2', run: () => setMode('edit') },
        { id: 'view-preview', label: '视图：仅预览', hint: 'Ctrl+3', run: () => setMode('preview') },
        { id: 'zen', label: '专注模式', hint: 'Ctrl+Shift+F', run: () => toggleZen() },
        {
          id: 'typewriter',
          label: '打字机模式（当前行居中）',
          run: () => {
            state.typewriter = !state.typewriter;
            applyMode();
            buildToolbar();
          },
        },
        { id: 'find', label: '查找与替换', hint: 'Ctrl+F', run: () => toggleFind(true) },
        { id: 'theme', label: '切换浅色 / 深色主题', run: () => cycleTheme() },
        {
          id: 'outline',
          label: '显示 / 隐藏大纲',
          run: () => {
            state.outline = !state.outline;
            applyMode();
          },
        },
        { id: 'save', label: '保存文件', hint: 'Ctrl+S', run: () => emit('save') },
        { id: 'default-md', label: '把 LingMark 设为 .md 默认打开方式', run: () => emit('set-default') },
        { id: 'export', label: '导出为 HTML', run: () => emit('export') },
      ];
      for (const c of SLASH_COMMANDS) {
        items.push({
          id: 'ins-' + c.id,
          label: '插入：' + c.label,
          hint: c.hint,
          run: () => apply(c.run(ta.value, sel())),
        });
      }
      return items;
    }

    function cmdMatches() {
      const q = state.cmdQuery.trim().toLowerCase();
      const all = cmdItems();
      if (!q) return all;
      return all.filter((c) => c.label.toLowerCase().includes(q) || c.id.includes(q));
    }

    function renderCmd() {
      const list = cmdBox.querySelector('.mde-cmd-list');
      if (!list) return;
      const items = cmdMatches();
      list.innerHTML = '';
      if (!items.length) {
        list.appendChild(el('div', { class: 'mde-cmd-empty', text: '没有匹配的命令' }));
        return;
      }
      if (state.cmdIndex >= items.length) state.cmdIndex = 0;
      items.forEach((c, i) => {
        list.appendChild(
          el(
            'button',
            {
              class: 'mde-cmd-item' + (i === state.cmdIndex ? ' is-active' : ''),
              'data-id': c.id,
              onclick: () => {
                closeCmd();
                c.run();
              },
            },
            [
              el('span', { text: c.label }),
              c.hint ? el('span', { class: 'mde-cmd-hint', text: c.hint }) : null,
            ]
          )
        );
      });
    }

    function openCmd(q) {
      state.cmdOpen = true;
      state.cmdQuery = q || '';
      state.cmdIndex = 0;
      cmdBox.classList.remove('hidden');
      cmdBox.innerHTML = '';
      const input = el('input', {
        class: 'mde-cmd-input',
        placeholder: '输入命令…',
        value: state.cmdQuery,
      });
      const list = el('div', { class: 'mde-cmd-list' });
      cmdBox.appendChild(
        el('div', { class: 'mde-cmd-panel' }, [input, list])
      );
      cmdBox.addEventListener('mousedown', (e) => {
        if (e.target === cmdBox) closeCmd();
      });
      input.addEventListener('input', () => {
        state.cmdQuery = input.value;
        state.cmdIndex = 0;
        renderCmd();
      });
      input.addEventListener('keydown', (e) => {
        const items = cmdMatches();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.cmdIndex = (state.cmdIndex + 1) % Math.max(1, items.length);
          renderCmd();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.cmdIndex = (state.cmdIndex - 1 + items.length) % Math.max(1, items.length);
          renderCmd();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const c = items[state.cmdIndex];
          if (c) {
            closeCmd();
            c.run();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeCmd();
        }
      });
      renderCmd();
      input.focus();
    }

    function closeCmd() {
      state.cmdOpen = false;
      cmdBox.classList.add('hidden');
      cmdBox.innerHTML = '';
    }

    // —— 初始化 ——
    initTheme();
    buildSeg();
    buildToolbar();
    buildFind();
    applyMode();
    paint();

    return {
      root,
      getValue,
      setValue,
      focus: () => ta.focus(),
      setMode,
      toggleZen,
      toggleOutline() {
        state.outline = !state.outline;
        applyMode();
      },
      openCommandPalette: (q) => openCmd(q || ''),
      toggleFind,
      setFileInfo(info) {
        state.fileName = (info && info.name) || '';
        state.filePath = (info && info.path) || '';
        state.baseDir = (info && info.baseDir) || '';
        state.dirty = false;
        paint();
      },
      isDirty: () => state.dirty,
      markClean() {
        state.dirty = false;
        paint();
      },
      getFile: () => ({ path: state.filePath, name: state.fileName, baseDir: state.baseDir }),
      state,
    };
  }

  global.LingMDEditor = {
    create,
    // 纯函数，测试与外部调用都用得到
    lineRange,
    toggleWrap,
    toggleLinePrefix,
    setHeading,
    toggleTask,
    continueList,
    indentLines,
    insertTable,
    insertHr,
    SLASH_COMMANDS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
