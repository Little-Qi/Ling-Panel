(function () {
  const { el } = LingUtil;

  function fmtMin(min) {
    const m = Math.max(0, Math.floor(min || 0));
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const r = m % 60;
      return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
    }
    return `${m} 分`;
  }

  function fmtChars(n) {
    const v = Math.max(0, n || 0);
    if (v >= 10000) return `${(v / 10000).toFixed(1)} 万字`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k 字`;
    return `${v} 字`;
  }

  function shortDate(iso) {
    const s = String(iso || '');
    const m = s.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `${Number(m[1])}/${Number(m[2])}` : s;
  }

  function hourLabel(h) {
    return `${String(h).padStart(2, '0')}`;
  }

  async function renderInsights(root) {
    root.innerHTML = '';
    root.className = 'view insights';

    let data = null;
    try {
      data = (await window.ling.activity.insights()) || null;
    } catch (_) {}

    if (!data) {
      root.appendChild(el('div', { class: 'empty', text: '暂时没有工作节律数据' }));
      return;
    }

    const settings = (await window.ling.store.get('settings').catch(() => ({}))) || {};
    if (settings.showInsights === false) {
      root.appendChild(
        el('div', { class: 'empty', text: '节律统计已在设置中关闭。打开后这里会显示本地工作数据。' })
      );
      return;
    }

    const targetMin = Math.max(30, Number(settings.insightsTargetMin) || 240);

    // —— 今日三枚大数字 ——
    const kpis = el('div', { class: 'insight-kpis' }, [
      el('div', { class: 'card insight-kpi' }, [
        el('div', { class: 'muted', text: '专注累积' }),
        el('div', { class: 'insight-num', text: fmtMin(data.workMin) }),
        el('div', { class: 'muted', text: `今日目标 ${fmtMin(targetMin)}` }),
      ]),
      el('div', { class: 'card insight-kpi' }, [
        el('div', { class: 'muted', text: '读过 / 写下' }),
        el('div', { class: 'insight-num', text: fmtChars(data.readChars) }),
        el('div', { class: 'muted', text: '复制与笔记里的字数' }),
      ]),
      el('div', { class: 'card insight-kpi' }, [
        el('div', { class: 'muted', text: '主力软件' }),
        el('div', {
          class: 'insight-num',
          text: data.apps && data.apps[0] ? data.apps[0].name : '—',
        }),
        el('div', {
          class: 'muted',
          text: data.apps && data.apps[0] ? fmtMin(data.apps[0].ms / 60000) : '慢慢就有了',
        }),
      ]),
    ]);
    root.appendChild(kpis);

    // —— 24h 分布 ——
    const hours = data.hours || [];
    const maxHour = Math.max(1, ...hours.map((v) => Number(v) || 0));
    const bars = el(
      'div',
      { class: 'insight-hours' },
      hours.map((ms, h) => {
        const ratio = (Number(ms) || 0) / maxHour;
        const min = Math.floor((Number(ms) || 0) / 60000);
        return el('div', { class: 'insight-hour-col', title: `${hourLabel(h)}:00 · ${min} 分` }, [
          el('div', { class: 'insight-hour-bar-wrap' }, [
            el('div', {
              class: 'insight-hour-bar',
              style: `height:${Math.max(2, Math.round(ratio * 100))}%`,
            }),
          ]),
          el('div', { class: 'insight-hour-label', text: h % 3 === 0 ? hourLabel(h) : '' }),
        ]);
      })
    );

    root.appendChild(
      el('div', { class: 'card' }, [
        el('h3', { text: '今日节奏' }),
        el('div', { class: 'muted', text: '一天里，什么时候最在状态' }),
        bars,
      ])
    );

    // —— 近 14 天 ——
    const days = data.days || [];
    const maxDay = Math.max(1, ...days.map((d) => d.workMin || 0));
    const dayChart = el(
      'div',
      { class: 'insight-days' },
      days.map((d) => {
        const ratio = (d.workMin || 0) / maxDay;
        return el('div', {
          class: 'insight-day-col',
          title: `${d.date} · ${fmtMin(d.workMin)} · ${fmtChars(d.readChars)}`,
        }, [
          el('div', { class: 'insight-day-bar-wrap' }, [
            el('div', {
              class: 'insight-day-bar',
              style: `height:${Math.max(3, Math.round(ratio * 100))}%`,
            }),
          ]),
          el('div', { class: 'insight-day-label', text: shortDate(d.date) }),
        ]);
      })
    );

    root.appendChild(
      el('div', { class: 'card' }, [
        el('h3', { text: '最近两周' }),
        el('div', { class: 'muted', text: '每天投入了多少' }),
        dayChart,
      ])
    );

    // —— 软件占用 ——
    const apps = data.apps || [];
    const maxApp = Math.max(1, ...apps.map((a) => a.ms || 0));
    const appList = apps.length
      ? el(
          'div',
          { class: 'insight-apps' },
          apps.map((a) =>
            el('div', { class: 'insight-app-row' }, [
              el('div', { class: 'insight-app-name', text: a.name }),
              el('div', { class: 'insight-app-bar-wrap' }, [
                el('div', {
                  class: 'insight-app-bar',
                  style: `width:${Math.max(2, Math.round(((a.ms || 0) / maxApp) * 100))}%`,
                }),
              ]),
              el('div', { class: 'insight-app-ms muted', text: fmtMin((a.ms || 0) / 60000) }),
            ])
          )
        )
      : el('div', { class: 'empty', text: '今天还没有软件使用记录' });

    root.appendChild(
      el('div', { class: 'card' }, [
        el('h3', { text: '软件使用' }),
        el('div', { class: 'muted', text: '时间花在了哪里' }),
        appList,
      ])
    );

    root.appendChild(
      el('div', {
        class: 'muted',
        style: 'margin-top:12px',
        text: '数据只存在你的电脑里',
      })
    );
  }

  window.InsightsView = { render: renderInsights };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fmtMin, fmtChars, shortDate, hourLabel, renderInsights };
  }
})();
