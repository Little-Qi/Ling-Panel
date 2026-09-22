(function () {
  const { el } = LingUtil;

  let selectedId = null;
  let previewOn = true;

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
    const notes = await window.ling.note.list();
    if (arg && typeof arg === 'string') selectedId = arg;
    if (!selectedId && notes[0]) selectedId = notes[0].id;
    const current = notes.find((n) => n.id === selectedId) || notes[0] || null;

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
          await App.refreshCurrent();
        },
      }),
      el('input', {
        class: 'input',
        style: 'flex:1;min-width:140px',
        placeholder: '搜索笔记标题或内容…',
        oninput: (e) => {
          const q = e.target.value.trim().toLowerCase();
          document.querySelectorAll('.note-list-item').forEach((node) => {
            const hay = node.getAttribute('data-hay') || '';
            node.style.display = !q || hay.includes(q) ? '' : 'none';
          });
        },
      }),
      current
        ? el('button', {
            class: 'btn danger',
            text: '删除当前',
            onclick: async () => {
              if (!current) return;
              await window.ling.note.remove(current.id);
              selectedId = null;
              await App.refreshCurrent();
            },
          })
        : null,
    ]);

    const layout = el('div', { class: 'md-layout' });

    // list
    const listCol = el('div', { class: 'card', style: 'overflow:auto;max-height:420px' }, [
      el('h3', { text: `全部笔记 (${notes.length})` }),
    ]);
    const listBox = el('div', { class: 'col', style: 'gap:4px' });
    if (!notes.length) {
      listBox.appendChild(el('div', { class: 'empty', text: '暂无笔记' }));
    }
    for (const n of notes) {
      listBox.appendChild(
        el(
          'div',
          {
            class: `note-list-item${n.id === (current && current.id) ? ' active' : ''}`,
            'data-hay': `${n.title} ${n.content}`.toLowerCase(),
            onclick: () => {
              selectedId = n.id;
              App.refreshCurrent();
            },
          },
          [
            el('div', { class: 't', text: n.title }),
            el('div', { class: 'd', text: LingUtil.formatTime(n.updatedAt) }),
          ]
        )
      );
    }
    listCol.appendChild(listBox);

    // editor
    const editorCol = el('div', { class: 'card' }, [
      el('h3', { text: '编辑 Markdown' }),
      mdToolbar(),
      el('input', {
        class: 'input',
        style: 'margin-bottom:8px',
        id: 'noteTitle',
        placeholder: '标题',
        value: current ? current.title : '',
        oninput: LingUtil.debounce(async (e) => {
          if (!current) return;
          await window.ling.note.update(current.id, { title: e.target.value });
        }, 400),
      }),
      el('textarea', {
        class: 'textarea',
        id: 'noteEditor',
        placeholder: '支持 Markdown：# 标题、**加粗**、- 列表、```代码块```…',
        text: current ? current.content : '',
        oninput: LingUtil.debounce(async (e) => {
          if (!current) return;
          await window.ling.note.update(current.id, { content: e.target.value });
          const preview = document.getElementById('mdPreview');
          if (preview) preview.innerHTML = LingMarkdown.renderMarkdown(e.target.value);
          const titleInput = document.getElementById('noteTitle');
          const next = await window.ling.note.list();
          const updated = next.find((n) => n.id === current.id);
          if (titleInput && updated && document.activeElement !== titleInput) {
            titleInput.value = updated.title;
          }
        }, 250),
      }),
    ]);

    // preview — 修复 issue #8
    const previewCol = el('div', { class: 'card', hidden: !previewOn }, [
      el('h3', { text: '预览' }),
      el('div', {
        class: 'md-preview',
        id: 'mdPreview',
        html: current ? LingMarkdown.renderMarkdown(current.content) : '<p class="muted">选择或新建一篇笔记</p>',
      }),
    ]);

    layout.append(listCol, editorCol, previewCol);
    if (!previewOn) {
      layout.style.gridTemplateColumns = '200px 1fr';
    }

    root.append(toolbar, layout);
  }

  window.NotesView = { render: renderNotes };
})();
