(function () {
  const { el, expandableText } = LingUtil;

  async function renderHome(root) {
    const [todos, notes, links, pomodoro, clipsRaw, clipInboxRaw] = await Promise.all([
      window.ling.todo.list(),
      window.ling.note.list(),
      window.ling.link.list(),
      window.ling.pomodoro.get(),
      window.ling.store.get('clips'),
      window.ling.store.get('clipInbox'),
    ]);
    const clips = Array.isArray(clipsRaw) ? clipsRaw : [];
    const clipInbox = Array.isArray(clipInboxRaw) ? clipInboxRaw : [];

    const openTodos = todos.filter((t) => t.status !== 'done');
    const dueSoon = openTodos
      .filter((t) => t.dueAt && t.dueAt - Date.now() < 3600e3)
      .sort((a, b) => a.dueAt - b.dueAt);
    const overdue = openTodos.filter((t) => LingUtil.isOverdue(t.dueAt));
    const pomo = pomodoro || { focusMin: 25, history: [] };
    const today = new Date();
    const todayDone = (pomo.history || []).filter(
      (h) => new Date(h.at).toDateString() === today.toDateString()
    ).length;

    root.innerHTML = '';
    root.className = 'view ime-safe';

    const quickTodo = el('input', {
      class: 'input',
      placeholder: '记待办，回车…',
      id: 'homeQuickTodo',
    });
    const quickNote = el('input', {
      class: 'input',
      placeholder: '记一句笔记，回车…',
      id: 'homeQuickNote',
    });

    quickTodo.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const v = quickTodo.value.trim();
      if (!v) return;
      await window.ling.todo.create({ title: v, status: 'today' });
      quickTodo.value = '';
      await App.refreshCurrent();
    });
    quickNote.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const v = quickNote.value.trim();
      if (!v) return;
      await window.ling.note.create({ content: v, title: v.slice(0, 24) });
      quickNote.value = '';
      window.ling.app.notify({ title: '已记入笔记', message: v.slice(0, 30) });
      await App.refreshCurrent();
    });

    const quickBar = el('div', { class: 'quick-bar' }, [
      el('span', { class: 'muted', style: 'flex-shrink:0', text: '速记' }),
      quickTodo,
      el('span', { style: 'width:1px;height:16px;background:var(--line)' }),
      quickNote,
    ]);

    const bento = el('div', { class: 'bento' });

    bento.appendChild(
      el('div', { class: 'card span-5' }, [
        el('h3', { text: '今天' }),
        el('div', { class: 'stat', text: `${openTodos.length} 项未完成` }),
        el('div', {
          class: 'muted',
          style: 'margin-top:4px',
          text: overdue.length ? `${overdue.length} 项已逾期` : '节奏正常',
        }),
        el('div', { class: 'row', style: 'margin-top:12px;flex-wrap:wrap' }, [
          el('button', { class: 'btn primary', text: '待办', onclick: () => App.go('todo') }),
          el('button', { class: 'btn', text: '笔记', onclick: () => App.go('notes') }),
          el('button', {
            class: 'btn',
            text: `番茄 ${pomo.focusMin || 25}′`,
            onclick: () => App.go('pomodoro'),
          }),
        ]),
      ])
    );

    // —— 剪贴板卡片：就地递补，数据以 store 为准 ——
    const clipStat = el('div', { class: 'stat', text: `${(clipInbox || []).length} 条待处理` });
    const clipStack = el('div', { class: 'clip-stack' });
    const clipFoot = el('div', {
      class: 'muted clip-card-foot',
      style: 'margin-top:8px;font-size:12px',
      text: `已收藏片段 ${(clips || []).length}`,
    });

    async function paintClipStack() {
      const inbox = (await window.ling.store.get('clipInbox')) || [];
      const clipsNow = (await window.ling.store.get('clips')) || [];
      clipStat.textContent = `${inbox.length} 条待处理`;
      clipFoot.textContent = `已收藏片段 ${clipsNow.length}`;
      clipStack.innerHTML = '';

      if (!inbox.length) {
        clipStack.appendChild(
          el('div', { class: 'empty', style: 'padding:10px', text: '暂时空闲' })
        );
        return;
      }

      for (const c of inbox.slice(0, 3)) {
        const preview = String(c.content || '').replace(/\s+/g, ' ').trim().slice(0, 70);
        const cardHost = el('div', { class: 'clip-stack-slot' });
        const row = el('div', { class: 'clip-stack-item' });

        async function settle(action) {
          if (row.parentNode) {
            row.classList.add(action === 'drop' ? 'leaving-drop' : 'leaving');
            await new Promise((r) => setTimeout(r, 160));
          }
          // 以当前 store 为准，避免用旧快照把已删条目写回去
          const inboxNow = (await window.ling.store.get('clipInbox')) || [];
          const item = inboxNow.find((x) => x.id === c.id);
          const rest = inboxNow.filter((x) => x.id !== c.id);
          await window.ling.store.set('clipInbox', rest);

          if (item) {
            if (action === 'clip') {
              const list = (await window.ling.store.get('clips')) || [];
              list.unshift({
                id: 'c_' + Date.now().toString(36),
                content: item.content,
                createdAt: Date.now(),
                kind: 'text',
              });
              await window.ling.store.set('clips', list.slice(0, 500));
            } else if (action === 'note') {
              await window.ling.note.create({
                title: preview.slice(0, 32) || '剪贴笔记',
                content: item.content,
              });
            } else if (action === 'ai') {
              await window.ling.ai.add({
                role: 'q',
                content: item.content,
                source: 'clipboard',
                autoTitle: true,
              });
            }
          }
          // 重画卡片区，后面的自动补位
          await paintClipStack();
        }

        row.append(
          expandableText(String(c.content || ''), {
            limit: 56,
            class: 'expandable-text item-title',
          }),
          el('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' }, [
            el('button', {
              class: 'btn sm ghost',
              text: '复制',
              onclick: async (e) => {
                e.stopPropagation();
                const ok =
                  window.ClipManager && (await window.ClipManager.copyText(c.content));
                window.ling.app.notify({
                  title: ok ? '已复制' : '复制失败',
                  message: preview.slice(0, 20),
                });
              },
            }),
            el('button', {
              class: 'btn sm primary',
              text: '片段',
              onclick: () => settle('clip'),
            }),
            el('button', {
              class: 'btn sm',
              text: '笔记',
              onclick: () => settle('note'),
            }),
            el('button', {
              class: 'btn sm ghost',
              text: '丢弃',
              onclick: () => settle('drop'),
            }),
          ])
        );
        cardHost.appendChild(row);
        clipStack.appendChild(cardHost);
      }
    }

    await paintClipStack();

    bento.appendChild(
      el('div', { class: 'card span-4 clip-card' }, [
        el('div', { class: 'row', style: 'justify-content:space-between;align-items:center;gap:8px' }, [
          el('h3', { text: '剪贴板' }),
          el('button', {
            class: 'btn sm',
            text: '所有',
            onclick: () => window.ClipManager && window.ClipManager.open({ tab: 'inbox' }),
          }),
        ]),
        clipStat,
        el('div', {
          class: 'muted',
          style: 'margin-top:2px',
          text: '一张一张决定，或点「所有」批量处理',
        }),
        clipStack,
        clipFoot,
      ])
    );

    bento.appendChild(
      el('div', { class: 'card span-3' }, [
        el('h3', { text: '今日番茄' }),
        el('div', { class: 'stat', text: String(todayDone) }),
        el('div', { class: 'muted', style: 'margin-top:4px', text: '拖圆环可改时长' }),
        el('button', {
          class: 'btn sm',
          style: 'margin-top:10px',
          text: '去专注',
          onclick: () => App.go('pomodoro'),
        }),
      ])
    );

    bento.appendChild(
      el('div', { class: 'card span-4' }, [
        el('h3', { text: '快捷键' }),
        el('div', { class: 'col', style: 'gap:6px' }, [
          el('div', { class: 'muted' }, [
            el('span', { class: 'kbd', text: 'Alt+Space' }),
            document.createTextNode(' 展开/收起'),
          ]),
          el('div', { class: 'muted' }, [
            el('span', { class: 'kbd', text: 'Esc' }),
            document.createTextNode(' 收起'),
          ]),
          el('div', { class: 'muted', text: '信息只留在你的电脑里' }),
        ]),
      ])
    );

    bento.appendChild(
      el('div', { class: 'card span-7' }, [
        el('h3', {}, [
          el('span', { text: '即将到期' }),
          el('button', { class: 'btn sm', text: '全部', onclick: () => App.go('todo') }),
        ]),
        !dueSoon.length && !overdue.length
          ? el('div', { class: 'empty', text: '一小时内没有紧急事项' })
          : el(
              'div',
              { class: 'list' },
              [...overdue, ...dueSoon.filter((t) => !overdue.includes(t))].slice(0, 5).map((t) =>
                el('div', { class: 'item' }, [
                  el('div', { class: 'col', style: 'flex:1;min-width:0' }, [
                    el('div', { class: 'item-title', text: t.title }),
                    el('div', { class: 'item-sub', text: LingUtil.dueLabel(t.dueAt) }),
                  ]),
                  el('span', {
                    class: `chip ${LingUtil.isOverdue(t.dueAt) ? 'red' : 'amber'}`,
                    text: t.status,
                  }),
                ])
              )
            ),
      ])
    );

    bento.appendChild(
      el('div', { class: 'card span-5' }, [
        el('h3', {}, [
          el('span', { text: '最近笔记' }),
          el('button', { class: 'btn sm', text: '打开', onclick: () => App.go('notes') }),
        ]),
        !notes.length
          ? el('div', { class: 'empty', text: '上方输入框回车即可速记' })
          : el(
              'div',
              { class: 'list' },
              notes.slice(0, 4).map((n) =>
                el('div', { class: 'item', onclick: () => App.go('notes', n.id) }, [
                  el('div', { class: 'col', style: 'flex:1;min-width:0' }, [
                    el('div', { class: 'item-title', text: n.title }),
                    el('div', { class: 'item-sub', text: LingUtil.formatTime(n.updatedAt) }),
                  ]),
                ])
              )
            ),
      ])
    );

    bento.appendChild(
      el('div', { class: 'card span-4' }, [
        el('h3', { text: '链接' }),
        !links.length
          ? el('div', { class: 'empty', text: '去「链接」页收藏' })
          : el(
              'div',
              { class: 'list' },
              links.slice(0, 3).map((l) =>
                el('div', { class: 'item', onclick: () => window.open(l.url, '_blank') }, [
                  el('div', { class: 'col', style: 'flex:1;min-width:0' }, [
                    el('div', { class: 'item-title', text: l.title || l.url }),
                    el('div', { class: 'item-sub', text: l.url }),
                  ]),
                ])
              )
            ),
      ])
    );

    bento.appendChild(
      el('div', { class: 'card span-4' }, [
        el('h3', { text: '数据' }),
        el('div', {
          class: 'muted',
          style: 'line-height:1.6',
          text: '内容都在本机，不上传。',
        }),
        el('button', {
          class: 'btn sm',
          style: 'margin-top:10px',
          text: '设置',
          onclick: () => App.go('settings'),
        }),
      ])
    );

    bento.appendChild(
      el('div', { class: 'card span-4' }, [
        el('h3', { text: '论文归档' }),
        el('div', { class: 'muted', text: '把下载的 PDF 收进文献夹。' }),
        el('button', {
          class: 'btn sm',
          style: 'margin-top:10px',
          text: '去整理',
          onclick: () => App.go('papers'),
        }),
      ])
    );

    root.append(quickBar, bento);
  }

  window.HomeView = { render: renderHome };
})();
