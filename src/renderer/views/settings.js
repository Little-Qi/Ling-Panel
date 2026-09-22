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
        el('label', { text: '停靠位置（任意屏幕边缘；拖到边缘松手吸附）' }),
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
        el('label', { text: '所在显示器（拖拽吸附后会记住）' }),
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
          el('label', { text: '横向胶囊宽 (px)' }),
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
          el('label', { text: '横向胶囊高 (px)' }),
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
          el('label', { text: '竖向胶囊宽 (px)' }),
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
          el('label', { text: '竖向胶囊高 (px)' }),
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
          el('label', { text: '展开宽度 (px)' }),
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
          el('label', { text: '展开高度 (px)' }),
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
        '独立悬浮于所有应用',
        '默认开启；关闭后收起条可能被其他窗口盖住',
        settings.alwaysOnTop !== false && settings.alwaysOnTopWhenDocked !== false,
        async (v) => saveSettings({ alwaysOnTop: v, alwaysOnTopWhenDocked: v })
      ),
      switchRow(
        '贴边自动隐藏',
        '收起后滑入屏幕边缘，鼠标移到该边缘再弹出',
        settings.edgeAutoHide !== false,
        (v) => saveSettings({ edgeAutoHide: v })
      ),
      el('div', { class: 'field', style: 'margin:8px 0 4px' }, [
        el('label', { text: '离开多久后贴边隐藏（毫秒）' }),
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
        '失焦后自动收起',
        '默认关。开启后点到其他应用会收回胶囊',
        settings.autoCollapseOnBlur === true,
        (v) => saveSettings({ autoCollapseOnBlur: v })
      ),
      switchRow(
        '输入时暂停置顶',
        '打字时临时让出置顶，避免输入法候选被挡（推荐开）',
        settings.pauseTopmostOnInput !== false,
        (v) => saveSettings({ pauseTopmostOnInput: v })
      ),
      switchRow(
        'AI 完成提醒',
        '监听本机 codex/claude/gpt 完成事件（默认关）',
        settings.enableAiNotify === true,
        (v) => saveSettings({ enableAiNotify: v })
      ),
      switchRow(
        '剪贴板静默记录',
        '复制自动进「待归档」收件箱，不打扰；有空再整理（推荐开）',
        settings.clipboardWatch !== false,
        (v) => saveSettings({ clipboardWatch: v })
      ),
      switchRow(
        '复制时弹系统通知',
        '默认关。打开后复制会弹 Windows 通知，可点按钮立刻归档',
        settings.clipboardNotify === true,
        (v) => saveSettings({ clipboardNotify: v })
      ),
    ]);

    const workflow = el('div', { class: 'card' }, [
      el('h3', { text: '本机与唤出' }),
      el('div', { class: 'field', style: 'margin-bottom:12px' }, [
        el('label', { text: '默认展开页' }),
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
      el('div', { class: 'muted', text: '全局快捷键：Alt + Space（展开/收起）' }),
      el('div', { class: 'muted', text: '收起：Esc / 顶栏「收起」/ 点击面板外区域' }),
      el('div', {
        class: 'muted',
        text: 'AI 提醒默认关闭；开启后：POST http://127.0.0.1:43822/notify/{source}',
      }),
      el('div', { class: 'muted', style: 'margin-top:8px', text: `版本 ${version}` }),
      el('div', {
        class: 'muted',
        id: 'dataPathHint',
        style: 'margin-top:4px',
        text: '正在读取数据目录…',
      }),
      el('div', { class: 'row', style: 'margin-top:10px;flex-wrap:wrap' }, [
        el('button', {
          class: 'btn sm',
          text: '打开数据目录',
          onclick: async () => {
            await window.ling.store.openDataDir();
          },
        }),
        el('button', {
          class: 'btn sm',
          text: '导出 workspace.json',
          onclick: async () => {
            const r = await window.ling.store.exportWorkspace();
            window.ling.app.notify({
              title: r.ok ? '已导出' : '导出失败',
              message: r.ok ? r.path : r.error || '',
            });
          },
        }),
        el('button', {
          class: 'btn sm',
          text: '导入 workspace.json',
          onclick: async () => {
            if (!confirm('导入会覆盖当前待办/笔记等数据，继续？')) return;
            const r = await window.ling.store.importWorkspace();
            window.ling.app.notify({
              title: r.ok ? '已导入，建议重启应用' : '导入失败',
              message: r.ok ? r.path : r.error || '',
            });
          },
        }),
        el('button', {
          class: 'btn danger',
          text: '重置全部本地数据',
          onclick: async () => {
            if (!confirm('确定重置工作区？此操作不可恢复。')) return;
            await window.ling.store.reset();
            window.location.reload();
          },
        }),
      ]),
    ]);

    const paperCard = el('div', { class: 'card', id: 'paper-paths' }, [
      el('h3', { text: '论文归档路径' }),
      el('div', {
        class: 'muted',
        style: 'margin-bottom:10px',
        text: '可自定义源文件夹与目标库目录，便于分发给他人使用。',
      }),
      el('div', { class: 'field', style: 'margin-bottom:10px' }, [
        el('label', { text: '源文件夹（扫描的 PDF 来源）' }),
        el('input', {
          class: 'input',
          id: 'paperDownloadsDir',
          value: settings.downloadsDir || '',
          placeholder: '例如 D:\\Downloads 或 C:\\Users\\you\\Downloads',
          onchange: async (e) => {
            await saveSettings({ downloadsDir: e.target.value.trim() });
          },
        }),
      ]),
      el('div', { class: 'field', style: 'margin-bottom:10px' }, [
        el('label', { text: '目标库根目录（归档到这里）' }),
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
              text: '复制（源文件保留）',
              selected: (settings.paperArchiveMode || 'copy') === 'copy' ? 'selected' : null,
            }),
            el('option', {
              value: 'move',
              text: '移动（源文件移走）',
              selected: settings.paperArchiveMode === 'move' ? 'selected' : null,
            }),
          ]
        ),
      ]),
      el('div', { class: 'muted', text: '主题目录 01…10 会在目标根目录下自动创建/复用。' }),
    ]);

    const grid = el('div', { class: 'col', style: 'gap:12px' });
    grid.append(appearance, workflow, paperCard);
    root.appendChild(grid);

    (async () => {
      try {
        const p = await window.ling.store.paths();
        const hint = document.getElementById('dataPathHint');
        if (hint && p) {
          hint.textContent = `工作区文件：${p.workspaceFile}`;
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
