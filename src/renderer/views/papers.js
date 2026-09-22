(function () {
  const { el } = LingUtil;

  let selected = new Set();
  let lastItems = [];
  let lastNon = [];
  let lastIgnored = [];
  let lastLib = [];
  let info = null;
  let activeSub = 'papers'; // papers | non | ignored | lib
  let scannedOnce = false;
  let scanning = false;

  function venueOptions(current, venues) {
    return venues.map((v) =>
      el('option', { value: v, text: v, selected: v === current ? 'selected' : null })
    );
  }

  function topicOptions(current, topics) {
    return topics.map((t) =>
      el('option', { value: t.id, text: t.label || t.id, selected: t.id === current ? 'selected' : null })
    );
  }

  function exportItem(x) {
    const card = document.querySelector(`[data-paper-id="${CSS.escape(x.id)}"]`);
    if (!card) return x;
    return {
      sourcePath: x.sourcePath,
      fingerprint: x.fingerprint,
      topic: card.querySelector('[data-field=topic]').value,
      year: card.querySelector('[data-field=year]').value,
      venue: card.querySelector('[data-field=venue]').value,
      model: card.querySelector('[data-field=model]').value,
      title: card.querySelector('[data-field=title]').value,
    };
  }

  /** 弱解析默认值：缺什么补什么（标题/年/来源/模型） */
  function applyPdfDefaults(card, hints) {
    if (!card || !hints) return;
    const map = [
      ['title', hints.title],
      ['year', hints.year && hints.year !== 'UnknownYear' ? hints.year : ''],
      ['venue', hints.venue],
      ['model', hints.model || ''],
    ];
    for (const [field, val] of map) {
      if (!val) continue;
      const input = card.querySelector(`[data-field=${field}]`);
      if (!input) continue;
      const cur = (input.value || '').trim();
      const weak =
        !cur ||
        cur === 'UnknownYear' ||
        cur === 'Unclassified Paper' ||
        cur === 'Other' ||
        cur === 'Unknown' ||
        cur.length < 3;
      if (weak || field === 'title') {
        if (field === 'title' && cur && !weak && cur !== 'Unclassified Paper') continue;
        input.value = val;
      }
    }
  }

  function itemCard(x) {
    const checked = selected.has(x.id);
    const hints = x._pdfHints || x._defaults || null;
    const hintNote = hints && (hints.title || (hints.year && hints.year !== 'UnknownYear') || hints.venue)
      ? `PDF 弱解析：${[hints.year && hints.year !== 'UnknownYear' ? hints.year : '', hints.venue || '', hints.title || ''].filter(Boolean).join(' · ')}`
      : 'PDF 弱解析：未读到元数据，已用文件名默认值';
    return el('div', {
      class: 'item paper-row',
      'data-paper-id': x.id,
      style: 'flex-direction:column;align-items:stretch;gap:10px;padding:12px 14px',
    }, [
      el('div', { class: 'row', style: 'gap:10px' }, [
        el('input', {
          type: 'checkbox',
          checked: checked ? 'checked' : null,
          onchange: (e) => {
            if (e.target.checked) selected.add(x.id);
            else selected.delete(x.id);
          },
        }),
        el('div', { class: 'col', style: 'flex:1;min-width:0;gap:2px' }, [
          el('div', {
            class: 'item-title',
            style: 'font-size:13px',
            text: x.fileName,
          }),
          el('div', {
            class: 'item-sub',
            text: `${x.year} · ${x.venue}${x.model ? ' · ' + x.model : ''} · ${x.sizeKb} KB${x.nonPaper ? ' · 疑似非论文' : ''}`,
          }),
        ]),
        el('button', { class: 'btn sm ghost', text: '位置', onclick: () => window.ling.paper.open(x.sourcePath) }),
        el('button', {
          class: 'btn sm ghost',
          text: '忽略',
          onclick: async () => {
            await window.ling.paper.ignore({
              sourcePath: x.sourcePath,
              fingerprint: x.fingerprint,
              fileName: x.fileName,
            });
            lastItems = lastItems.filter((i) => i.id !== x.id);
            lastNon = lastNon.filter((i) => i.id !== x.id);
            selected.delete(x.id);
            lastIgnored = await window.ling.paper.listIgnored();
            renderLists();
          },
        }),
      ]),
      el('div', { class: 'form-grid' }, [
        el('div', { class: 'field' }, [
          el('label', { text: '主题' }),
          el('select', { class: 'select', 'data-field': 'topic' }, topicOptions(x.topic, info.topics)),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '来源' }),
          el('select', { class: 'select', 'data-field': 'venue' }, venueOptions(x.venue, info.venues)),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '年份' }),
          el('input', { class: 'input', 'data-field': 'year', value: x.year }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '模型简称' }),
          el('input', { class: 'input', 'data-field': 'model', value: x.model || '' }),
        ]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '标题' }),
        el('input', { class: 'input', 'data-field': 'title', value: x.title, placeholder: '弱解析默认标题，可改' }),
      ]),
      el('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' }, [
        el('span', { class: 'muted', style: 'flex:1;min-width:160px;font-size:12px', text: hintNote }),
        el('button', {
          class: 'btn sm',
          text: '重新弱解析填默认',
          onclick: async () => {
            try {
              const h = await window.ling.paper.pdfHints(x.sourcePath);
              applyPdfDefaults(document.querySelector(`[data-paper-id="${CSS.escape(x.id)}"]`), h);
            } catch (_) {}
          },
        }),
      ]),
    ]);
  }

  let status;

  function renderLists(statusEl) {
    if (statusEl) status = statusEl;
    const host = document.getElementById('paperMain');
    if (!host) return;
    host.innerHTML = '';

    if (activeSub === 'papers' || activeSub === 'non') {
      const listData = activeSub === 'papers' ? lastItems : lastNon;
      if (!listData.length) {
        host.appendChild(
          el('div', {
            class: 'empty',
            text:
              activeSub === 'papers'
                ? '主列表为空。点「重新扫描」拉取下载目录（已归档/已忽略不会出现）'
                : '非论文 PDF 列表为空。判断不了是否论文的会在这里，可「忽略」或「归档」',
          })
        );
        return;
      }
      const list = el('div', { class: 'list' });
      for (const x of listData) list.appendChild(itemCard(x));
      host.appendChild(list);
      return;
    }

    if (activeSub === 'ignored') {
      if (!lastIgnored.length) {
        host.appendChild(el('div', { class: 'empty', text: '忽略列表为空。点条目上的「忽略」可加入。' }));
        return;
      }
      const list = el('div', { class: 'list' });
      for (const x of lastIgnored) {
        list.appendChild(
          el('div', { class: 'item' }, [
            el('div', { class: 'col', style: 'flex:1;min-width:0' }, [
              el('div', { class: 'item-title', text: x.fileName || x.sourcePath || x.fp }),
              el('div', { class: 'item-sub', text: `${x.reason || ''} · ${x.at || ''}` }),
            ]),
            el('button', {
              class: 'btn sm',
              text: '取消忽略',
              onclick: async () => {
                await window.ling.paper.unignore({
                  sourcePath: x.sourcePath,
                  fingerprint: x.fp,
                });
                lastIgnored = await window.ling.paper.listIgnored();
                renderLists();
              },
            }),
          ])
        );
      }
      host.appendChild(list);
      return;
    }

    // lib
    if (!lastLib.length) {
      host.appendChild(el('div', { class: 'empty', text: '点「刷新库」读取 D:\\paper' }));
      return;
    }
    const q = el('input', {
      class: 'input',
      style: 'margin-bottom:8px',
      placeholder: '按标题 / 文件名 / 主题过滤…',
      oninput: (e) => {
        const s = e.target.value.trim().toLowerCase();
        host.querySelectorAll('[data-lib-row]').forEach((node) => {
          const hay = node.getAttribute('data-hay') || '';
          node.style.display = !s || hay.includes(s) ? '' : 'none';
        });
      },
    });
    host.appendChild(q);
    const list = el('div', { class: 'list' });
    for (const x of lastLib.slice(0, 80)) {
      list.appendChild(
        el('div', {
          class: 'item',
          'data-lib-row': '1',
          'data-hay': `${x.fileName} ${x.title} ${x.topic} ${x.venue}`.toLowerCase(),
        }, [
          el('div', { class: 'col', style: 'flex:1;min-width:0' }, [
            el('div', { class: 'item-title', text: x.fileName }),
            el('div', {
              class: 'item-sub',
              text: `${x.topic} · ${x.year}_${x.venue}${x.model ? '_' + x.model : ''}`,
            }),
          ]),
          el('button', {
            class: 'btn sm',
            text: '打开位置',
            onclick: () => window.ling.paper.open(x.path),
          }),
        ])
      );
    }
    host.appendChild(list);
    if (lastLib.length > 80) {
      host.appendChild(
        el('div', { class: 'muted', style: 'margin-top:6px', text: `仅显示最近 80 条 / 共 ${lastLib.length}` })
      );
    }
  }

  async function renderPapers(root) {
    root.innerHTML = '';
    root.className = 'view ime-safe';

    info = await window.ling.paper.info();
    status = el('div', { class: 'muted', style: 'margin-bottom:8px' });
    status.textContent = `库：${info.root} · 下载：${info.downloads} · 不会自动反复扫描`;

    const subTabs = el('div', { class: 'subtabs' });
    const subs = [
      ['papers', '论文待归档'],
      ['non', '非论文'],
      ['ignored', '已忽略'],
      ['lib', '文献库'],
    ];
    function paintSubTabs() {
      subTabs.innerHTML = '';
      for (const [id, label] of subs) {
        subTabs.appendChild(
          el('button', {
            class: `btn sm${activeSub === id ? ' primary' : ''}`,
            text: id === 'papers' ? `${label} (${lastItems.length})` : id === 'non' ? `${label} (${lastNon.length})` : id === 'ignored' ? `${label} (${lastIgnored.length})` : label,
            onclick: () => {
              activeSub = id;
              paintSubTabs();
              renderLists();
            },
          })
        );
      }
    }

    async function doScan(force) {
      if (scanning) return;
      scanning = true;
      status.textContent = '扫描中（指纹缓存加速，首次较慢）…';
      try {
        const res = await window.ling.paper.scan();
        lastItems = res.items || [];
        lastNon = res.nonPapers || [];
        lastIgnored = await window.ling.paper.listIgnored();
        selected = new Set(lastItems.map((x) => x.id));
        scannedOnce = true;
        status.textContent = `论文 ${lastItems.length} · 非论文 ${lastNon.length} · 已隐藏归档 ${res.skippedCount || 0} · 已忽略 ${res.skippedIgnoredCount || 0}`;
        paintSubTabs();
        renderLists();
      } catch (err) {
        status.textContent = `扫描失败：${err.message || err}`;
      } finally {
        scanning = false;
      }
    }

    const bar = el('div', { class: 'toolbar' }, [
      el('button', { class: 'btn primary', text: '重新扫描下载', onclick: () => doScan(true) }),
      el('button', {
        class: 'btn',
        text: '全选当前页',
        onclick: () => {
          const list = activeSub === 'non' ? lastNon : lastItems;
          selected = new Set(list.map((x) => x.id));
          renderLists();
        },
      }),
      el('button', {
        class: 'btn',
        text: '清空选择',
        onclick: () => {
          selected = new Set();
          renderLists();
        },
      }),
      el('button', {
        class: 'btn primary',
        text: '归档所选',
        onclick: async () => {
          const pool = activeSub === 'non' ? lastNon : lastItems;
          const list = pool.filter((x) => selected.has(x.id)).map(exportItem);
          if (!list.length) {
            status.textContent = '请先勾选要归档的 PDF';
            return;
          }
          status.textContent = `归档中 ${list.length} 份…`;
          const results = await window.ling.paper.archiveMany(list);
          const ok = results.filter((r) => r.ok).length;
          const fail = results.length - ok;
          const ids = new Set(list.map((x) => x.sourcePath));
          lastItems = lastItems.filter((x) => !ids.has(x.sourcePath));
          lastNon = lastNon.filter((x) => !ids.has(x.sourcePath));
          selected = new Set();
          lastLib = await window.ling.paper.list();
          status.textContent = `完成：成功 ${ok} · 失败 ${fail}（重复/忽略会失败并提示）`;
          paintSubTabs();
          renderLists();
        },
      }),
      el('button', {
        class: 'btn',
        text: '忽略所选',
        onclick: async () => {
          const pool = activeSub === 'non' ? [...lastNon] : [...lastItems, ...lastNon];
          const list = pool.filter((x) => selected.has(x.id));
          for (const x of list) {
            await window.ling.paper.ignore({
              sourcePath: x.sourcePath,
              fingerprint: x.fingerprint,
              fileName: x.fileName,
            });
          }
          lastItems = lastItems.filter((x) => !selected.has(x.id));
          lastNon = lastNon.filter((x) => !selected.has(x.id));
          selected = new Set();
          lastIgnored = await window.ling.paper.listIgnored();
          status.textContent = `已忽略 ${list.length} 份，之后扫描不再显示`;
          paintSubTabs();
          renderLists();
        },
      }),
      el('button', {
        class: 'btn',
        text: '刷新库',
        onclick: async () => {
          lastLib = await window.ling.paper.list();
          status.textContent = `库内 ${lastLib.length} 份`;
          paintSubTabs();
          renderLists();
        },
      }),
    ]);

    const main = el('div', { class: 'card' }, [
      el('h3', { text: '下载目录整理' }),
      el('div', { id: 'paperMain' }),
    ]);

    root.append(status, subTabs, bar, main);
    paintSubTabs();

    // 只在进入本页且未扫过时自动扫一次，避免反复 IO
    if (!scannedOnce) {
      await doScan(false);
    } else {
      renderLists();
      status.textContent = `论文 ${lastItems.length} · 非论文 ${lastNon.length} · 已忽略 ${lastIgnored.length}（点「重新扫描」刷新）`;
    }
  }

  window.PapersView = { render: renderPapers };
})();
