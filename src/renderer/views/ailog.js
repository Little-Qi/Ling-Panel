(function () {
  const { el, formatTime } = LingUtil;
  let sessions = [];
  let items = [];
  let sid = '';
  let role = 'q';
  let pending = null;

  function getSessionId() {
    return sid;
  }

  function setPending(p) {
    pending = p || null;
  }

  function clearPending() {
    pending = null;
    const box = document.getElementById('aiPending');
    if (box) box.innerHTML = '';
  }

  /** Markdown 正文：长文折叠 */
  function mdBody(text) {
    const html = LingMarkdown.renderMarkdown(text);
    const raw = String(text || '');
    const long = raw.length > 280 || raw.split('\n').length > 12;
    const wrap = el('div', { class: 'ai-md-wrap' + (long ? ' collapsed' : '') }, [
      el('div', { class: 'md-preview ai-md', html }),
    ]);
    if (long) {
      const btn = el('button', {
        class: 'btn sm ghost ai-md-toggle',
        text: '展开',
        onclick: (e) => {
          e.stopPropagation();
          const collapsed = wrap.classList.toggle('collapsed');
          btn.textContent = collapsed ? '展开' : '收起';
        },
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  async function ensureSession(titleHint) {
    if (sid) return sid;
    const t = String(titleHint || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '新会话';
    const s = await window.ling.ai.createSession(t);
    sid = s.id;
    return sid;
  }

  async function savePending(roleToSave) {
    if (!pending || !pending.text) return;
    const text = pending.text;
    const sessionId = await ensureSession(text);
    await window.ling.ai.add({
      sessionId,
      role: roleToSave,
      content: text,
      source: 'clipboard',
      autoTitle: true,
    });
    pending = null;
    role = (await window.ling.ai.suggestRole(sessionId)) || 'q';
    await App.refreshCurrent();
    await App.refreshBadge();
  }

  /** 行内小输入（Electron 的 prompt() 不可用） */
  function inlinePrompt({ label, value = '', placeholder = '', submitText = '确定', onSubmit }) {
    const input = el('input', {
      class: 'input',
      value,
      placeholder,
      style: 'flex:1;min-width:120px',
    });
    const row = el('div', { class: 'row', style: 'gap:6px;margin:6px 0;flex-wrap:wrap' }, [
      el('span', { class: 'muted', text: label }),
      input,
      el('button', {
        class: 'btn sm primary',
        text: submitText,
        onclick: async () => {
          const v = input.value.trim();
          await onSubmit(v);
        },
      }),
      el('button', {
        class: 'btn sm ghost',
        text: '取消',
        onclick: () => row.remove(),
      }),
    ]);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit(input.value.trim());
      }
      if (e.key === 'Escape') row.remove();
    });
    return row;
  }

  async function render(root) {
    root.innerHTML = '';
    root.className = 'view ime-safe';
    sessions = await window.ling.ai.sessions();
    if (sid && !sessions.find((s) => s.id === sid)) sid = '';
    if (!sid && sessions[0]) sid = sessions[0].id;
    items = await window.ling.ai.items(sid || undefined);
    if (sid) {
      try {
        role = (await window.ling.ai.suggestRole(sid)) || 'q';
      } catch (_) {}
    }

    // —— 左栏：会话（可搜索） ——
    const sideHost = el('div', { id: 'aiSideHost' });
    function paintSide(slot) {
      const box = slot || sideHost;
      box.innerHTML = '';

      let query = '';
      const searchInput = el('input', {
        class: 'input',
        type: 'search',
        placeholder: '搜索会话…',
        style: 'margin-bottom:8px',
      });

      const list = el('div', { class: 'ai-session-list' });
      const count = el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px' });

      function matches(s, q) {
        if (!q) return true;
        const t = String(s.title || '').toLowerCase();
        return t.includes(q);
      }

      function paintList() {
        list.innerHTML = '';
        const q = query.trim().toLowerCase();
        const shown = sessions.filter((s) => matches(s, q));
        // 会话很多时：默认只画前 80 条，搜索后再全量过滤结果
        const limited = !q && shown.length > 80 ? shown.slice(0, 80) : shown;
        if (!shown.length) {
          list.appendChild(
            el('div', {
              class: 'muted',
              style: 'padding:8px',
              text: sessions.length ? '没有匹配的会话' : '还没有会话',
            })
          );
        }
        for (const s of limited) {
          list.appendChild(
            el('button', {
              class: 'ai-session-item' + (s.id === sid ? ' active' : ''),
              text: s.title || '未命名',
              title: s.title || '',
              onclick: async () => {
                sid = s.id;
                await App.refreshCurrent();
              },
            })
          );
        }
        count.textContent = sessions.length
          ? q
            ? `${shown.length} / ${sessions.length} 个会话`
            : shown.length > 80
              ? `共 ${shown.length} 个，显示最近 80 · 可搜索`
              : `共 ${shown.length} 个会话`
          : '';
      }

      searchInput.addEventListener('input', (e) => {
        query = e.target.value || '';
        paintList();
      });

      paintList();

      const actions = el('div', { class: 'col', style: 'gap:6px' }, [
        el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, [
          el('button', {
            class: 'btn sm primary',
            text: '新建会话',
            onclick: async () => {
              const host = document.getElementById('aiSideHost');
              if (!host) return;
              host.insertBefore(
                inlinePrompt({
                  label: '名称',
                  value: '新会话',
                  submitText: '创建',
                  onSubmit: async (v) => {
                    sid = (await window.ling.ai.createSession(v || '新会话')).id;
                    await App.refreshCurrent();
                  },
                }),
                host.firstChild
              );
              const input = host.querySelector('input.input');
              if (input) {
                input.focus();
                input.select();
              }
            },
          }),
          el('button', {
            class: 'btn sm',
            text: '重命名',
            onclick: async () => {
              if (!sid) return;
              const cur = sessions.find((s) => s.id === sid);
              const host = document.getElementById('aiSideHost');
              if (!host) return;
              host.insertBefore(
                inlinePrompt({
                  label: '新名称',
                  value: (cur && cur.title) || '',
                  submitText: '保存',
                  onSubmit: async (v) => {
                    await window.ling.ai.renameSession(sid, v || (cur && cur.title) || '');
                    await App.refreshCurrent();
                  },
                }),
                host.firstChild
              );
              const input = host.querySelector('input.input');
              if (input) {
                input.focus();
                input.select();
              }
            },
          }),
        ]),
        el('button', {
          class: 'btn sm danger',
          text: '删除会话',
          onclick: async () => {
            if (!sid) return;
            // confirm 在部分环境也不可用时兜底直接删
            const ok = typeof confirm === 'function' ? confirm('删除该会话及其全部记录？') : true;
            if (!ok) return;
            await window.ling.ai.removeSession(sid);
            sid = '';
            await App.refreshCurrent();
          },
        }),
      ]);

      box.append(
        el('div', { class: 'card' }, [
          el('h3', { text: '会话' }),
          searchInput,
          list,
          count,
          el('div', { style: 'margin-top:8px' }, actions),
        ])
      );
    }

    // —— 剪贴板待归档 ——
    const box = el('div', { id: 'aiPending' });
    function paintPending() {
      box.innerHTML = '';
      if (!pending) return;
      const fullPending = String(pending.text || '');
      box.appendChild(
        el('div', { class: 'card', style: 'margin-bottom:10px' }, [
          el('h3', { text: '刚复制的，要放进会话吗' }),
          el('div', { class: 'muted', style: 'margin-bottom:6px' }, mdBody(fullPending)),
          el('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;align-items:center' }, [
            el('button', {
              class: 'btn sm' + (role === 'q' ? ' primary' : ''),
              text: '存为提问',
              onclick: () => savePending('q'),
            }),
            el('button', {
              class: 'btn sm' + (role === 'a' ? ' primary' : ''),
              text: '存为回答',
              onclick: () => savePending('a'),
            }),
            el('button', {
              class: 'btn sm ghost',
              text: '忽略',
              onclick: () => {
                pending = null;
                paintPending();
              },
            }),
          ]),
        ])
      );
    }

    // —— 右栏：时间线（可拖拽排序） ——
    const list = el('div', { class: 'list ai-timeline' });
    if (!items.length) {
      list.appendChild(el('div', { class: 'empty', text: '复制一段对话，或在下面写一句。' }));
    }

    let dragId = '';
    function bindDnd(row, id) {
      const handle = row.querySelector('.ai-drag');
      if (!handle) return;
      handle.addEventListener('mousedown', () => {
        row.draggable = true;
      });
      handle.addEventListener('mouseup', () => {
        row.draggable = false;
      });
      row.addEventListener('dragstart', (e) => {
        dragId = id;
        row.classList.add('dragging');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', id);
        } catch (_) {}
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        row.draggable = false;
        dragId = '';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const fromId = dragId || e.dataTransfer.getData('text/plain');
        if (!fromId || fromId === id) return;
        const rows = [...list.querySelectorAll('[data-ai-id]')];
        const ids = rows.map((r) => r.dataset.aiId);
        const from = ids.indexOf(fromId);
        const to = ids.indexOf(id);
        if (from < 0 || to < 0) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        if (sid) await window.ling.ai.reorder(sid, ids);
        await App.refreshCurrent();
      });
    }

    for (const it of items) {
      const isQ = it.role === 'q';
      const row = el(
        'div',
        {
          class: 'item ai-row',
          'data-ai-id': it.id,
          style: 'align-items:flex-start;gap:8px',
        },
        [
          el('span', {
            class: 'ai-drag',
            title: '拖动排序',
            text: '⋮⋮',
          }),
          el('span', { class: 'chip ' + (isQ ? 'blue' : 'green'), text: isQ ? 'Q' : 'A' }),
          el('div', { class: 'col', style: 'flex:1;min-width:0;gap:4px' }, [
            mdBody(it.content),
            el('div', {
              class: 'item-sub',
              text: `${formatTime(it.createdAt)} · ${it.source === 'clipboard' ? '剪贴板' : '手动'}`,
            }),
          ]),
          el('div', { class: 'row', style: 'gap:4px;flex-shrink:0' }, [
            el('button', {
              class: 'btn sm ghost',
              title: '切换提问/回答',
              text: isQ ? '→A' : '→Q',
              onclick: async () => {
                await window.ling.ai.update(it.id, { role: isQ ? 'a' : 'q' });
                await App.refreshCurrent();
              },
            }),
            el('button', {
              class: 'btn sm ghost',
              text: '删',
              onclick: async () => {
                await window.ling.ai.remove(it.id);
                await App.refreshCurrent();
              },
            }),
          ]),
        ]
      );
      bindDnd(row, it.id);
      list.appendChild(row);
    }

    // 左栏「记一笔」跟在会话区下面，不贴底
    const ta = el('textarea', {
      class: 'textarea',
      style: 'min-height:72px',
      placeholder: '支持 Markdown…',
    });
    const roleRow = el('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }, [
      el('button', {
        class: 'btn sm' + (role === 'q' ? ' primary' : ''),
        text: '提问 Q',
        onclick: () => {
          role = 'q';
          App.refreshCurrent();
        },
      }),
      el('button', {
        class: 'btn sm' + (role === 'a' ? ' primary' : ''),
        text: '回答 A',
        onclick: () => {
          role = 'a';
          App.refreshCurrent();
        },
      }),
    ]);
    const manual = el('div', { class: 'card ai-composer' }, [
      el('h3', { text: '记一笔' }),
      roleRow,
      ta,
      el('div', { class: 'row', style: 'margin-top:8px;justify-content:space-between;flex-wrap:wrap;gap:6px' }, [
        el('button', {
          class: 'btn sm',
          text: '读剪贴板',
          onclick: async () => {
            const t = await window.ling.ai.clipboardText();
            if (t) {
              pending = { text: t };
              try {
                pending.paperRef = await window.ling.ai.detectPaperRef(t);
              } catch (_) {}
              paintPending();
            }
          },
        }),
        el('button', {
          class: 'btn primary',
          text: '保存',
          onclick: async () => {
            const text = ta.value.trim();
            if (!text) return;
            await ensureSession(text);
            await window.ling.ai.add({
              sessionId: sid,
              role,
              content: text,
              source: 'manual',
              autoTitle: true,
            });
            ta.value = '';
            role = (await window.ling.ai.suggestRole(sid)) || 'q';
            await App.refreshCurrent();
            await App.refreshBadge();
          },
        }),
      ]),
    ]);

    const side = el('div', { class: 'ai-side' }, [sideHost, manual]);
    paintSide(sideHost);
    const main = el('div', { class: 'ai-main' }, [box, list]);
    root.append(el('div', { class: 'ai-layout' }, [side, main]));
    paintPending();
  }

  window.AiLogView = {
    render,
    setPending,
    clearPending,
    getSessionId,
  };
})();
