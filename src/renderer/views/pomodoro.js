(function () {
  const { el } = LingUtil;

  const timer = {
    mode: 'focus',
    running: false,
    endAt: 0,
    remainMs: 25 * 60 * 1000,
    cycle: 0,
    tick: null,
  };

  function polar(cx, cy, r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(cx, cy, r, fromDeg, toDeg) {
    const start = polar(cx, cy, r, toDeg);
    const end = polar(cx, cy, r, fromDeg);
    const large = toDeg - fromDeg <= 180 ? 0 : 1;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
  }

  function clampMin(n) {
    return Math.max(1, Math.min(90, Math.round(n)));
  }

  async function renderPomodoro(root) {
    const config = (await window.ling.pomodoro.get()) || {
      focusMin: 25,
      breakMin: 5,
      longBreakMin: 15,
      cyclesBeforeLong: 4,
      history: [],
    };

    if (!timer.running && timer.mode === 'focus') {
      timer.remainMs = (config.focusMin || 25) * 60 * 1000;
    }

    root.innerHTML = '';
    root.className = 'view ime-safe';

    const R = 96;
    const C = 110;
    const ring = el('div', { class: 'pomo-ring', id: 'pomoRing', title: '拖动圆环设置时长' });
    ring.innerHTML = `
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="12" />
        <path id="pomoArc" d="" fill="none" stroke="url(#g1)" stroke-width="12" stroke-linecap="round" />
        <circle id="pomoKnob" cx="${C}" cy="${C - R}" r="7" fill="#fff" opacity="0.95" />
        <defs>
          <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#7c9bff"/>
            <stop offset="100%" stop-color="#3dd6c6"/>
          </linearGradient>
        </defs>
      </svg>
      <div class="pomo-center">
        <div class="pomo-time" id="pomoTime">25:00</div>
        <div class="pomo-label" id="pomoLabel">专注 · 拖动调时</div>
      </div>
    `;

    const presets = el('div', { class: 'pomo-presets', id: 'pomoPresets' });
    const presetMins = [15, 25, 45, 60];
    for (const m of presetMins) {
      presets.appendChild(
        el('button', {
          class: 'btn sm',
          'data-min': String(m),
          text: `${m} 分`,
          onclick: async () => {
            if (timer.running) return;
            if (timer.mode === 'focus') {
              config.focusMin = m;
              timer.remainMs = m * 60 * 1000;
              await window.ling.pomodoro.save(config);
              paint();
              syncPresets();
            }
          },
        })
      );
    }

    const controls = el('div', { class: 'row', style: 'justify-content:center;gap:8px;flex-wrap:wrap' }, [
      el('button', {
        class: 'btn primary',
        id: 'pomoToggle',
        text: '开始',
        onclick: () => {
          const btn = document.getElementById('pomoToggle');
          if (timer.running) {
            pause();
            if (btn) btn.textContent = '继续';
          } else {
            start();
            if (btn) btn.textContent = '暂停';
          }
        },
      }),
      el('button', {
        class: 'btn',
        text: '重置',
        onclick: () => {
          reset();
          const btn = document.getElementById('pomoToggle');
          if (btn) btn.textContent = '开始';
        },
      }),
      el('button', {
        class: 'btn',
        text: '跳过',
        onclick: () => complete(),
      }),
    ]);

    const historyCard = el('div', { class: 'card', style: 'width:100%' }, [
      el('h3', { text: '最近完成' }),
      (config.history || []).length === 0
        ? el('div', { class: 'empty', style: 'padding:14px', text: '拖动圆环设定分钟数，点开始即可' })
        : el(
            'div',
            { class: 'list' },
            (config.history || []).slice(0, 5).map((h) =>
              el('div', { class: 'item', style: 'padding:8px 10px' }, [
                el('div', { class: 'item-title', text: `专注 ${h.minutes} 分钟` }),
                el('div', { class: 'spacer' }),
                el('div', { class: 'item-sub', text: LingUtil.formatTime(h.at) }),
              ])
            )
          ),
    ]);

    const hint = el('div', { class: 'pomo-hint', text: '在圆环上按住拖动即可改专注时长 · 预设一键切换' });

    const wrap = el('div', { class: 'pomo-wrap' }, [ring, presets, controls, hint, historyCard]);
    root.appendChild(wrap);

    function totalMs() {
      if (timer.mode === 'focus') return (config.focusMin || 25) * 60 * 1000;
      if (timer.mode === 'long') return (config.longBreakMin || 15) * 60 * 1000;
      return (config.breakMin || 5) * 60 * 1000;
    }

    function currentMinutes() {
      return Math.ceil((timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remainMs) / 60000) || 0;
    }

    function paintProgress() {
      const total = totalMs();
      const remain = timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remainMs;
      const doneRatio = total > 0 ? 1 - remain / total : 0;
      const elapsedDeg = Math.max(0, Math.min(360, doneRatio * 360));
      const setRatio = timer.running ? doneRatio : (config.focusMin || 25) / 90;
      const setDeg = timer.running ? elapsedDeg : Math.max(8, Math.min(360, setRatio * 360));

      const arc = document.getElementById('pomoArc');
      const knob = document.getElementById('pomoKnob');
      if (arc) {
        if (setDeg <= 0.5) {
          arc.setAttribute('d', '');
        } else {
          arc.setAttribute('d', arcPath(C, C, R, 0, setDeg));
        }
      }
      if (knob) {
        const p = polar(C, C, R, setDeg);
        knob.setAttribute('cx', p.x);
        knob.setAttribute('cy', p.y);
      }

      const timeEl = document.getElementById('pomoTime');
      const labelEl = document.getElementById('pomoLabel');
      if (timeEl) timeEl.textContent = LingUtil.formatDuration(remain);
      if (labelEl) {
        if (timer.running) {
          labelEl.textContent = timer.mode === 'focus' ? '专注中' : timer.mode === 'long' ? '长休息' : '短休息';
        } else if (timer.mode === 'focus') {
          labelEl.textContent = `专注 ${config.focusMin || 25} 分 · 拖动可调`;
        } else {
          labelEl.textContent = timer.mode === 'long' ? '长休息就绪' : '短休息就绪';
        }
      }
    }

    function syncPresets() {
      presets.querySelectorAll('[data-min]').forEach((btn) => {
        const on = Number(btn.getAttribute('data-min')) === (config.focusMin || 25);
        btn.classList.toggle('on', on);
      });
    }

    function stopTick() {
      if (timer.tick) {
        clearInterval(timer.tick);
        timer.tick = null;
      }
      timer.running = false;
    }

    function start() {
      if (timer.running) return;
      if (timer.remainMs <= 0) timer.remainMs = totalMs();
      timer.running = true;
      timer.endAt = Date.now() + timer.remainMs;
      timer.tick = setInterval(() => {
        timer.remainMs = Math.max(0, timer.endAt - Date.now());
        paintProgress();
        if (timer.remainMs <= 0) complete();
      }, 200);
      paintProgress();
    }

    function pause() {
      if (!timer.running) return;
      timer.remainMs = Math.max(0, timer.endAt - Date.now());
      stopTick();
      paintProgress();
    }

    function reset() {
      stopTick();
      timer.mode = 'focus';
      timer.remainMs = (config.focusMin || 25) * 60 * 1000;
      paintProgress();
    }

    async function complete() {
      stopTick();
      if (timer.mode === 'focus') {
        timer.cycle += 1;
        const history = config.history || [];
        history.unshift({ at: Date.now(), minutes: config.focusMin || 25 });
        config.history = history.slice(0, 200);
        await window.ling.pomodoro.save(config);
        window.ling.app.notify({
          title: '番茄完成',
          message: `已专注 ${config.focusMin || 25} 分钟`,
        });
        const longEvery = config.cyclesBeforeLong || 4;
        timer.mode = timer.cycle % longEvery === 0 ? 'long' : 'break';
        timer.remainMs = totalMs();
      } else {
        window.ling.app.notify({ title: '休息结束', message: '回到专注吧' });
        timer.mode = 'focus';
        timer.remainMs = (config.focusMin || 25) * 60 * 1000;
      }
      paintProgress();
      if (App.currentTab === 'pomodoro') {
        // 仅刷新历史区，避免打断
        historyCard.innerHTML = '';
        historyCard.appendChild(el('h3', { text: '最近完成' }));
        const hist = config.history || [];
        if (!hist.length) {
          historyCard.appendChild(el('div', { class: 'empty', text: '暂无记录' }));
        } else {
          const list = el('div', { class: 'list' });
          hist.slice(0, 5).forEach((h) => {
            list.appendChild(
              el('div', { class: 'item', style: 'padding:8px 10px' }, [
                el('div', { class: 'item-title', text: `专注 ${h.minutes} 分钟` }),
                el('div', { class: 'spacer' }),
                el('div', { class: 'item-sub', text: LingUtil.formatTime(h.at) }),
              ])
            );
          });
          historyCard.appendChild(list);
        }
      }
    }

    // 拖动圆环设置专注时长（未开始时）
    function minutesFromPointer(e) {
      const rect = ring.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (deg < 0) deg += 360;
      const ratio = deg / 360;
      return clampMin(Math.max(1, Math.round(ratio * 90)));
    }

    let draggingRing = false;
    ring.addEventListener('pointerdown', (e) => {
      if (timer.running) return;
      if (timer.mode !== 'focus') {
        timer.mode = 'focus';
        timer.remainMs = (config.focusMin || 25) * 60 * 1000;
      }
      draggingRing = true;
      ring.setPointerCapture(e.pointerId);
      const mins = minutesFromPointer(e);
      config.focusMin = mins;
      timer.remainMs = mins * 60 * 1000;
      paintProgress();
      syncPresets();
    });
    ring.addEventListener('pointermove', (e) => {
      if (!draggingRing || timer.running) return;
      const mins = minutesFromPointer(e);
      if (mins === config.focusMin) return;
      config.focusMin = mins;
      timer.remainMs = mins * 60 * 1000;
      paintProgress();
      syncPresets();
    });
    ring.addEventListener('pointerup', async (e) => {
      if (!draggingRing) return;
      draggingRing = false;
      try {
        ring.releasePointerCapture(e.pointerId);
      } catch (_) {}
      await window.ling.pomodoro.save(config);
      syncPresets();
    });
    ring.addEventListener('pointercancel', async () => {
      if (!draggingRing) return;
      draggingRing = false;
      await window.ling.pomodoro.save(config);
    });

    paintProgress();
    syncPresets();
    window.__lingPomodoro = { timer, start, pause, reset, complete, paintProgress };
  }

  window.PomodoroView = { render: renderPomodoro };
})();
