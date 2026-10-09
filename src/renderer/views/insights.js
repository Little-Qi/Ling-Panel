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

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /** 2026-09-09 → 9/9 周三（不依赖 Date 解析，避开时区坑） */
  function dateLabel(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(iso || '');
    const wd = WEEKDAYS[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
    return `${Number(m[2])}/${Number(m[3])} ${wd}`;
  }

  function hookOnHint(settings, data) {
    return settings && settings.enableKeyHook === true
      ? `按键约 ${Math.max(0, data.typedKeys || 0)} 次`
      : '应用内字数 · 全局按键可选';
  }

  /**
   * 「最近两周」可切换的三个指标。
   * 注意小时分布只累计净工作时长（见 applySample），所以 24h 图不参与切换，
   * 只有按日维度才有多指标数据。
   */
  const METRICS = [
    { id: 'workMin', label: '专注时长', fmt: (v) => fmtMin(v), desc: '每天投入了多少' },
    { id: 'readChars', label: '阅读字数', fmt: (v) => fmtChars(v), desc: '复制与笔记里的字数' },
    {
      id: 'typedChars',
      label: '手动键入',
      fmt: (v) => `${Math.max(0, Math.floor(v || 0))} 字`,
      desc: '在本应用输入框里敲下的字',
    },
  ];

  function metricOf(id) {
    return METRICS.find((m) => m.id === id) || METRICS[0];
  }

  function emptyDay(date) {
    return {
      date,
      workMs: 0,
      workMin: 0,
      readChars: 0,
      typedKeys: 0,
      typedChars: 0,
      hours: [],
      apps: [],
    };
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
    const hookOn = settings.enableKeyHook === true;

    // 近 14 天（含当前存储日），每条都带完整明细
    const days = Array.isArray(data.days) ? data.days.filter((d) => d && d.date) : [];
    const TODAY = data.date;

    let selDate = TODAY;
    let metric = 'workMin';

    const dayAt = (date) => days.find((d) => d.date === date) || emptyDay(date);
    const selIndex = () => {
      const i = days.findIndex((d) => d.date === selDate);
      return i < 0 ? days.length - 1 : i;
    };
    const isToday = () => selDate === TODAY;

    function move(delta) {
      const i = selIndex() + delta;
      const next = days[i];
      if (!next) return;
      selDate = next.date;
      paint();
    }

    // —— 日期导航 ——
    function dateNav() {
      const i = selIndex();
      return el('div', { class: 'insight-datenav' }, [
        el('button', {
          class: 'icon-btn',
          text: '‹',
          title: '前一天',
          disabled: i <= 0,
          onclick: () => move(-1),
        }),
        el('div', { class: 'insight-datenav-date' }, [
          el('div', { text: dateLabel(selDate) }),
          el('div', { class: 'insight-datenav-sub', text: isToday() ? '今天 · 实时累计中' : '历史记录' }),
        ]),
        el('button', {
          class: 'icon-btn',
          text: '›',
          title: '后一天',
          disabled: i >= days.length - 1,
          onclick: () => move(1),
        }),
        isToday()
          ? null
          : el('button', {
              class: 'btn sm ghost',
              text: '回今天',
              onclick: () => {
                selDate = TODAY;
                paint();
              },
            }),
      ]);
    }

    // —— 三枚大数字 ——
    function kpis(d) {
      return el('div', { class: 'insight-kpis' }, [
        el('div', { class: 'card insight-kpi' }, [
          el('div', { class: 'muted', text: '专注累积' }),
          el('div', { class: 'insight-num', text: fmtMin(d.workMin) }),
          el('div', { class: 'muted', text: `${isToday() ? '今日' : '当日'}目标 ${fmtMin(targetMin)}` }),
        ]),
        el('div', { class: 'card insight-kpi' }, [
          el('div', { class: 'muted', text: '读过 / 写下' }),
          el('div', { class: 'insight-num', text: fmtChars(d.readChars) }),
          el('div', { class: 'muted', text: '复制与笔记里的字数' }),
        ]),
        el('div', { class: 'card insight-kpi' }, [
          el('div', { class: 'muted', text: '手动键入' }),
          el('div', { class: 'insight-num', text: `${Math.max(0, d.typedChars || 0)} 字` }),
          el('div', { class: 'muted', text: hookOnHint(settings, d) }),
        ]),
      ]);
    }

    // —— 键入专栏 ——
    function typingCard(d) {
      const totalTyped = days.reduce((n, x) => n + (x.typedChars || 0), 0);
      return el('div', { class: 'card' }, [
        el('h3', { text: '键入专栏' }),
        el('div', {
          class: 'muted',
          text: hookOn
            ? '应用内按实际增加的字数计（不含粘贴）；全局按键只记次数，不记内容'
            : '应用内按实际增加的字数计（不含粘贴）。全局按键需在设置里手动开启',
        }),
        el('div', { class: 'insight-kpis', style: 'margin:10px 0 0' }, [
          el('div', { class: 'card insight-kpi' }, [
            el('div', { class: 'muted', text: isToday() ? '今天敲了' : '当天敲了' }),
            el('div', { class: 'insight-num', text: `${d.typedChars || 0} 字` }),
            el('div', { class: 'muted', text: '在本应用输入框' }),
          ]),
          el('div', { class: 'card insight-kpi' }, [
            el('div', { class: 'muted', text: '全局按键' }),
            el('div', {
              class: 'insight-num',
              text: hookOn ? `${d.typedKeys || 0} 次` : '未开启',
            }),
            el('div', {
              class: 'muted',
              text: hookOn ? '含编辑器/游戏等，约等于手速' : '设置 → 统计全局按键次数',
            }),
          ]),
          el('div', { class: 'card insight-kpi' }, [
            el('div', { class: 'muted', text: '两周应用内' }),
            el('div', { class: 'insight-num', text: `${totalTyped} 字` }),
            el('div', { class: 'muted', text: '不含全局按键' }),
          ]),
        ]),
      ]);
    }

    // —— 24 小时分布（只有净工作时长有小时级数据）——
    function hoursCard(d) {
      const hours = Array.isArray(d.hours) ? d.hours : [];
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
      return el('div', { class: 'card' }, [
        el('h3', { text: isToday() ? '今日节奏' : `${shortDate(selDate)} 节奏` }),
        el('div', { class: 'muted', text: '一天里，什么时候最在状态（按净工作时长）' }),
        hours.length ? bars : el('div', { class: 'empty', text: '这一天没有小时级记录' }),
      ]);
    }

    // —— 近 14 天趋势（可切指标）——
    function trendCard() {
      const m = metricOf(metric);
      const maxVal = Math.max(1, ...days.map((d) => Math.max(0, Number(d[m.id]) || 0)));
      const chart = el(
        'div',
        { class: 'insight-days' },
        days.map((d) => {
          const v = Math.max(0, Number(d[m.id]) || 0);
          const ratio = v / maxVal;
          const active = d.date === selDate;
          return el(
            'div',
            {
              class: 'insight-day-col' + (active ? ' is-active' : ''),
              title: `${d.date} · ${m.fmt(v)}${active ? ' · 当前查看' : ''}`,
            },
            [
              el('div', { class: 'insight-day-bar-wrap' }, [
                el('div', {
                  class: 'insight-day-bar',
                  style: `height:${Math.max(3, Math.round(ratio * 100))}%`,
                }),
              ]),
              el('div', { class: 'insight-day-label', text: shortDate(d.date) }),
            ]
          );
        })
      );

      const tabs = el(
        'div',
        { class: 'subtabs', style: 'margin:0' },
        METRICS.map((x) =>
          el('button', {
            class: 'btn sm' + (metric === x.id ? ' primary' : ''),
            text: x.label,
            onclick: () => {
              metric = x.id;
              paint();
            },
          })
        )
      );

      return el('div', { class: 'card' }, [
        el('div', { class: 'toolbar', style: 'margin:0 0 10px' }, [
          el('div', {}, [
            el('h3', { text: '最近两周' }),
            el('div', { class: 'muted', text: m.desc }),
          ]),
          el('span', { class: 'spacer' }),
          tabs,
        ]),
        chart,
      ]);
    }

    // —— 软件占用 ——
    function appsCard(d) {
      const apps = Array.isArray(d.apps) ? d.apps : [];
      const maxApp = Math.max(1, ...apps.map((a) => a.ms || 0));
      const list = apps.length
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
        : el('div', { class: 'empty', text: `${isToday() ? '今天' : shortDate(selDate)}还没有软件使用记录` });

      return el('div', { class: 'card' }, [
        el('h3', { text: '软件使用' }),
        el('div', { class: 'muted', text: '时间花在了哪里' }),
        list,
      ]);
    }

    function paint() {
      const d = dayAt(selDate);
      root.innerHTML = '';
      root.appendChild(dateNav());
      root.appendChild(kpis(d));
      root.appendChild(typingCard(d));
      root.appendChild(hoursCard(d));
      root.appendChild(trendCard());
      root.appendChild(appsCard(d));
      root.appendChild(
        el('div', {
          class: 'muted',
          style: 'margin-top:12px',
          text: '数据只存在你的电脑里',
        })
      );
    }

    paint();
  }

  window.InsightsView = { render: renderInsights };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fmtMin, fmtChars, shortDate, hourLabel, dateLabel, renderInsights, METRICS, emptyDay };
  }
})();