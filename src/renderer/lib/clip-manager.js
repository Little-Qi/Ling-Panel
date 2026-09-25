/**
 * 剪贴板全量管理：搜索、多选、批量归档 / 复制 / 丢弃。
 * 挂在 window.ClipManager，首页「所有」与快捷入口打开。
 */
(function (global) {
  const { el, expandableText, formatTime } = LingUtil;

  let overlay = null;
  let state = {
    query: '',
    tab: 'inbox', // inbox | clips
    selected: new Set(),
  };

  async function copyText(text) {
    const t = String(text || '');
    if (!t) return false;
    if (window.ling && window.ling.app && window.ling.app.clipboardWrite) {
      return await window.ling.app.clipboardWrite(t);
    }
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      return false;
    }
  }

  async function loadAll() {
    const [inbox, clips] = await Promise.all([
      window.ling.store.get('clipInbox'),
      window.ling.store.get('clips'),
    ]);
    return {
      inbox: Array.isArray(inbox) ? inbox : [],
      clips: Array.isArray(clips) ? clips : [],
    };
  }

  function matchItem(c, q) {
    if (!q) return true;
    return String(c.content || '').toLowerCase().includes(q.toLowerCase());
  }

  async function applyInboxAction(ids, action) {
    const data = await loadAll();
    const idSet = new Set(ids);
    const picked = data.inbox.filter((x) => idSet.has(x.id));
    const rest = data.inbox.filter((x) => !idSet.has(x.id));
    if (action === 'drop') {
      await window.ling.store.set('clipInbox', rest);
      return picked.length;
    }
    if (action === 'copy') {
      const ok = await copyText(picked.map((p) => p.content).join('\n\n---\n\n'));
      return ok ? picked.length : 0;
    }
    if (action === 'clip') {
      const list = picked.map((c) => ({
        id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        content: c.content,
        createdAt: c.createdAt || Date.now(),
        kind: 'text',
      }));
      await window.ling.store.set('clips', [...list, ...data.clips].slice(0, 500));
      await window.ling.store.set('clipInbox', rest);
      return picked.length;
    }
    if (action === 'note') {
      for (const c of picked) {
        const preview = String(c.content || '').replace(/\s+/g, ' ').trim().slice(0, 32);
        await window.ling.note.create({
          title: preview || '剪贴笔记',
          content: c.content,
        });
      }
      await window.ling.store.set('clipInbox', rest);
      return picked.length;
    }
    if (action === 'todo') {
      for (const c of picked) {
        const preview = String(c.content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        await window.ling.todo.create({
          title: preview || '剪贴待办',
          status: 'today',
          note: String(c.content || '').slice(0, 500),
        });
      }
      await window.ling.store.set('clipInbox', rest);
      return picked.length;
    }
    return 0;
  }

  async function applyClipAction(ids, action) {
    const data = await loadAll();
    const idSet = new Set(ids);
    const picked = data.clips.filter((x) => idSet.has(x.id));
    if (action === 'copy') {
      const ok = await copyText(picked.map((p) => p.content).join('\n\n---\n\n'));
      return ok ? picked.length : 0;
    }
    if (action === 'delete') {
      await window.ling.store.set('clips', data.clips.filter((x) => !idSet.has(x.id)));
      return picked.length;
    }
    return 0;
  }

  function close() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    state.selected = new Set();
    document.removeEventListener('keydown', onEsc);
  }

  function onEsc(e) {
    if (e.key === 'Escape') close();
  }

  async function paint() {
    if (!overlay) return;
    const body = overlay.querySelector('.clip-mgr-body');
    const stats = overlay.querySelector('.clip-mgr-stats');
    if (!body) return;
    body.innerHTML = '';

    const data = await loadAll();
    const q = state.query.trim();
    const list = (state.tab === 'inbox' ? data.inbox : data.clips).filter((c) => matchItem(c, q));

    // 选中集里不在当前列表的先清掉
    const live = new Set(list.map((x) => x.id));
    for (const id of [...state.selected]) {
      if (!live.has(id)) state.selected.delete(id);
    }

    if (stats) {
      const total = state.tab === 'inbox' ? data.inbox.length : data.clips.length;
      stats.textContent = q ? `${list.length} / ${total}` : `${total} 条`;
    }

    if (!list.length) {
      body.appendChild(
        el('div', {
          class: 'empty',
          text: state.tab === 'inbox' ? '待归档是空的' : '还没有收藏片段',
        })
      );
      return;
    }

    for (const c of list) {
      const selected = state.selected.has(c.id);
      const row = el('div', { class: 'clip-mgr-row' + (selected ? ' selected' : '') }, [
        el('input', {
          type: 'checkbox',
          class: 'clip-mgr-check',
          checked: selected,
          onchange: (e) => {
            if (e.target.checked) state.selected.add(c.id);
            else state.selected.delete(c.id);
            row.classList.toggle('selected', e.target.checked);
            overlay.querySelector('.clip-mgr-bulk-count').textContent = `已选 ${state.selected.size}`;
          },
        }),
        el('div', { class: 'col', style: 'flex:1;min-width:0;gap:4px' }, [
          expandableText(String(c.content || ''), { limit: 120, class: 'expandable-text' }),
          el('div', { class: 'item-sub', text: formatTime(c.createdAt) }),
        ]),
        el('div', { class: 'row', style: 'gap:4px;flex-shrink:0;flex-wrap:wrap' }, [
          el('button', {
            class: 'btn sm ghost',
            title: '复制到剪贴板',
            text: '复制',
            onclick: async () => {
              const ok = await copyText(c.content);
              window.ling.app.notify({
                title: ok ? '已复制' : '复制失败',
                message: String(c.content || '').slice(0, 24),
              });
            },
          }),
          ...(state.tab === 'inbox'
            ? [
                el('button', {
                  class: 'btn sm',
                  text: '片段',
                  onclick: async () => {
                    await applyInboxAction([c.id], 'clip');
                    await paint();
                    if (global.App) App.refreshCurrent();
                  },
                }),
                el('button', {
                  class: 'btn sm',
                  text: '笔记',
                  onclick: async () => {
                    await applyInboxAction([c.id], 'note');
                    await paint();
                    if (global.App) App.refreshCurrent();
                  },
                }),
                el('button', {
                  class: 'btn sm ghost',
                  text: '丢弃',
                  onclick: async () => {
                    await applyInboxAction([c.id], 'drop');
                    await paint();
                    if (global.App) App.refreshCurrent();
                  },
                }),
              ]
            : [
                el('button', {
                  class: 'btn sm ghost',
                  text: '删除',
                  onclick: async () => {
                    await applyClipAction([c.id], 'delete');
                    await paint();
                    if (global.App) App.refreshCurrent();
                  },
                }),
              ]),
        ]),
      ]);
      body.appendChild(row);
    }
  }

  function bulkBar() {
    const count = el('span', { class: 'muted clip-mgr-bulk-count', text: '已选 0' });

    async function run(action, label) {
      const ids = [...state.selected];
      if (!ids.length) {
        window.ling.app.notify({ title: '先勾选条目', message: '' });
        return;
      }
      let n = 0;
      if (state.tab === 'inbox') n = await applyInboxAction(ids, action);
      else if (action === 'delete') n = await applyClipAction(ids, 'delete');
      else if (action === 'copy') n = await applyClipAction(ids, 'copy');
      state.selected = new Set();
      await paint();
      if (global.App) App.refreshCurrent();
      window.ling.app.notify({ title: label, message: `${n} 条` });
    }

    return el('div', { class: 'clip-mgr-bulk' }, [
      count,
      el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, [
        el('button', { class: 'btn sm', text: '复制', onclick: () => run('copy', '已复制') }),
        ...(state.tab === 'inbox'
          ? [
              el('button', { class: 'btn sm primary', text: '存片段', onclick: () => run('clip', '已存片段') }),
              el('button', { class: 'btn sm', text: '存笔记', onclick: () => run('note', '已存笔记') }),
              el('button', { class: 'btn sm', text: '存待办', onclick: () => run('todo', '已存待办') }),
              el('button', { class: 'btn sm ghost', text: '丢弃', onclick: () => run('drop', '已丢弃') }),
            ]
          : [el('button', { class: 'btn sm danger', text: '删除', onclick: () => run('delete', '已删除') })]),
        el('button', {
          class: 'btn sm ghost',
          text: '全选',
          onclick: async () => {
            const data = await loadAll();
            const list = (state.tab === 'inbox' ? data.inbox : data.clips).filter((c) =>
              matchItem(c, state.query.trim())
            );
            state.selected = new Set(list.map((x) => x.id));
            await paint();
          },
        }),
        el('button', {
          class: 'btn sm ghost',
          text: '清空选中',
          onclick: async () => {
            state.selected = new Set();
            await paint();
          },
        }),
      ]),
    ]);
  }

  function open(opts = {}) {
    close();
    state = {
      query: '',
      tab: opts.tab === 'clips' ? 'clips' : 'inbox',
      selected: new Set(),
    };

    overlay = el('div', { class: 'clip-mgr-overlay', onclick: (e) => {
      if (e.target === overlay) close();
    } });

    const search = el('input', {
      class: 'input',
      type: 'search',
      placeholder: '搜索内容…',
      value: state.query,
      style: 'flex:1;min-width:140px',
    });
    search.addEventListener('input', (e) => {
      state.query = e.target.value || '';
      paint();
    });

    const tabInbox = el('button', {
      class: 'btn sm' + (state.tab === 'inbox' ? ' primary' : ''),
      text: '待归档',
      onclick: async () => {
        state.tab = 'inbox';
        state.selected = new Set();
        await renderChrome();
        await paint();
      },
    });
    const tabClips = el('button', {
      class: 'btn sm' + (state.tab === 'clips' ? ' primary' : ''),
      text: '已收藏',
      onclick: async () => {
        state.tab = 'clips';
        state.selected = new Set();
        await renderChrome();
        await paint();
      },
    });

    const stats = el('span', { class: 'muted', text: '' });
    const bulkHost = el('div');
    const body = el('div', { class: 'clip-mgr-body' });

    async function renderChrome() {
      bulkHost.innerHTML = '';
      bulkHost.appendChild(bulkBar());
    }

    overlay.appendChild(
      el('div', { class: 'clip-mgr-panel' }, [
        el('div', { class: 'clip-mgr-head' }, [
          el('h3', { text: '剪贴板' }),
          stats,
          el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, [tabInbox, tabClips]),
          search,
          el('button', { class: 'btn sm ghost', text: '关闭', onclick: close }),
        ]),
        bulkHost,
        body,
      ])
    );

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onEsc);
    renderChrome().then(paint);
    search.focus();
  }

  global.ClipManager = { open, close, copyText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
