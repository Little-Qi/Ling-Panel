(function () {
  const views = {
    home: () => window.HomeView,
    todo: () => window.TodoView,
    notes: () => window.NotesView,
    links: () => window.LinksView,
    pomodoro: () => window.PomodoroView,
    papers: () => window.PapersView,
    ailog: () => window.AiLogView,
    settings: () => window.SettingsView,
  };

  function createFallbackApi() {
    const mem = {
      settings: { theme: 'aurora', defaultTab: 'home', dock: 'top-center' },
      todos: [],
      notes: [],
      links: [],
      workflows: [
        { id: 'today', name: '今天', color: '#6C8CFF' },
        { id: 'doing', name: '进行中', color: '#F5A524' },
        { id: 'waiting', name: '待反馈', color: '#14B8A6' },
        { id: 'done', name: '已完成', color: '#22C55E' },
      ],
      pomodoro: { focusMin: 25, breakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4, history: [] },
      clips: [],
    };
    const listeners = {};
    return {
      __fallback: true,
      store: {
        get: async (k) => mem[k] || mem.settings,
        set: async (k, v) => {
          mem[k] = v;
          return v;
        },
        all: async () => mem,
        reset: async () => mem,
        paths: async () => ({
          dataDir: '(fallback)',
          workspaceFile: '(fallback)',
          userData: '(fallback)',
          usingEnv: false,
        }),
        openDataDir: async () => true,
        exportWorkspace: async () => ({ ok: false, error: 'fallback' }),
        importWorkspace: async () => ({ ok: false, error: 'fallback' }),
      },
      panel: {
        expand: async (tab) => App.showExpanded(tab || 'home'),
        collapse: async () => App.showCompact(),
        toggle: async () => (App.mode === 'expanded' ? App.showCompact() : App.showExpanded('home')),
        state: async () => App.mode,
        inputFocus: async () => {},
        inputBlur: async () => {},
        moveBy: async () => {},
        dragEnd: async () => ({ ok: true, dock: 'float-center' }),
        saveBounds: async () => {},
        listDisplays: async () => [],
      },
      todo: {
        list: async () => mem.todos,
        create: async (p) => {
          const item = { id: 't' + Date.now(), status: 'today', dueAt: Date.now() + 3600e3, ...p };
          mem.todos.unshift(item);
          return item;
        },
        update: async (id, patch) => {
          mem.todos = mem.todos.map((t) => (t.id === id ? { ...t, ...patch } : t));
          return mem.todos.find((t) => t.id === id);
        },
        remove: async (id) => {
          mem.todos = mem.todos.filter((t) => t.id !== id);
          return true;
        },
        workflows: async () => mem.workflows,
        setWorkflows: async (w) => (mem.workflows = w),
      },
      note: {
        list: async () => mem.notes,
        create: async (p) => {
          const item = { id: 'n' + Date.now(), updatedAt: Date.now(), ...p };
          mem.notes.unshift(item);
          return item;
        },
        update: async (id, patch) => {
          mem.notes = mem.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n));
          return mem.notes.find((n) => n.id === id);
        },
        remove: async (id) => {
          mem.notes = mem.notes.filter((n) => n.id !== id);
          return true;
        },
      },
      link: {
        list: async () => mem.links,
        create: async (p) => {
          const item = { id: 'l' + Date.now(), group: '默认', title: p.title || p.url, ...p };
          mem.links.unshift(item);
          return item;
        },
        update: async () => null,
        remove: async (id) => {
          mem.links = mem.links.filter((l) => l.id !== id);
          return true;
        },
      },
      pomodoro: {
        get: async () => mem.pomodoro,
        save: async (d) => (mem.pomodoro = d),
      },
      paper: {
        info: async () => ({ root: 'D:\\paper', downloads: 'Downloads', topics: [], venues: [] }),
        scan: async () => ({ ok: true, items: [], nonPapers: [], skippedCount: 0, skippedIgnoredCount: 0 }),
        archive: async () => ({ ok: false, error: 'fallback' }),
        archiveMany: async () => [],
        list: async () => [],
        rescanSummary: async () => ({}),
        open: async () => true,
        ignore: async () => ({ ok: true, ignored: [] }),
        unignore: async () => ({ ok: true, ignored: [] }),
        listIgnored: async () => [],
        pdfHints: async () => ({}),
      },
      ai: {
        sessions: async () => [],
        createSession: async (t) => ({ id: 's1', title: t || 'LLM chat' }),
        renameSession: async () => null,
        removeSession: async () => true,
        items: async () => [],
        add: async () => ({ ok: true }),
        remove: async () => true,
        update: async () => null,
        suggestRole: async () => 'q',
        clipboardText: async () => '',
        detectPaperRef: async () => ({ isPaperRef: false }),
      },
      app: {
        notify: async (p) => console.log('[notify]', p),
        version: async () => '0.2.0-fallback',
      },
      activity: {
        summary: async () => ({ date: '', workMs: 0, readChars: 0, topApp: '', apps: {} }),
        addRead: async () => ({}),
        addWrite: async () => ({}),
      },
      events: {
        on: (channel, handler) => {
          listeners[channel] = listeners[channel] || [];
          listeners[channel].push(handler);
          return () => {
            listeners[channel] = (listeners[channel] || []).filter((h) => h !== handler);
          };
        },
      },
    };
  }

  const App = {
    mode: 'compact',
    currentTab: 'home',
    viewArg: null,
    bootError: null,
    ready: false,

    async boot() {
      if (!window.ling || !window.ling.store) {
        window.ling = createFallbackApi();
        this.bootError = 'preload unavailable, demo mode';
      }

      this.bindChrome();
      this.bindEvents();
      LingUtil.bindImeSafe(document.getElementById('app'));

      const params = new URLSearchParams(location.search);
      const mode = params.get('mode') || 'compact';
      this.mode = mode === 'expanded' ? 'expanded' : 'compact';
      document.body.dataset.mode = this.mode;

      try {
        const settings = await window.ling.store.get('settings');
        this.applyTheme(settings && settings.theme);
        const dock = (settings && settings.dock) || 'top-center';
        this.applyOrient(dock === 'left-edge' || dock === 'right-edge');
        await this.updateCompactSummary();
        if (this.mode === 'expanded') {
          await this.showExpanded((settings && settings.defaultTab) || 'home');
        } else {
          this.showCompact();
        }
      } catch (err) {
        this.bootError = String(err && err.message);
        await this.showExpanded('home');
      }

      this.ready = true;
      await this.refreshBadge();
      this.startCapsuleLife();
    },

    startCapsuleLife() {
      if (this._lifeTimer) clearInterval(this._lifeTimer);
      // 收起态每隔一段时间轻轻换一句，保持新鲜感
      this._lifeTimer = setInterval(() => {
        if (this.mode === 'compact') this.updateCompactSummary();
      }, 75000);
    },

    applyTheme(theme) {
      document.body.dataset.theme = theme || 'aurora';
    },

    applyOrient(vertical) {
      document.body.dataset.orient = vertical ? 'vertical' : 'horizontal';
    },

    async updateCompactSummary() {
      const label = document.getElementById('capsuleLabel');
      const sub = document.getElementById('capsuleSub');
      const life = globalThis.CapsuleLife;
      let open = 0;
      let settings = {};
      let stats = null;
      try {
        settings = (await window.ling.store.get('settings')) || {};
      } catch (_) {}
      try {
        const todos = await window.ling.todo.list();
        open = (todos || []).filter((t) => t.status !== 'done').length;
      } catch (_) {}
      try {
        stats = (await window.ling.activity.summary()) || null;
      } catch (_) {}

      this.applyMood(life ? life.timeBucket() : 'day');

      if (!life || settings.capsuleAlive === false) {
        if (label) label.textContent = 'LING';
        if (sub) sub.textContent = open > 0 ? `待办 ${open}` : '点击展开';
        return;
      }

      if (!this._lifeBag) this._lifeBag = {};
      const celebrate = open === 0 && this._hadOpenTodos === true;
      this._hadOpenTodos = open > 0;

      const line = life.pickLine({
        now: new Date(),
        stats,
        openTodos: open,
        celebrate,
        idle: stats && stats.workMs === 0 && open === 0,
        seedBag: this._lifeBag,
        // 约 20% 诗句可在设置关掉
        poemEnabled: settings.capsulePoem !== false,
      });

      // 关闭诗句时过滤 poem 类，重选软/数据
      let text = line.text;
      if (settings.capsulePoem === false && line.kind === 'poem') {
        text = life.replaceTokens(
          (life.SoftLines[line.mood] || life.SoftLines.day)[
            Math.floor(Math.random() * (life.SoftLines[line.mood] || life.SoftLines.day).length)
          ],
          { ...stats, openTodos: open }
        );
      }

      if (label) label.textContent = line.kind === 'celebrate' ? '妥了' : 'LING';
      if (sub) {
        sub.classList.remove('capsule-sub-enter');
        void sub.offsetWidth;
        sub.textContent = text;
        sub.classList.add('capsule-sub-enter');
      }
    },

    applyMood(mood) {
      const m = (globalThis.CapsuleLife && globalThis.CapsuleLife.Moods[mood]) || null;
      document.body.dataset.mood = mood || 'day';
      const breathe = (m && m.breathe) || '2.4s';
      document.documentElement.style.setProperty('--capsule-breathe', breathe);
    },

    showCompact() {
      this.mode = 'compact';
      document.body.dataset.mode = 'compact';
      const c = document.getElementById('compact');
      const e = document.getElementById('expanded');
      if (c) {
        c.hidden = false;
        c.style.display = 'flex';
      }
      if (e) {
        e.hidden = true;
        e.style.display = 'none';
      }
      this.updateCompactSummary();
    },

    async showExpanded(tab) {
      this.mode = 'expanded';
      document.body.dataset.mode = 'expanded';
      const c = document.getElementById('compact');
      const e = document.getElementById('expanded');
      if (c) {
        c.hidden = true;
        c.style.display = 'none';
      }
      if (e) {
        e.hidden = false;
        e.style.display = 'flex';
        e.style.animation = 'none';
        void e.offsetWidth;
        e.style.animation = '';
      }
      await this.go(tab || this.currentTab || 'home');
    },

    syncModeToViewport() {
      const h = window.innerHeight;
      if (h >= 140 && this.mode !== 'expanded') {
        this.showExpanded(this.currentTab || 'home');
      } else if (h < 90 && this.mode !== 'compact') {
        this.showCompact();
      } else if (h >= 140) {
        const c = document.getElementById('compact');
        const e = document.getElementById('expanded');
        if (c) {
          c.hidden = true;
          c.style.display = 'none';
        }
        if (e) {
          e.hidden = false;
          e.style.display = 'flex';
        }
      }
    },

    async go(tab, arg) {
      if (!views[tab]) tab = 'home';
      this.currentTab = tab;
      this.viewArg = arg || null;

      document.querySelectorAll('.tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      document.querySelectorAll('.view').forEach((node) => {
        node.hidden = node.dataset.view !== tab;
      });

      const root = document.getElementById(`view-${tab}`);
      const view = views[tab] && views[tab]();
      if (view && root) {
        try {
          await view.render(root, arg);
        } catch (err) {
          root.innerHTML = '';
          root.appendChild(
            LingUtil.el('div', {
              class: 'empty',
              text: '页面加载失败：' + (err && err.message),
            })
          );
        }
      }
    },

    async refreshCurrent() {
      await this.go(this.currentTab, this.viewArg);
      await this.refreshBadge();
    },

    async refreshBadge() {
      try {
        const todos = await window.ling.todo.list();
        const open = (todos || []).filter((t) => t.status !== 'done').length;
        const badge = document.getElementById('capsuleBadge');
        if (badge) {
          badge.hidden = open <= 0;
          badge.textContent = String(open > 99 ? '99+' : open);
        }
        await this.updateCompactSummary();
      } catch (_) {}
    },

    async expandFromUi(tab) {
      try {
        if (window.ling && window.ling.panel && !window.ling.__fallback) {
          await window.ling.panel.expand(tab || this.currentTab || 'home');
        }
      } catch (_) {}
      await this.showExpanded(tab || this.currentTab || 'home');
    },

    async collapseFromUi() {
      try {
        if (window.ling && window.ling.panel && !window.ling.__fallback) {
          await window.ling.panel.collapse();
        }
      } catch (_) {}
      this.showCompact();
    },

    bindChrome() {
      let dragging = false;
      let sx = 0;
      let sy = 0;
      let moved = false;
      let downOnCapsule = false;

      const capsule = document.getElementById('capsule');
      capsule?.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
        },
        true
      );

      capsule?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        downOnCapsule = true;
        dragging = true;
        moved = false;
        sx = e.screenX;
        sy = e.screenY;
        document.body.classList.add('is-dragging');
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e) => {
        if (!dragging || !downOnCapsule || this.mode !== 'compact') return;
        const dx = e.screenX - sx;
        const dy = e.screenY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) {
          moved = true;
          sx = e.screenX;
          sy = e.screenY;
          try {
            window.ling.panel.moveBy(dx, dy);
          } catch (_) {}
        }
      });

      window.addEventListener('mouseup', async () => {
        if (!dragging) return;
        const wasMoved = moved;
        dragging = false;
        downOnCapsule = false;
        moved = false;
        document.body.classList.remove('is-dragging');
        if (!wasMoved) {
          this.expandFromUi(this.currentTab || 'home');
          return;
        }
        try {
          if (window.ling.panel.dragEnd) {
            const res = await window.ling.panel.dragEnd();
            if (res && res.ok && res.dock) {
              this.applyOrient(res.dock === 'left-edge' || res.dock === 'right-edge');
            }
            await this.updateCompactSummary();
          }
        } catch (_) {}
      });

      document.getElementById('btnCollapse')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.collapseFromUi();
      });
      document.getElementById('btnCollapse2')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.collapseFromUi();
      });

      document.getElementById('btnTheme')?.addEventListener('click', async () => {
        try {
          const order = ['aurora', 'dawn', 'mint'];
          const settings = (await window.ling.store.get('settings')) || {};
          const idx = order.indexOf(settings.theme || 'aurora');
          const next = order[(idx + 1) % order.length];
          await window.ling.store.set('settings', { ...settings, theme: next });
          this.applyTheme(next);
        } catch (_) {}
      });

      document.querySelectorAll('.tab').forEach((btn) => {
        btn.addEventListener('click', () => this.go(btn.dataset.tab));
      });

      const topbar = document.querySelector('.topbar');
      let tbDrag = false;
      let tbMoved = false;
      let tbx = 0;
      let tby = 0;
      topbar?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, select, textarea, .tabs')) return;
        tbDrag = true;
        tbMoved = false;
        tbx = e.screenX;
        tby = e.screenY;
      });
      window.addEventListener('mousemove', (e) => {
        if (!tbDrag || this.mode !== 'expanded') return;
        const dx = e.screenX - tbx;
        const dy = e.screenY - tby;
        if (Math.abs(dx) + Math.abs(dy) > 2) tbMoved = true;
        tbx = e.screenX;
        tby = e.screenY;
        try {
          window.ling.panel.moveBy(dx, dy);
        } catch (_) {}
      });
      window.addEventListener('mouseup', async () => {
        if (!tbDrag) return;
        tbDrag = false;
        if (!tbMoved) return;
        try {
          if (window.ling.panel.dragEnd) await window.ling.panel.dragEnd();
        } catch (_) {}
      });
    },

    /** 剪贴板变化时的分层归档（展开态叠加 UI；收起态靠系统通知按钮） */
    async showClipboardToast(payload) {
      if (!payload || !payload.text) return;
      // 收起态不画应用内弹层，但系统通知已弹出；点通知正文会 expand + 再进本函数
      if (this.mode !== 'expanded') return;
      let host = document.getElementById('clipToast');
      if (!host) {
        host = LingUtil.el('div', { id: 'clipToast', class: 'clip-toast' });
        document.body.appendChild(host);
      }
      host.innerHTML = '';
      const text = String(payload.text || '');
      const previewShort = text.replace(/\s+/g, ' ').trim().slice(0, 80);
      const trimmed = text.trim();
      const isUrl = /^https?:\/\/\S+$/i.test(trimmed) || /^www\.\S+$/i.test(trimmed);
      const isPaperRef = !!(payload.paperRef && payload.paperRef.isPaperRef);

      async function finish(msg) {
        host.remove();
        if (window.AiLogView && window.AiLogView.clearPending) window.AiLogView.clearPending();
        try {
          await window.ling.app.notify({ title: '剪贴板已归档', message: msg });
        } catch (_) {}
        await App.refreshBadge();
        if (App.mode === 'expanded') await App.refreshCurrent();
      }

      async function saveClip() {
        const clips = (await window.ling.store.get('clips')) || [];
        clips.unshift({
          id: 'c_' + Date.now().toString(36),
          content: text,
          createdAt: Date.now(),
          kind: isPaperRef ? 'paper' : isUrl ? 'url' : 'text',
        });
        await window.ling.store.set('clips', clips.slice(0, 500));
        await finish('已存入片段库');
      }

      async function saveNote() {
        const title = trimmed.split(/\r?\n/)[0].slice(0, 32) || '剪贴笔记';
        await window.ling.note.create({ title, content: text });
        await finish('已存入笔记');
      }

      async function saveLink() {
        const url = isUrl ? (trimmed.startsWith('http') ? trimmed : 'https://' + trimmed) : trimmed;
        await window.ling.link.create({ url, title: previewShort.slice(0, 40) || url });
        await finish('已收藏链接');
      }

      async function saveTodo() {
        await window.ling.todo.create({
          title: previewShort.slice(0, 60) || '剪贴待办',
          status: 'today',
          note: text.slice(0, 500),
        });
        await finish('已存为待办');
      }

      /** 二级：仅当用户选择「AI 会话」时才进入，再标 Q/A */
      async function openAiLayer() {
        const body = host.querySelector('.clip-toast-body');
        if (!body) return;
        body.innerHTML = '';
        let sessions = [];
        try {
          sessions = await window.ling.ai.sessions();
        } catch (_) {}
        let sid = (sessions[0] && sessions[0].id) || '';
        if (window.AiLogView && window.AiLogView.getSessionId) {
          const cur = window.AiLogView.getSessionId();
          if (cur) sid = cur;
        }
        let role = 'q';
        try {
          if (sid) role = (await window.ling.ai.suggestRole(sid)) || 'q';
        } catch (_) {}

        const sel = LingUtil.el(
          'select',
          { class: 'select', style: 'width:150px' },
          sessions.length
            ? sessions.map((s) =>
                LingUtil.el('option', {
                  value: s.id,
                  text: s.title,
                  selected: s.id === sid ? 'selected' : null,
                })
              )
            : [LingUtil.el('option', { value: '', text: '新会话' })]
        );
        sel.addEventListener('change', (e) => {
          sid = e.target.value;
        });

        async function saveAsAi(r) {
          try {
            let sessionId = sid;
            if (!sessionId) {
              const created = await window.ling.ai.createSession(
                trimmed.replace(/\s+/g, ' ').slice(0, 40) || '新会话'
              );
              sessionId = created.id;
            }
            await window.ling.ai.add({
              sessionId,
              role: r,
              content: text,
              source: 'clipboard',
              autoTitle: true,
            });
            await finish('已存入 AI 会话（' + (r === 'q' ? 'Q 提问' : 'A 回答') + '）');
          } catch (err) {
            console.error('ai archive failed', err);
          }
        }

        body.append(
          LingUtil.el('div', { class: 'clip-toast-sub', text: '归入 AI 会话 · 标记 Q/A' }),
          LingUtil.el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, [
            LingUtil.el('span', { class: 'muted', text: '会话' }),
            sel,
            LingUtil.el('button', {
              class: 'btn sm' + (role === 'q' ? ' primary' : ''),
              text: 'Q 提问',
              onclick: () => saveAsAi('q'),
            }),
            LingUtil.el('button', {
              class: 'btn sm' + (role === 'a' ? ' primary' : ''),
              text: 'A 回答',
              onclick: () => saveAsAi('a'),
            }),
            LingUtil.el('button', {
              class: 'btn sm ghost',
              text: '返回',
              onclick: () => showL1(),
            }),
          ])
        );
      }

      function showL1() {
        const body = host.querySelector('.clip-toast-body');
        if (!body) return;
        body.innerHTML = '';
        const dests = [
          ['clip', '片段', saveClip, true],
          ['note', '笔记', saveNote, false],
        ];
        if (isUrl) dests.push(['link', '链接', saveLink, false]);
        dests.push(['todo', '待办', saveTodo, false]);
        dests.push(['ai', 'AI 会话', openAiLayer, false]);
        dests.push(['ignore', '忽略', () => host.remove(), false]);

        body.appendChild(
          LingUtil.el('div', { class: 'clip-toast-sub', text: '归入哪里？（不必进 AI）' })
        );
        body.appendChild(
          LingUtil.el(
            'div',
            { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
            dests.map(([id, label, fn, primary]) =>
              LingUtil.el('button', {
                class: 'btn sm' + (primary ? ' primary' : id === 'ignore' ? ' ghost' : ''),
                text: label,
                onclick: fn,
              })
            )
          )
        );
        if (isPaperRef) {
          body.appendChild(
            LingUtil.el('div', {
              class: 'muted',
              style: 'margin-top:4px;font-size:12px',
              text:
                '识别到论文引用 ' +
                (payload.paperRef.arxivId || payload.paperRef.doi || '') +
                '，也可直接存片段',
            })
          );
        }
      }

      host.append(
        LingUtil.el('div', { class: 'clip-toast-title', text: '剪贴板分层归档' }),
        LingUtil.expandableText(text.trim() || previewShort, {
          limit: 80,
          class: 'clip-toast-preview expandable-text',
        }),
        LingUtil.el('div', { class: 'clip-toast-body' })
      );
      showL1();
      clearTimeout(this._clipToastTimer);
      this._clipToastTimer = setTimeout(() => {
        if (host && host.isConnected) host.remove();
      }, 15000);
    },

    bindEvents() {
      const on = (channel, handler) => {
        if (window.ling && window.ling.events && window.ling.events.on) {
          window.ling.events.on(channel, handler);
        }
      };

      on('panel:state', async (payload) => {
        if (!payload) return;
        if (payload.state === 'expanded') {
          await this.showExpanded(payload.tab || this.currentTab);
        } else if (payload.state === 'compact') {
          this.showCompact();
        }
        await this.refreshBadge();
      });

      on('panel:will-expand', (payload) => {
        this.currentTab = (payload && payload.tab) || this.currentTab;
      });

      on('settings:updated', (settings) => {
        this.applyTheme(settings && settings.theme);
        const dock = (settings && settings.dock) || 'top-center';
        this.applyOrient(dock === 'left-edge' || dock === 'right-edge');
      });

      on('panel:orient', (payload) => {
        this.applyOrient(!!(payload && payload.vertical));
      });

      on('notify:ai', async () => {
        await this.refreshBadge();
      });

      on('clipboard:changed', (payload) => {
        try {
          if (window.AiLogView && window.AiLogView.setPending) {
            window.AiLogView.setPending(payload);
          }
          // 收起态：不弹应用内层（系统通知已有）；展开态：叠加分层 UI
          if (this.mode === 'expanded') {
            this.showClipboardToast(payload);
            if (this.currentTab === 'ailog') this.refreshCurrent();
            if (this.currentTab === 'home') this.refreshCurrent();
          }
        } catch (_) {}
      });

      on('clipboard:archived', async () => {
        try {
          await this.refreshBadge();
          if (this.mode === 'expanded') await this.refreshCurrent();
        } catch (_) {}
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.mode === 'expanded') {
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            active.blur();
            return;
          }
          this.collapseFromUi();
        }
      });

      const onViewport = () => this.syncModeToViewport();
      window.addEventListener('resize', onViewport);
      setTimeout(onViewport, 0);
      setTimeout(onViewport, 200);
      setTimeout(onViewport, 500);
      setTimeout(onViewport, 900);
    },
  };

  window.App = App;
  document.addEventListener('DOMContentLoaded', () => {
    App.boot().catch((err) => {
      console.error('boot failed', err);
      App.showExpanded('home');
    });
  });
})();
