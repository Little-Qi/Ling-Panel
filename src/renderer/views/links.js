(function () {
  const { el } = LingUtil;

  async function renderLinks(root) {
    const pages = Object.create(null);
    root.innerHTML = '';
    root.className = 'view ime-safe';

    const urlInput = el('input', { class: 'input', style: 'flex:1;min-width:180px', placeholder: 'https://' });
    const titleInput = el('input', { class: 'input', style: 'width:160px', placeholder: '标题（可选）' });
    const groupInput = el('input', { class: 'input', style: 'width:100px', placeholder: '分组', value: '默认' });

    const toolbar = el('div', { class: 'toolbar' }, [
      urlInput,
      titleInput,
      groupInput,
      el('button', {
        class: 'btn primary',
        text: '保存链接',
        onclick: async () => {
          try {
            await window.ling.link.create({
              url: urlInput.value.trim(),
              title: titleInput.value.trim(),
              group: groupInput.value.trim() || '默认',
            });
            urlInput.value = '';
            titleInput.value = '';
            await App.refreshCurrent();
          } catch (err) {
            window.ling.app.notify({ title: '保存失败', message: String(err.message || err) });
          }
        },
      }),
    ]);

    const wrap = el('div', { class: 'col', style: 'gap:12px' });
    let request = 0;
    async function paintGroups() {
      const version = ++request;
      const groups = await window.ling.link.groups(pages);
      if (request !== version) return;
      wrap.innerHTML = '';
      if (!groups.length) {
        wrap.appendChild(el('div', { class: 'empty', text: '还没有链接。保存公开网址，后台会补全标题。' }));
      }

      for (const { name: group, items, total, page, pageCount } of groups) {
        const card = el('div', { class: 'card' }, [
          el('h3', {}, [
            el('span', { text: group }),
            el('span', { class: 'muted', text: String(total) }),
          ]),
        ]);
        const list = el('div', { class: 'list' });
        for (const l of items) {
          list.appendChild(
            el('div', { class: 'item' }, [
              el('div', { class: 'col', style: 'flex:1;min-width:0' }, [
                el('div', { class: 'item-title', text: l.title || l.url }),
                el('div', { class: 'item-sub', text: l.url }),
              ]),
              el('button', {
                class: 'btn sm',
                text: '打开',
                onclick: () => window.open(l.url, '_blank'),
              }),
              el('button', {
                class: 'btn sm',
                text: '复制',
                onclick: async () => {
                  try {
                    await navigator.clipboard.writeText(l.url);
                    window.ling.app.notify({ title: '已复制链接', message: l.url });
                  } catch {
                    window.ling.app.notify({ title: '复制失败', message: l.url });
                  }
                },
              }),
              el('button', {
                class: 'btn sm danger',
                text: '删',
                onclick: async () => {
                  await window.ling.link.remove(l.id);
                  await App.refreshCurrent();
                },
              }),
            ])
          );
        }
        card.appendChild(list);
        if (pageCount > 1) card.appendChild(LingUtil.pager(page, pageCount, (p) => {
          pages[group] = p;
          return paintGroups();
        }));
        wrap.appendChild(card);
      }
    }
    await paintGroups();
    root.append(toolbar, wrap);
  }

  window.LinksView = { render: renderLinks };
})();
