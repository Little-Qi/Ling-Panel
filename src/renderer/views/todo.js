(function () {
  const { el } = LingUtil;

  async function renderTodo(root) {
    const workflows = await window.ling.todo.workflows();

    root.innerHTML = '';
    root.className = 'view ime-safe';

    // 快捷条：回车即存，默认今晚 23:30
    const quick = el('input', {
      class: 'input',
      placeholder: '快速记一条待办，回车添加…',
      id: 'todoQuick',
    });
    const quickBar = el('div', { class: 'quick-bar' }, [
      el('span', { class: 'muted', style: 'flex-shrink:0', text: '＋' }),
      quick,
    ]);

    const toolbar = el('div', { class: 'toolbar', style: 'margin-bottom:8px' });
    const statusSel = el(
      'select',
      { class: 'select', style: 'width:110px' },
      workflows.map((w) => el('option', { value: w.id, text: w.name }))
    );
    const dueInput = el('input', {
      class: 'input',
      type: 'datetime-local',
      style: 'width:180px',
    });
    (function setDefaultDue() {
      const d = new Date();
      d.setHours(23, 30, 0, 0);
      const pad = (n) => String(n).padStart(2, '0');
      dueInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    })();

    toolbar.append(
      el('span', { class: 'muted', text: '状态' }),
      statusSel,
      el('span', { class: 'muted', text: '截止' }),
      dueInput,
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted', text: '回车即可保存' })
    );

    async function addFromQuick() {
      const title = quick.value.trim();
      if (!title) {
        quick.focus();
        return;
      }
      let dueAt = null;
      if (dueInput.value) dueAt = new Date(dueInput.value).getTime();
      await window.ling.todo.create({ title, status: statusSel.value, dueAt });
      quick.value = '';
      await App.refreshCurrent();
      const again = document.getElementById('todoQuick');
      if (again) again.focus();
    }

    quick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addFromQuick();
    });

    const board = el('div', { class: 'board' });
    // 已完成默认只露出最近几条，避免越积越长
    let showAllDone = false;
    const DONE_PREVIEW = 6;

    const pages = Object.create(null);
    let request = 0;
    async function renderBoard() {
      const version = ++request;
      const groups = await window.ling.todo.board(pages, showAllDone);
      if (version !== request) return;
      board.innerHTML = '';
      for (const wf of workflows) {
        const isDoneCol = wf.id === 'done';
        const group = groups.find((g) => g.name === wf.id);
        const colTodos = group?.items || [];
        const total = group?.total || 0;

        const header = el('h4', {}, [
          el('span', { class: 'dot', style: `background:${wf.color}` }),
          el('span', { text: wf.name }),
          el('span', { class: 'muted', text: String(total) }),
        ]);

        if (isDoneCol && total > 0) {
          const clearBtn = el('button', {
            class: 'btn sm ghost',
            title: '清空所有已完成',
            text: '清空',
            onclick: async () => {
              if (!confirm(`清空 ${total} 条已完成？`)) return;
              await window.ling.todo.clearDone();
              await App.refreshCurrent();
            },
          });
          header.appendChild(el('span', { class: 'spacer' }));
          header.appendChild(clearBtn);
        }

        const col = el('div', { class: 'board-col' }, [header]);
        const list = el('div', { class: 'list' });
        if (!colTodos.length) {
          list.appendChild(el('div', { class: 'empty', style: 'padding:14px 8px', text: '空' }));
        }

        for (const t of colTodos) {
          const done = t.status === 'done';
          // 已完成不再提示逾期
          const overdue = !done && LingUtil.isOverdue(t.dueAt);
          const sub = done
            ? [t.note ? t.note : '', `${LingUtil.formatTime(t.updatedAt || t.createdAt)} 完成`]
                .filter(Boolean)
                .join(' · ')
            : LingUtil.dueLabel(t.dueAt) + (t.note ? ` · ${t.note}` : '');

          const item = el('div', { class: `item${done ? ' done' : ''}` }, [
            el('input', {
              type: 'checkbox',
              style: 'margin-top:3px',
              checked: done,
              onchange: async (e) => {
                const status = e.target.checked ? 'done' : t.status === 'done' ? 'today' : t.status;
                await window.ling.todo.update(t.id, { status });
                await App.refreshCurrent();
              },
            }),
            el('div', { class: 'col', style: 'flex:1;min-width:0;gap:4px' }, [
              el('div', { class: 'item-title', text: t.title }),
              sub ? el('div', { class: 'item-sub', text: sub }) : null,
              el(
                'div',
                { class: 'row', style: 'gap:4px;margin-top:2px;flex-wrap:wrap' },
                workflows
                  .filter((w) => w.id !== t.status)
                  .map((w) =>
                    el('button', {
                      class: 'btn sm ghost',
                      text: `→ ${w.name}`,
                      onclick: async () => {
                        await window.ling.todo.update(t.id, { status: w.id });
                        await App.refreshCurrent();
                      },
                    })
                  )
              ),
            ]),
            el('div', { class: 'col', style: 'gap:4px;align-items:flex-end' }, [
              el('span', {
                class: `chip ${overdue ? 'red' : done ? 'green' : 'blue'}`,
                text: overdue ? '逾期' : wf.name,
              }),
              el('button', {
                class: 'btn sm danger',
                text: '删',
                onclick: async () => {
                  await window.ling.todo.remove(t.id);
                  await App.refreshCurrent();
                },
              }),
            ]),
          ]);
          list.appendChild(item);
        }

        if (isDoneCol && total > DONE_PREVIEW) {
          list.appendChild(
            el('button', {
              class: 'btn sm ghost',
              style: 'width:100%;margin-top:6px',
              text: showAllDone ? '收起' : `查看全部 ${total} 条`,
              onclick: () => {
                showAllDone = !showAllDone;
                pages[wf.id] = 0;
                renderBoard();
              },
            })
          );
        }

        if (group?.pageCount > 1 && (!isDoneCol || showAllDone)) {
          list.appendChild(LingUtil.pager(group.page, group.pageCount, (page) => {
            pages[wf.id] = page;
            return renderBoard();
          }));
        }
        col.appendChild(list);
        board.appendChild(col);
      }
    }

    await renderBoard();
    root.append(quickBar, toolbar, board);
  }

  window.TodoView = { render: renderTodo };
})();
