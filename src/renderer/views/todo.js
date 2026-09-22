(function () {
  const { el } = LingUtil;

  async function renderTodo(root) {
    const [todos, workflows] = await Promise.all([
      window.ling.todo.list(),
      window.ling.todo.workflows(),
    ]);

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

    for (const wf of workflows) {
      const colTodos = todos
        .filter((t) => t.status === wf.id)
        .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));

      const col = el('div', { class: 'board-col' }, [
        el('h4', {}, [
          el('span', { class: 'dot', style: `background:${wf.color}` }),
          el('span', { text: wf.name }),
          el('span', { class: 'muted', text: String(colTodos.length) }),
        ]),
      ]);

      const list = el('div', { class: 'list' });
      if (!colTodos.length) {
        list.appendChild(el('div', { class: 'empty', style: 'padding:14px 8px', text: '空' }));
      }

      for (const t of colTodos) {
        const done = t.status === 'done';
        const overdue = LingUtil.isOverdue(t.dueAt) && !done;

        const item = el('div', { class: `item${done ? ' done' : ''}` }, [
          el('input', {
            type: 'checkbox',
            style: 'margin-top:3px',
            checked: done ? 'checked' : null,
            onchange: async (e) => {
              const status = e.target.checked ? 'done' : t.status === 'done' ? 'today' : t.status;
              await window.ling.todo.update(t.id, { status });
              await App.refreshCurrent();
            },
          }),
          el('div', { class: 'col', style: 'flex:1;min-width:0;gap:4px' }, [
            el('div', { class: 'item-title', text: t.title }),
            el('div', {
              class: 'item-sub',
              text: LingUtil.dueLabel(t.dueAt) + (t.note ? ` · ${t.note}` : ''),
            }),
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

      col.appendChild(list);
      board.appendChild(col);
    }

    root.append(quickBar, toolbar, board);
  }

  window.TodoView = { render: renderTodo };
})();
