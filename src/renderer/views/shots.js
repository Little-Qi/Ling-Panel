/**
 * 截图收件箱 — 横向「晾衣绳」展示
 *
 * 截图来自用户指定的目录（默认 Snipaste 的 Auto Save 目录），
 * 扫描后按时间倒序挂在一条绳子上，像晾衣服一样横向排开。
 * 每张图可以：存进笔记 / 复制到剪贴板 / 用看图程序打开 / 移除。
 */
(function () {
  const { el } = LingUtil;

  let selectedId = null;

  function fileUrl(p) {
    const s = String(p || '').replace(/\\/g, '/');
    return 'file:///' + s.replace(/^\/+/, '');
  }

  function fmtShotTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 选一张截图后的操作条 */
  function actionBar(shot, onDone) {
    if (!shot) {
      return el('div', { class: 'muted', style: 'padding:10px 2px', text: '点一张截图查看操作' });
    }
    return el('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' }, [
      el('span', { class: 'shot-picked-name', text: shot.name }),
      el('span', { class: 'muted', text: fmtShotTime(shot.at) }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn sm primary',
        text: '存进笔记',
        onclick: () => pickNote(shot, onDone),
      }),
      el('button', {
        class: 'btn sm',
        text: '复制图片',
        onclick: async () => {
          const r = await window.ling.shot.copy(shot.path);
          window.ling.app.notify({
            title: r && r.ok ? '已复制到剪贴板' : '复制失败',
            message: (r && r.error) || shot.name,
          });
        },
      }),
      el('button', {
        class: 'btn sm',
        text: '打开',
        onclick: () => window.ling.shot.open(shot.path),
      }),
      el('button', {
        class: 'btn sm ghost',
        text: '定位文件',
        onclick: () => window.ling.shot.reveal(shot.path),
      }),
      el('button', {
        class: 'btn sm danger',
        text: '删除文件',
        onclick: async () => {
          if (!confirm(`删除 ${shot.name}？源文件会被永久删除。`)) return;
          const r = await window.ling.shot.remove({ id: shot.id, deleteFile: true });
          if (r && r.ok) {
            selectedId = null;
            await onDone();
          }
        },
      }),
    ]);
  }

  /** 选一篇笔记把截图塞进去 */
  async function pickNote(shot, onDone) {
    const { items: notes } = await window.ling.note.page({ limit: Infinity });
    let targetId = null;
    let createNew = false;

    const sel = el('select', { class: 'select', style: 'flex:1;min-width:160px' }, [
      el('option', { value: '__new__', text: '＋ 新建一篇笔记' }),
      ...notes.map((n) => el('option', { value: n.id, text: n.title || '未命名笔记' })),
    ]);
    sel.addEventListener('change', () => {
      createNew = sel.value === '__new__';
      targetId = createNew ? null : sel.value;
    });

    const overlay = el('div', {
      class: 'shot-picker-overlay',
      onclick: (e) => {
        if (e.target === overlay) overlay.remove();
      },
    }, [
      el('div', { class: 'shot-picker-panel' }, [
        el('h3', { text: '把截图存进哪篇笔记？' }),
        el('div', { class: 'muted', style: 'margin-bottom:10px', text: shot.name }),
        el('div', { class: 'row', style: 'gap:8px;margin-bottom:14px' }, [sel]),
        el('div', { class: 'row', style: 'gap:8px;justify-content:flex-end' }, [
          el('button', { class: 'btn sm ghost', text: '取消', onclick: () => overlay.remove() }),
          el('button', {
            class: 'btn sm primary',
            text: '存入',
            onclick: async () => {
              overlay.remove();
              await attachToNote(shot, targetId, createNew, onDone);
            },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(overlay);
    const first = notes[0];
    if (first) {
      sel.value = first.id;
      targetId = first.id;
      createNew = false;
    }
  }

  async function attachToNote(shot, targetId, createNew, onDone) {
    const asset = await window.ling.shot.toNoteAsset(shot.path);
    if (!asset || !asset.ok) {
      window.ling.app.notify({ title: '存入失败', message: (asset && asset.error) || '' });
      return;
    }
    const line = `\n\n![${shot.name}](${asset.url})\n`;
    if (createNew || !targetId) {
      const note = await window.ling.note.create({
        title: shot.name.replace(/\.[^.]+$/, ''),
        content: `# ${shot.name.replace(/\.[^.]+$/, '')}\n${line}`,
      });
      window.ling.app.notify({ title: '已新建笔记', message: note.title });
    } else {
      const n = await window.ling.note.get(targetId);
      if (!n) {
        window.ling.app.notify({ title: '存入失败', message: '找不到目标笔记' });
        return;
      }
      await window.ling.note.update(targetId, { content: (n.content || '') + line });
      window.ling.app.notify({ title: '已存入笔记', message: n.title });
    }
    await onDone();
  }

  async function renderShots(root) {
    root.innerHTML = '';
    root.className = 'view ime-safe';

    const [info, shots] = await Promise.all([
      window.ling.shot.info().catch(() => null),
      window.ling.shot.list().catch(() => []),
    ]);

    const dir = (info && info.dir) || '';
    const list = (shots || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    if (selectedId && !list.some((s) => s.id === selectedId)) selectedId = null;

    const strip = el('div', { class: 'shot-strip' });
    const actions = el('div', { class: 'shot-actions' });
    let activeCard;
    function showActions(shot) {
      actions.innerHTML = '';
      actions.appendChild(actionBar(shot, () => renderShots(root)));
    }
    const line = el('div', { class: 'shot-rope' });

    if (!list.length) {
      strip.appendChild(
        el('div', { class: 'muted', style: 'padding:28px 10px', text: '还没有截图。点「扫描截图」把目录里的图片收进来。' })
      );
    } else {
      for (const s of list) {
        const selected = s.id === selectedId;
        const card = el(
          'div',
          {
            class: 'shot-card' + (selected ? ' is-selected' : ''),
            title: `${s.name}\n${fmtShotTime(s.at)}`,
            onclick: () => {
              const select = selectedId !== s.id;
              activeCard?.classList.remove('is-selected');
              selectedId = select ? s.id : null;
              activeCard = select ? card : null;
              activeCard?.classList.add('is-selected');
              showActions(select ? s : null);
            },
          },
          [
            el('div', { class: 'shot-clip' }),
            el('img', { class: 'shot-thumb', src: fileUrl(s.path), draggable: 'false', loading: 'lazy', alt: s.name }),
            el('div', { class: 'shot-meta', text: fmtShotTime(s.at) }),
          ]
        );
        if (selected) activeCard = card;
        strip.appendChild(card);
      }
    }

    const refresh = async () => {
      await renderShots(root);
    };

    // 晾衣绳没有系统滚动条：按住拖拽平移，滚轮横向滚动
    function bindPan(el) {
      let moved = false;
      let sx = 0;
      let sl = 0;
      let pointer = null;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || pointer !== null) return;
        pointer = e.pointerId;
        e.target.setPointerCapture(pointer);
        moved = false;
        sx = e.clientX;
        sl = el.scrollLeft;
        el.classList.add('is-dragging');
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId !== pointer) return;
        const dx = e.clientX - sx;
        if (Math.abs(dx) > 3) moved = true;
        if (moved) el.scrollLeft = sl - dx;
      });
      el.addEventListener('lostpointercapture', (e) => {
        if (e.pointerId !== pointer) return;
        pointer = null;
        el.classList.remove('is-dragging');
      });
      el.addEventListener(
        'wheel',
        (e) => {
          // 纵向滚轮 → 横向移动（Shift 或纯纵向都接管）
          if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        },
        { passive: false }
      );
      el.addEventListener('click', (e) => {
        if (moved && e.detail !== 0) {
          e.stopPropagation();
          e.preventDefault();
        }
      }, true);
    }

    const toolbar = el('div', { class: 'toolbar' }, [
      el('button', {
        class: 'btn primary',
        text: '扫描截图',
        onclick: async () => {
          const r = await window.ling.shot.scan();
          if (!r || !r.ok) {
            window.ling.app.notify({ title: '扫描失败', message: (r && r.error) || '' });
            return;
          }
          if (!r.items.length) {
            window.ling.app.notify({ title: '没有新截图', message: dir });
            return;
          }
          const ing = await window.ling.shot.ingest(r.items);
          window.ling.app.notify({
            title: `收进 ${ing.added} 张截图`,
            message: dir,
          });
          selectedId = null;
          await refresh();
        },
      }),
      el('button', {
        class: 'btn',
        text: '打开目录',
        onclick: () => window.ling.shot.reveal(dir),
      }),
      el('span', { class: 'muted', style: 'flex:1;min-width:0', text: dir, title: dir }),
      el('span', { class: 'muted', text: `${list.length} 张` }),
      el('button', {
        class: 'btn sm ghost',
        text: '清空收件箱',
        onclick: async () => {
          if (!list.length) return;
          if (!confirm('从收件箱移除全部截图？（不会删除源文件）')) return;
          await window.ling.shot.clear();
          selectedId = null;
          await refresh();
        },
      }),
    ]);

    showActions(list.find((s) => s.id === selectedId));

    root.append(
      toolbar,
      el('div', { class: 'shot-clothesline' }, [line, strip]),
      actions
    );

    bindPan(strip);
  }

  window.ShotsView = { render: renderShots };
})();
