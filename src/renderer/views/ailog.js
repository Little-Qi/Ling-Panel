(function () {
  const { el, formatTime, expandableText } = LingUtil;
  let sessions = [];
  let items = [];
  let sid = '';
  let role = 'q';
  let pending = null;
  let renameId = '';

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

    const head = el('div', {
      class: 'muted',
      style: 'margin-bottom:8px',
      text: '这里只记大模型 Q/A。普通复制请用弹层里的「片段 / 笔记 / 链接 / 待办」；只有要进 AI 会话时才点「AI 会话」并标 Q/A。',
    });

    // —— 剪贴板待归档 ——
    const box = el('div', { id: 'aiPending' });
    function paintPending() {
      box.innerHTML = '';
      if (!pending) return;
      const fullPending = String(pending.text || '');
      box.appendChild(
        el('div', { class: 'card', style: 'margin-bottom:10px' }, [
          el('h3', { text: '剪贴板 → 仅当归入 AI 会话时用这里' }),
          expandableText(fullPending, { limit: 100 }),
          el('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;align-items:center' }, [
            el('span', { class: 'muted', text: '归入会话' }),
            el(
              'select',
              {
                class: 'select',
                style: 'width:180px',
                onchange: (e) => {
                  sid = e.target.value;
                },
              },
              sessions.length
                ? sessions.map((s) =>
                    el('option', {
                      value: s.id,
                      text: s.title,
                      selected: s.id === sid ? 'selected' : null,
                    })
                  )
                : [el('option', { value: '', text: '（新建会话）' })]
            ),
            el('button', {
              class: 'btn sm' + (role === 'q' ? ' primary' : ''),
              text: '存为 Q（提问）',
              onclick: () => savePending('q'),
            }),
            el('button', {
              class: 'btn sm' + (role === 'a' ? ' primary' : ''),
              text: '存为 A（回答）',
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
          pending.paperRef && pending.paperRef.isPaperRef
            ? el('div', {
                class: 'muted',
                style: 'margin-top:6px',
                text: `识别到论文引用：${pending.paperRef.arxivId || pending.paperRef.doi || ''}`,
              })
            : null,
        ])
      );
    }

    // —— 会话栏 ——
    const sel = el(
      'select',
      {
        class: 'select',
        style: 'width:200px',
        onchange: async (e) => {
          sid = e.target.value;
          await App.refreshCurrent();
        },
      },
      sessions.length
        ? sessions.map((s) =>
            el('option', { value: s.id, text: s.title, selected: s.id === sid ? 'selected' : null })
          )
        : [el('option', { value: '', text: '（暂无会话）' })]
    );

    const bar = el('div', { class: 'toolbar' }, [
      el('span', { class: 'muted', text: '会话' }),
      sel,
      el('button', {
        class: 'btn sm',
        text: '新建',
        onclick: async () => {
          const n = prompt('会话名称', '新会话');
          if (n == null) return;
          sid = (await window.ling.ai.createSession(n || '新会话')).id;
          await App.refreshCurrent();
        },
      }),
      el('button', {
        class: 'btn sm',
        text: '重命名',
        onclick: async () => {
          if (!sid) return;
          const cur = sessions.find((s) => s.id === sid);
          const n = prompt('新名称', (cur && cur.title) || '');
          if (n == null) return;
          await window.ling.ai.renameSession(sid, n || (cur && cur.title) || '');
          await App.refreshCurrent();
        },
      }),
      el('button', {
        class: 'btn sm danger',
        text: '删除会话',
        onclick: async () => {
          if (!sid || !confirm('删除该会话及其全部 Q/A？')) return;
          await window.ling.ai.removeSession(sid);
          sid = '';
          await App.refreshCurrent();
        },
      }),
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
    ]);

    // —— Q/A 时间线 ——
    const list = el('div', { class: 'list', style: 'margin-top:12px' });
    if (!items.length) {
      list.appendChild(el('div', { class: 'empty', text: '还没有 Q/A。复制内容或手动输入开始记录。' }));
    }
    for (const it of items.slice().reverse()) {
      const isQ = it.role === 'q';
      list.appendChild(
        el('div', { class: 'item', style: 'align-items:flex-start' }, [
          el('span', { class: 'chip ' + (isQ ? 'blue' : 'green'), text: isQ ? 'Q' : 'A' }),
          el('div', { class: 'col', style: 'flex:1;min-width:0' }, [
            expandableText(it.content, { limit: 140, class: 'expandable-text item-title' }),
            el('div', {
              class: 'item-sub',
              text: `${formatTime(it.createdAt)} · ${it.source === 'clipboard' ? '剪贴板' : '手动'}`,
            }),
          ]),
          el('button', {
            class: 'btn sm ghost',
            title: '切换 Q/A',
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
        ])
      );
    }

    // —— 手动录入 ——
    const ta = el('textarea', {
      class: 'textarea',
      style: 'min-height:100px',
      placeholder: '手动粘贴或输入一段与大模型的交互…',
    });
    const roleRow = el('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }, [
      el('button', {
        class: 'btn sm' + (role === 'q' ? ' primary' : ''),
        text: 'Q 提问',
        onclick: () => {
          role = 'q';
          App.refreshCurrent();
        },
      }),
      el('button', {
        class: 'btn sm' + (role === 'a' ? ' primary' : ''),
        text: 'A 回答',
        onclick: () => {
          role = 'a';
          App.refreshCurrent();
        },
      }),
    ]);
    const manual = el('div', { class: 'card', style: 'margin-top:12px' }, [
      el('h3', { text: '手动记录' }),
      roleRow,
      ta,
      el('div', { class: 'row', style: 'margin-top:8px' }, [
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

    root.append(head, box, bar, list, manual);
    paintPending();
  }

  window.AiLogView = {
    render,
    setPending,
    clearPending,
    getSessionId,
  };
})();
