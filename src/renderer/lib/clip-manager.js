/**
 * 剪贴板全量管理：搜索、多选、批量归档 / 复制 / 丢弃。
 * 挂在 window.ClipManager，首页「所有」与快捷入口打开。
 */
(function (global) {
  const { el, expandableText, formatTime } = LingUtil;

  let overlay = null;
  let paintVersion = 0;
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

  function readTab() {
    return window.ling.store.get(state.tab === 'inbox' ? 'clipInbox' : 'clips');
  }

  function matchItem(c, q) {
    if (!q) return true;
    return String(c.content || '').toLowerCase().includes(q.toLowerCase());
  }

  async function copySelected(section, ids) {
    const selected = new Set(ids);
    const picked = (await window.ling.store.get(section)).filter((item) => selected.has(item.id));
    const ok = await copyText(picked.map((item) => item.content).join('\n\n---\n\n'));
    return ok ? picked.length : 0;
  }

  /**
   * 选中数与 DOM 的唯一同步点。
   * state.selected 的每条变更路径（单条勾选 / 全选 / 清空选中 /
   * 批量操作后清空 / paint 时剔除失效 id）都必须经过这里，
   * 否则计数会和真实选中集不一致。
   */
  function syncCount() {
    const node = overlay && overlay.querySelector('.clip-mgr-bulk-count');
    if (node) node.textContent = `已选 ${state.selected.size}`;
  }

  function close() {
    paintVersion++;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    state.selected = new Set();
    document.removeEventListener('keydown', onEsc);
  }

  function onEsc(e) {
    if (e.key !== 'Escape') return;
    // 模态浮层要吃掉这次 Esc：keydown 由 document 冒泡到 window，
    // 若不拦截，window 上的面板监听器会在浮层已关之后才去判断状态，
    // 结果是「按 Esc 关浮层」被连带升级成「收起整个面板」。
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    close();
  }

  async function paint() {
    if (!overlay) return;
    const body = overlay.querySelector('.clip-mgr-body');
    const stats = overlay.querySelector('.clip-mgr-stats');
    if (!body) return;
    const version = ++paintVersion;
    const rows = await readTab();
    if (version !== paintVersion) return;
    body.innerHTML = '';
    const q = state.query.trim();
    const list = rows.filter((c) => matchItem(c, q));

    // 选中集里不在当前列表的先清掉
    const live = new Set(list.map((x) => x.id));
    for (const id of [...state.selected]) {
      if (!live.has(id)) state.selected.delete(id);
    }

    // 兜底同步：全选 / 清空选中 / 批量操作后都会走到这里
    syncCount();

    if (stats) {
      const total = rows.length;
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
            syncCount();
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
                    await window.ling.clip.process([c.id], 'clip');
                    await paint();
                    if (global.App) App.refreshCurrent();
                  },
                }),
                el('button', {
                  class: 'btn sm',
                  text: '笔记',
                  onclick: async () => {
                    await window.ling.clip.process([c.id], 'note');
                    await paint();
                    if (global.App) App.refreshCurrent();
                  },
                }),
                el('button', {
                  class: 'btn sm ghost',
                  text: '丢弃',
                  onclick: async () => {
                    await window.ling.clip.process([c.id], 'drop');
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
                    await window.ling.clip.process([c.id], 'deleteClip');
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
      try {
        const n = action === 'copy'
          ? await copySelected(state.tab === 'inbox' ? 'clipInbox' : 'clips', ids)
          : await window.ling.clip.process(ids, action === 'delete' ? 'deleteClip' : action);
        for (const id of ids) state.selected.delete(id);
        await paint();
        if (action !== 'copy' && global.App) App.refreshCurrent();
        window.ling.app.notify({ title: label, message: `${n} 条` });
      } catch (err) {
        window.ling.app.notify({ title: '处理失败，可重试', message: err.message });
      }
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
            const list = (await readTab()).filter((c) =>
              matchItem(c, state.query.trim())
            );
            state.selected = new Set(list.map((x) => x.id));
            await paint();
          },
        }),
        el('button', {
          class: 'btn sm ghost',
          text: '取消选择',
          title: '仅取消勾选，不会删除内容',
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

    const stats = el('span', { class: 'muted clip-mgr-stats', text: '' });
    const bulkHost = el('div');
    const body = el('div', { class: 'clip-mgr-body' });

    async function renderChrome() {
      tabInbox.classList.toggle('primary', state.tab === 'inbox');
      tabClips.classList.toggle('primary', state.tab === 'clips');
      bulkHost.innerHTML = '';
      bulkHost.appendChild(bulkBar());
      syncCount();
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

  /** 浮层是否已打开：供面板收起时清理，以及 Esc 分层处理使用 */
  function isOpen() {
    return !!overlay;
  }

  global.ClipManager = { open, close, copyText, isOpen };
})(typeof globalThis !== 'undefined' ? globalThis : this);
