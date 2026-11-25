(function () {
  const { el } = LingUtil;

  let selectedId = null;
  let previewOn = true;

  const PAGE_SIZE = 50;
  let query = '';
  let offset = 0;
  let flushEdits = async () => {};

  function mdToolbar() {
    const wrap = el('div', { class: 'md-toolbar' });
    const actions = [
      ['H1', '## '],
      ['H2', '### '],
      ['B', '**加粗**'],
      ['I', '*斜体*'],
      ['`', '`代码`'],
      ['• ', '- '],
      ['1. ', '1. '],
      ['> ', '> '],
      ['[]()', '[文本](https://)'],
      ['```', '\n```\ncode\n```\n'],
    ];
    for (const [label, insert] of actions) {
      wrap.appendChild(
        el('button', {
          class: 'btn sm',
          text: label,
          onclick: () => {
            const ta = document.getElementById('noteEditor');
            if (!ta) return;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const value = ta.value;
            const selected = value.slice(start, end) || '文本';
            let next;
            if (insert.startsWith('##') || insert.startsWith('###') || insert.startsWith('- ') || insert.startsWith('1. ') || insert.startsWith('> ')) {
              next = insert + selected;
            } else if (insert.includes('\n```\n')) {
              next = `\n\`\`\`\n${selected}\n\`\`\`\n`;
            } else {
              next = insert.replace('文本', selected).replace('code', selected).replace('加粗', selected).replace('斜体', selected).replace('代码', selected);
            }
            ta.value = value.slice(0, start) + next + value.slice(end);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.focus();
          },
        })
      );
    }
    wrap.appendChild(el('span', { class: 'spacer' }));
    wrap.appendChild(
      el('button', {
        class: 'btn sm',
        text: previewOn ? '纯编辑' : '预览',
        onclick: () => {
          previewOn = !previewOn;
          App.refreshCurrent();
        },
      })
    );
    return wrap;
  }

  async function renderNotes(root, arg) {
    try {
      await flushEdits();
    } catch (error) {
      window.ling.app.notify({ title: '笔记保存失败，修改仍在编辑框中', message: error.message });
      return;
    }
    if (typeof arg === 'string') {
      selectedId = arg;
      query = '';
      offset = 0;
    } else if (arg?.id) {
      selectedId = arg.id;
    }
    const firstPage = await window.ling.note.page({ query, offset, limit: PAGE_SIZE });
    const id = selectedId || firstPage.items[0]?.id;
    let current = id ? await window.ling.note.get(id) : null;
    if (!current && firstPage.items[0]) current = await window.ling.note.get(firstPage.items[0].id);
    selectedId = current?.id || null;

    root.innerHTML = '';
    root.className = 'view ime-safe';

    const toolbar = el('div', { class: 'toolbar' }, [
      el('button', {
        class: 'btn primary',
        text: '新建笔记',
        onclick: async () => {
          const note = await window.ling.note.create({
            title: '未命名笔记',
            content: '# 未命名笔记\n\n开始记录…\n',
          });
          selectedId = note.id;
          query = '';
          offset = 0;
          await App.refreshCurrent();
        },
      }),
      el('input', {
        class: 'input',
        style: 'flex:1;min-width:140px',
        placeholder: '搜索笔记标题或内容…',
        value: query,
        oninput: (e) => {
          query = e.target.value;
          offset = 0;
          search();
        },
      }),
      current
        ? el('button', {
            class: 'btn',
            text: '外部编辑',
            title: '用灵墨 LingMark 打开这篇笔记（改动会自动回写）',
            onclick: async () => {
              if (!current) return;
              await flushEdits();
              const res = await window.ling.note.openExternal(current.id);
              if (res && res.ok) {
                window.ling.app.notify({
                  title: '已在灵墨中打开',
                  message: '在灵墨里保存后，这里会自动同步',
                });
              } else {
                window.ling.app.notify({
                  title: '无法打开外部编辑器',
                  message: (res && res.error) || '未找到灵墨',
                });
              }
            },
          })
        : null,
      current
        ? el('button', {
            class: 'btn danger',
            text: '删除当前',
            onclick: async () => {
              if (!current) return;
              await flushEdits();
              offset = 0;
              await window.ling.note.remove(current.id);
              selectedId = null;
              await App.refreshCurrent();
            },
          })
        : null,
    ]);

    const layout = el('div', { class: 'md-layout' });

    const listTitle = el('h3');
    const listBox = el('div', { class: 'col', style: 'gap:4px' });
    const listCol = el('div', { class: 'card', style: 'overflow:auto;max-height:420px' }, [listTitle, listBox]);
    let listRequest = 0;
    let currentRowTitle;
    function paintList(page) {
      listBox.innerHTML = '';
      listTitle.textContent = (query ? '匹配笔记' : '全部笔记') + ' (' + page.total + ')';
      for (const note of page.items) {
        const title = el('div', { class: 't', text: note.title });
        if (note.id === selectedId) currentRowTitle = title;
        listBox.appendChild(el('button', {
          class: 'note-list-item' + (note.id === selectedId ? ' active' : ''),
          onclick: () => App.go('notes', { id: note.id }),
        }, [title, el('div', { class: 'd', text: LingUtil.formatTime(note.updatedAt) })]));
      }
      if (!page.total) listBox.appendChild(el('div', { class: 'empty', text: query ? '没有匹配的笔记' : '暂无笔记' }));
      if (offset || page.total > PAGE_SIZE) {
        listBox.appendChild(LingUtil.pager(Math.floor(offset / PAGE_SIZE), Math.max(1, Math.ceil(page.total / PAGE_SIZE)), (page) => {
          offset = page * PAGE_SIZE;
          return loadPage();
        }));
      }
    }
    async function loadPage() {
      const request = ++listRequest;
      const page = await window.ling.note.page({ query, offset, limit: PAGE_SIZE });
      if (request === listRequest) paintList(page);
    }
    const search = LingUtil.debounce(loadPage, 120);
    paintList(firstPage);

    // editor
    let pending = {};
    let saveTimer;
    let saving;
    async function writePending() {
      while (current && Object.keys(pending).length) {
        const patch = pending;
        pending = {};
        try {
          const updated = await window.ling.note.update(current.id, patch);
          if (!updated || selectedId !== current.id) continue;
          if (currentRowTitle) currentRowTitle.textContent = updated.title;
          if (!('title' in pending) && document.activeElement !== titleInput) titleInput.value = updated.title;
          if ('content' in patch && previewOn) preview.innerHTML = LingMarkdown.renderMarkdown(editor.value);
        } catch (error) {
          pending = { ...patch, ...pending };
          throw error;
        }
      }
    }
    function flush() {
      clearTimeout(saveTimer);
      if (!saving) saving = writePending().finally(() => { saving = null; });
      return saving;
    }
    flushEdits = flush;
    function saveSoon(field, value) {
      pending[field] = value;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => flush().catch((error) =>
        window.ling.app.notify({ title: '笔记保存失败', message: error.message })), 250);
    }
    const titleInput = el('input', { class: 'input', style: 'margin-bottom:8px', id: 'noteTitle',
      placeholder: '标题', value: current?.title || '', disabled: !current,
      oninput: (e) => saveSoon('title', e.target.value),
    });
    const editor = el('textarea', { class: 'textarea', id: 'noteEditor',
      placeholder: '支持 Markdown：# 标题、**加粗**、- 列表、```代码块```…',
      value: current?.content || '', disabled: !current,
      oninput: (e) => saveSoon('content', e.target.value),
    });
    const editorCol = el('div', { class: 'card' }, [el('h3', { text: '编辑 Markdown' }), mdToolbar(), titleInput, editor]);

    // preview — 修复 issue #8
    const preview = el('div', { class: 'md-preview', id: 'mdPreview',
      html: current && previewOn ? LingMarkdown.renderMarkdown(current.content) : '',
    });
    const previewCol = el('div', { class: 'card', hidden: !previewOn }, [el('h3', { text: '预览' }), preview]);

    layout.append(listCol, editorCol, previewCol);
    if (!previewOn) {
      layout.style.gridTemplateColumns = '200px 1fr';
    }

    root.append(toolbar, layout);
  }

  window.NotesView = { render: renderNotes };
})();
