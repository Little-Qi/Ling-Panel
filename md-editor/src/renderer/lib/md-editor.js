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
    const preview = el('div', { class: 'mde-view md-body' });
    const outlineBox = el('div', { class: 'mde-outline' });
    const findBox = el('div', { class: 'mde-find hidden' });
    const slashBox = el('div', { class: 'mde-slash hidden' });
    const cmdBox = el('div', { class: 'mde-cmd hidden' });
    const statusLeft = el('span', { class: 'mde-status-item' });
    const statusRight = el('span', { class: 'mde-status-item' });
    const fileNameEl = el('span', { class: 'mde-filename' });
    const fileSubEl = el('span', { class: 'mde-sub' });
    const titleEl = el('div', { class: 'mde-title' }, [fileNameEl, fileSubEl]);
    const toolbar = el('div', { class: 'mde-toolbar' });
    const segBox = el('div', { class: 'mde-seg' });

    const editPane = el('div', { class: 'mde-pane mde-pane-edit' }, [ta]);
    const viewPane = el('div', { class: 'mde-pane mde-pane-view' }, [preview]);
    const main = el('div', { class: 'mde-main' }, [
      el('div', { class: 'mde-outline-wrap' }, [outlineBox]),
      editPane,
      viewPane,
    ]);

    const root = el('div', { class: 'mde' }, [
      titleEl,
      toolbar,
      main,
      findBox,
      slashBox,
      cmdBox,
      el('div', { class: 'mde-status' }, [statusLeft, statusRight]),
    ]);
    host.innerHTML = '';
    host.appendChild(root);

    // —— 状态同步 ——
    function applyMode() {
      root.dataset.mode = state.mode;
      root.classList.toggle('is-zen', state.zen);
      root.classList.toggle('is-typewriter', state.typewriter);
      editPane.hidden = state.mode === 'preview';
      viewPane.hidden = state.mode === 'edit';
      outlineBox.parentElement.hidden = state.mode !== 'split' || state.zen;
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
    const paintPreview = debounce(() => {
      const html = MD.renderMarkdown(ta.value);
      preview.innerHTML = html || '<p class="mde-hint">开始写点什么…</p>';
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
                ta.scrollTop = Math.max(0, (line - 3) * lineHeight);
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
      titleEl.classList.toggle('is-dirty', state.dirty);
    }

    function dirLabel(p) {
      const s = String(p || '');
      const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
      return i >= 0 ? s.slice(0, i) : '';
    }

    // —— 预览里的任务清单可点 ——
    function wirePreview() {
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
    function buildToolbar() {
      toolbar.innerHTML = '';
      const group = (items) => {
        const g = el('div', { class: 'mde-tb-group' });
        for (const it of items) {
          g.appendChild(
            el('button', {
              class: 'mde-tb-btn' + (it.active ? ' is-active' : ''),
              text: it.label,
              title: it.title || it.label,
              onclick: it.onclick,
            })
          );
        }
        return g;
      };

      toolbar.appendChild(
        group([
          { label: 'H1', title: '一级标题 (Ctrl+Alt+1)', onclick: () => apply(setHeading(ta.value, sel(), 1)) },
          { label: 'H2', title: '二级标题 (Ctrl+Alt+2)', onclick: () => apply(setHeading(ta.value, sel(), 2)) },
          { label: 'H3', title: '三级标题 (Ctrl+Alt+3)', onclick: () => apply(setHeading(ta.value, sel(), 3)) },
        ])
      );
      toolbar.appendChild(
        group([
          {
            label: 'B',
            title: '加粗 (Ctrl+B)',
            onclick: () => apply(toggleWrap(ta.value, sel(), '**', '**', '加粗')),
          },
          {
            label: 'I',
            title: '斜体 (Ctrl+I)',
            onclick: () => apply(toggleWrap(ta.value, sel(), '*', '*', '斜体')),
          },
          {
            label: 'S',
            title: '删除线 (Ctrl+Shift+X)',
            onclick: () => apply(toggleWrap(ta.value, sel(), '~~', '~~', '删除')),
          },
          {
            label: '<>',
            title: '行内代码 (Ctrl+`)',
            onclick: () => apply(toggleWrap(ta.value, sel(), '`', '`', 'code')),
          },
        ])
      );
      toolbar.appendChild(
        group([
          {
            label: '•',
            title: '无序列表',
            onclick: () => apply(toggleLinePrefix(ta.value, sel(), '- ')),
          },
          {
            label: '1.',
            title: '有序列表',
            onclick: () => apply(toggleLinePrefix(ta.value, sel(), '1. ')),
          },
          {
            label: '☑',
            title: '任务清单',
            onclick: () => apply(toggleTask(ta.value, sel())),
          },
          {
            label: '❝',
            title: '引用',
            onclick: () => apply(toggleLinePrefix(ta.value, sel(), '> ')),
          },
        ])
      );
      toolbar.appendChild(
        group([
          {
            label: '🔗',
            title: '链接 (Ctrl+K)',
            onclick: () => apply(toggleWrap(ta.value, sel(), '[', '](https://)', '链接文字')),
          },
          {
            label: '🖼',
            title: '图片',
            onclick: () => apply(toggleWrap(ta.value, sel(), '![', '](image.png)', 'alt')),
          },
          { label: '▦', title: '表格', onclick: () => apply(insertTable(ta.value, sel())) },
          { label: '—', title: '分隔线', onclick: () => apply(insertHr(ta.value, sel())) },
        ])
      );

      const spacer = el('div', { class: 'mde-tb-spacer' });
      toolbar.appendChild(spacer);

      toolbar.appendChild(
        el('button', {
          class: 'mde-tb-btn',
          text: '⌘',
          title: '命令面板 (Ctrl+Shift+P)',
          onclick: () => openCmd(''),
        })
      );
      toolbar.appendChild(
        el('button', {
          class: 'mde-tb-btn' + (state.typewriter ? ' is-active' : ''),
          text: '⤓',
          title: '打字机模式：当前行始终居中',
          onclick: () => {
            state.typewriter = !state.typewriter;
            applyMode();
            buildToolbar();
          },
        })
      );
      toolbar.appendChild(
        el('button', {
          class: 'mde-tb-btn' + (state.zen ? ' is-active' : ''),
          text: '◱',
          title: '专注模式 (Ctrl+Shift+F)',
          onclick: () => {
            state.zen = !state.zen;
            applyMode();
            buildToolbar();
          },
        })
      );
    }

    /** 视图切换：放在文档头的右侧，做成分段控件 */
    function buildSeg() {
      segBox.innerHTML = '';
      const modes = [
        ['split', '并排'],
        ['edit', '编辑'],
        ['preview', '预览'],
      ];
      for (const [m, label] of modes) {
        segBox.appendChild(
          el('button', {
            class: 'mde-tb-btn' + (state.mode === m ? ' is-active' : ''),
            text: label,
            title: `视图：${label}`,
            onclick: () => {
              state.mode = m;
              applyMode();
              buildSeg();
              buildToolbar();
            },
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
          state.zen = !state.zen;
          applyMode();
          buildToolbar();
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
          const mode = ['split', 'edit', 'preview'][Number(key) - 1];
          state.mode = mode;
          applyMode();
          buildSeg();
          buildToolbar();
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
    ta.addEventListener('scroll', () => {
      preview.scrollTop = ta.scrollTop;
    });

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
        { id: 'save', label: '保存文件', hint: 'Ctrl+S', run: () => emit('save') },
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
    titleEl.appendChild(el('div', { class: 'mde-tb-spacer' }));
    titleEl.appendChild(segBox);
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
      setMode(m) {
        state.mode = m;
        applyMode();
        buildSeg();
        buildToolbar();
      },
      toggleZen() {
        state.zen = !state.zen;
        applyMode();
        buildToolbar();
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
