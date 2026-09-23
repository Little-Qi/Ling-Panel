(function () {
  const { el } = LingUtil;

  const THEMES = [
    { id: 'aurora', color: '#6C8CFF', name: '极光夜' },
    { id: 'dawn', color: '#F5E6D3', name: '晨光' },
    { id: 'mint', color: '#2DD4BF', name: '薄荷' },
  ];

  const DOCKS = [
    ['top-center', '顶部居中'],
    ['top-left', '顶部左侧'],
    ['top-right', '顶部右侧'],
    ['left-edge', '左侧停靠'],
    ['right-edge', '右侧停靠'],
    ['float-center', '屏幕中央'],
  ];

  async function renderSettings(root) {
    const settings = await window.ling.store.get('settings');
    const version = await window.ling.app.version();

    root.innerHTML = '';
    root.className = 'view ime-safe';

    function switchRow(label, desc, value, onChange) {
      const sw = el('div', { class: `switch${value ? ' on' : ''}` });
      const row = el('div', { class: 'switch-row' }, [
        el('div', { class: 'col', style: 'gap:2px' }, [
          el('div', { style: 'font-size:13px;font-weight:600', text: label }),
          el('div', { class: 'muted', text: desc }),
        ]),
        sw,
      ]);
      row.addEventListener('click', async () => {
        const next = !sw.classList.contains('on');
        sw.classList.toggle('on', next);
        await onChange(next);
      });
      return row;
    }

    async function saveSettings(patch) {
      const next = { ...settings, ...patch };
      Object.assign(settings, next);
      await window.ling.store.set('settings', next);
      App.applyTheme(next.theme);
    }

    const appearance = el('div', { class: 'card' }, [
      el('h3', { text: '外观与动效' }),
      el('div', { class: 'field', style: 'margin-bottom:12px' }, [
        el('label', { text: '主题' }),
        el(
          'div',
          { class: 'swatches' },
          THEMES.map((t) =>
            el('button', {
              class: `swatch${settings.theme === t.id ? ' active' : ''}`,
              style: `background:${t.color}`,
              title: t.name,
              onclick: async () => {
                await saveSettings({ theme: t.id });
                await App.refreshCurrent();
              },
            })
          )
        ),
      ]),
      el('div', { class: 'field', style: 'margin-bottom:12px' }, [
        el('label', { text: '停靠位置' }),
        el(
          'select',
          {
            class: 'select',
            onchange: async (e) => saveSettings({ dock: e.target.value }),
          },
          DOCKS.map(([id, name]) =>
            el('option', {
              value: id,
              text: name,
              selected: settings.dock === id ? 'selected' : null,
            })
          )
        ),
      ]),
      el('div', { class: 'field', style: 'margin-bottom:12px' }, [
        el('label', { text: '显示在哪块屏幕' }),
        el('select', {
          class: 'select',
          id: 'dockDisplaySelect',
          onchange: async (e) => {
            const id = Number(e.target.value);
            await saveSettings({ dockDisplayId: Number.isFinite(id) ? id : null });
          },
        }),
      ]),
      el('div', { class: 'form-grid' }, [
        el('div', { class: 'field' }, [
          el('label', { text: '小条宽度' }),
          el('input', {
            class: 'input',
            type: 'number',
            min: '140',
            max: '260',
            value: String(settings.compactWidth || 200),
            onchange: (e) => saveSettings({ compactWidth: Number(e.target.value) || 200 }),
          }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '小条高度' }),
          el('input', {
            class: 'input',
            type: 'number',
            min: '28',
            max: '44',
            value: String(settings.compactHeight || 36),
            onchange: (e) => saveSettings({ compactHeight: Number(e.target.value) || 36 }),
          }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '竖放时宽度' }),
          el('input', {
            class: 'input',
            type: 'number',
            min: '32',
            max: '64',
            value: String(settings.compactVerticalWidth || 44),
            onchange: (e) => saveSettings({ compactVerticalWidth: Number(e.target.value) || 44 }),
          }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '竖放时高度' }),
          el('input', {
            class: 'input',
            type: 'number',
            min: '80',
            max: '280',
            value: String(settings.compactVerticalHeight || 168),
            onchange: (e) => saveSettings({ compactVerticalHeight: Number(e.target.value) || 168 }),
          }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '展开后宽度' }),
          el('input', {
            class: 'input',
            type: 'number',
            min: '520',
            max: '1400',
            value: String(settings.expandedWidth || 760),
            onchange: (e) => saveSettings({ expandedWidth: Number(e.target.value) || 760 }),
          }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '展开后高度' }),
          el('input', {
            class: 'input',
            type: 'number',
            min: '360',
            max: '1000',
            value: String(settings.expandedHeight || 560),
            onchange: (e) => saveSettings({ expandedHeight: Number(e.target.value) || 560 }),
          }),
        ]),
      ]),
      switchRow(
        '一直悬在最前',
        '收起的小条不会被别的窗口挡住',
        settings.alwaysOnTop !== false && settings.alwaysOnTopWhenDocked !== false,
        async (v) => saveSettings({ alwaysOnTop: v, alwaysOnTopWhenDocked: v })
      ),
      switchRow(
        '贴边自动隐藏',
        '收起后滑入屏幕边缘，靠近再弹出',
        settings.edgeAutoHide !== false,
        (v) => saveSettings({ edgeAutoHide: v })
      ),
      el('div', { class: 'field', style: 'margin:8px 0 4px' }, [
        el('label', { text: '离开多久后收进边缘（毫秒）' }),
        el('input', {
          class: 'input',
          type: 'number',
          min: '400',
          max: '8000',
          step: '100',
          value: String(settings.edgeHideDelayMs || 1800),
          onchange: (e) => saveSettings({ edgeHideDelayMs: Number(e.target.value) || 1800 }),
        }),
      ]),
      switchRow(
        '点到别处就收起',
        '切到其他应用时，自动回到小胶囊',
        settings.autoCollapseOnBlur === true,
        (v) => saveSettings({ autoCollapseOnBlur: v })
      ),
      switchRow(
        '打字时让开输入法',
        '打字时暂时不挡候选词',
        settings.pauseTopmostOnInput !== false,
        (v) => saveSettings({ pauseTopmostOnInput: v })
      ),
      switchRow(
        '助手完成时提醒我',
        'Codex / Claude 等本地工具跑完时弹一下',
        settings.enableAiNotify === true,
        (v) => saveSettings({ enableAiNotify: v })
      ),
      switchRow(
        '悄悄记下复制',
        '复制先收进收件箱，有空再整理',
        settings.clipboardWatch !== false,
        (v) => saveSettings({ clipboardWatch: v })
      ),
      switchRow(
        '复制时弹一下通知',
        '立刻决定存到哪里；平时可关掉',
        settings.clipboardNotify === true,
        (v) => saveSettings({ clipboardNotify: v })
      ),
      switchRow(
        '小条会说人话',
        '按时段和今日节奏轻轻问候你',
        settings.capsuleAlive !== false,
        (v) => saveSettings({ capsuleAlive: v })
      ),
      switchRow(
        '偶尔来一句短诗',
        '多一点诗意，少一点机械',
        settings.capsulePoem !== false,
        (v) => saveSettings({ capsulePoem: v })
      ),
      switchRow(
        '看看今日节律',
        '在页签里看见自己的工作节奏',
        settings.showInsights !== false,
        async (v) => {
          await saveSettings({ showInsights: v });
          if (window.App && window.App.applyInsightsTab) window.App.applyInsightsTab(v);
          if (!v && window.App && window.App.currentTab === 'insights') {
            await window.App.go('home');
          }
        }
      ),
    ]);

    const workflow = el('div', { class: 'card' }, [
      el('h3', { text: '顺手一点' }),
      el('div', { class: 'field', style: 'margin-bottom:12px' }, [
        el('label', { text: '打开时先看哪一页' }),
        el(
          'select',
          {
            class: 'select',
            onchange: (e) => saveSettings({ defaultTab: e.target.value }),
          },
          [
            ['home', '首页'],
            ['todo', '待办'],
            ['notes', '笔记'],
            ['links', '链接'],
            ['pomodoro', '番茄钟'],
            ['papers', '论文'],
            ['ailog', 'AI 对话'],
          ].map(([id, name]) =>
            el('option', {
              value: id,
              text: name,
              selected: settings.defaultTab === id ? 'selected' : null,
            })
          )
        ),
      ]),
      el('div', { class: 'muted', text: 'Alt + Space 展开或收起 · Esc 收起' }),
      el('div', { class: 'form-grid', style: 'margin-top:10px' }, [
        el('div', { class: 'field' }, [
          el('label', { text: '今日专注目标（分钟）' }),
          el('input', {
            class: 'input',
            type: 'number',
            min: '30',
            max: '720',
            value: String(settings.insightsTargetMin || 240),
            onchange: (e) => saveSettings({ insightsTargetMin: Number(e.target.value) || 240 }),
          }),
        ]),
      ]),
      el('div', { class: 'muted', style: 'margin-top:8px', text: `版本 ${version}` }),
      el('div', {
        class: 'muted',
        id: 'dataPathHint',
        style: 'margin-top:4px',
        text: '…',
      }),
      el('div', { class: 'row', style: 'margin-top:10px;flex-wrap:wrap' }, [
        el('button', {
          class: 'btn sm',
          text: '打开数据文件夹',
          onclick: async () => {
            await window.ling.store.openDataDir();
          },
        }),
        el('button', {
          class: 'btn sm',
          text: '备份',
          onclick: async () => {
            const r = await window.ling.store.exportWorkspace();
            window.ling.app.notify({
              title: r.ok ? '已备份' : '备份失败',
              message: r.ok ? '文件已保存' : r.error || '',
            });
          },
        }),
        el('button', {
          class: 'btn sm',
          text: '恢复',
          onclick: async () => {
            if (!confirm('恢复会覆盖当前待办和笔记，继续吗？')) return;
            const r = await window.ling.store.importWorkspace();
            window.ling.app.notify({
              title: r.ok ? '已恢复，建议重开一次' : '恢复失败',
              message: r.ok ? '' : r.error || '',
            });
          },
        }),
        el('button', {
          class: 'btn danger',
          text: '清空重来',
          onclick: async () => {
            if (!confirm('会清空全部待办、笔记和设置，确定吗？')) return;
            await window.ling.store.reset();
            window.location.reload();
          },
        }),
      ]),
    ]);

    const paperCard = el('div', { class: 'card', id: 'paper-paths' }, [
      el('h3', { text: '论文收纳' }),
      el('div', {
        class: 'muted',
        style: 'margin-bottom:10px',
        text: '下载目录里的 PDF，归进你的文献夹。',
      }),
      el('div', { class: 'field', style: 'margin-bottom:10px' }, [
        el('label', { text: '从哪个文件夹找 PDF' }),
        el('input', {
          class: 'input',
          id: 'paperDownloadsDir',
          value: settings.downloadsDir || '',
          placeholder: '例如 D:\\Downloads',
          onchange: async (e) => {
            await saveSettings({ downloadsDir: e.target.value.trim() });
          },
        }),
      ]),
      el('div', { class: 'field', style: 'margin-bottom:10px' }, [
        el('label', { text: '归到哪个文件夹' }),
        el('input', {
          class: 'input',
          id: 'paperRoot',
          value: settings.paperRoot || '',
          placeholder: '例如 D:\\paper',
          onchange: async (e) => {
            await saveSettings({ paperRoot: e.target.value.trim() });
          },
        }),
      ]),
      el('div', { class: 'field', style: 'margin-bottom:8px' }, [
        el('label', { text: '归档方式' }),
        el(
          'select',
          {
            class: 'select',
            onchange: async (e) => saveSettings({ paperArchiveMode: e.target.value }),
          },
          [
            el('option', {
              value: 'copy',
              text: '复制（原文件还在下载夹）',
              selected: (settings.paperArchiveMode || 'copy') === 'copy' ? 'selected' : null,
            }),
            el('option', {
              value: 'move',
              text: '移走（下载夹不再保留）',
              selected: settings.paperArchiveMode === 'move' ? 'selected' : null,
            }),
          ]
        ),
      ]),
      el('div', { class: 'muted', text: '会按主题自动分好文件夹。' }),
    ]);

    const grid = el('div', { class: 'col', style: 'gap:12px' });
    grid.append(appearance, workflow, paperCard);
    root.appendChild(grid);

    (async () => {
      try {
        const p = await window.ling.store.paths();
        const hint = document.getElementById('dataPathHint');
        if (hint && p) {
          hint.textContent = `数据在这里：${p.workspaceFile}`;
        }
        const sel = document.getElementById('dockDisplaySelect');
        if (sel) {
          let extra = [];
          try {
            extra = (await window.ling.panel.listDisplays?.()) || [];
          } catch (_) {}
          sel.innerHTML = '';
          if (extra.length) {
            extra.forEach((d, i) => {
              const opt = document.createElement('option');
              opt.value = String(d.id);
              opt.textContent = d.label || `显示器 ${i + 1}`;
              if (String(settings.dockDisplayId) === String(d.id)) opt.selected = true;
              sel.appendChild(opt);
            });
          } else {
            const opt = document.createElement('option');
            opt.value = settings.dockDisplayId != null ? String(settings.dockDisplayId) : '';
            opt.textContent =
              settings.dockDisplayId != null ? `屏幕 ${settings.dockDisplayId}` : '跟随最近拖拽的屏幕';
            sel.appendChild(opt);
          }
        }
      } catch (_) {}
    })();
  }

  window.SettingsView = { render: renderSettings };
})();
