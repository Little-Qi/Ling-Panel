/**
 * 胶囊软文案：按时段 / 工作数据 / 心情状态挑一句，尽量不重复。
 * 纯逻辑，可在 node:test 与渲染进程共用。
 */
(function (global) {
  /** 时段：dawn 5-9 · day 9-14 · afternoon 14-18 · dusk 18-22 · night 22-5 */
  function timeBucket(d = new Date()) {
    const h = d.getHours();
    if (h >= 5 && h < 9) return 'dawn';
    if (h >= 9 && h < 14) return 'day';
    if (h >= 14 && h < 18) return 'afternoon';
    if (h >= 18 && h < 22) return 'dusk';
    return 'night';
  }

  const Moods = {
    dawn: { id: 'dawn', zh: '清晨', breathe: '2.8s' },
    day: { id: 'day', zh: '上午', breathe: '2.2s' },
    afternoon: { id: 'afternoon', zh: '午后', breathe: '2.4s' },
    dusk: { id: 'dusk', zh: '傍晚', breathe: '2.6s' },
    night: { id: 'night', zh: '夜里', breathe: '3.2s' },
  };

  /** 纯问候 / 人话 —— 不带数据 */
  const SoftLines = {
    dawn: [
      '早，慢慢来',
      '新的一天，轻装上阵',
      '先挑一件小事开始',
      '早安，今天也从容一点',
      '晨光刚好，不急',
      '醒了就好，其余随缘',
      '早，呼吸一下再开工',
      '把今天过成自己的节奏',
    ],
    day: [
      '专注一会儿吧',
      '就绪，等你点开',
      '一件一件来',
      '上午适合把难的啃掉',
      '心流时段到了',
      '先做最重要的那件',
      '开工，保持呼吸',
      '把噪音关小一点',
    ],
    afternoon: [
      '下午了，伸个懒腰',
      '眼睛歇一歇再继续',
      '后半场，稳一点',
      '困了就起来走两步',
      '慢慢推进，也算前进',
      '把尾巴收一收',
      '午后清醒剂：喝水',
      '还早，不慌',
    ],
    dusk: [
      '傍晚了，辛苦',
      '今天辛苦了',
      '收尾，留给明天清晰的头',
      '日落之前，再收一件',
      '工作快到站了',
      '把桌面合上也没关系',
      '傍晚的风，适合收工',
      '给今天画个小句号',
    ],
    night: [
      '夜里了，少熬一点',
      '如果还在忙，记得喝水',
      '夜深了，身体先休息',
      '明天再战也不迟',
      '关灯之前看一眼清单',
      '晚安，梦里少点待办',
      '夜色温柔，你也是',
      '已经很好了，去睡吧',
    ],
  };

  /** 与工作数据相关，{tokens} 运行时替换 */
  const DataLines = [
    '净工作 {workMin}，节奏刚好',
    '今天真正在状态 {workMin}',
    '已陪伴你 {workMin}',
    '鼠标键盘的足迹：{workMin}',
    '摘录了 {readChars}，眼光很挑',
    '今天读进 {readChars}，脑子在吸收',
    '文字里泡了 {readChars}',
    '{readChars} 从眼前流过',
    '常用软件：{topApp}',
    '今天主场是 {topApp}',
    '在 {topApp} 花了不少心思',
    '还有 {openTodos} 件小事悬着',
    '{openTodos} 件待办，不急着清空',
    '清单上还剩 {openTodos} 条呼吸',
    '专注累计 {workMin} · 摘录 {readChars}',
    '{workMin} 的投入 · {readChars} 的痕迹',
    '今天：{workMin} 在工作，{readChars} 在阅读',
  ];

  /** 里程碑 / 庆祝 */
  const CelebrateLines = [
    '都妥了',
    '清单清空，漂亮',
    '今天圆满，可以合上电脑了',
    '一件不剩，舒服',
    '搞定收工',
    '干得漂亮',
    '全部勾完，奖励自己一下',
  ];

  const IdleLines = [
    '离开一会儿也好',
    '发呆是合法的',
    '空闲不是浪费',
    '去接杯水吧',
    '屏幕外也有风景',
  ];

  /** 短诗式点缀，低频 */
  const PoemLines = [
    '风来疏竹，风过而竹不留声',
    '行到水穷处，坐看云起时',
    '慢慢走，欣赏啊',
    '今天也值得被认真对待',
    '你已经比想象中更稳了',
    '把生活调成自己的倍速',
    '静一点，答案会浮上来',
    '小步走，也是在走',
  ];

  function replaceTokens(template, stats) {
    const s = stats || {};
    const workMin = Math.max(0, Math.round((s.workMs || 0) / 60000));
    const readChars = Math.max(0, s.readChars || 0);
    const openTodos = Math.max(0, s.openTodos || 0);
    const topApp = s.topApp || '手头的事';
    return String(template)
      .replace(/\{workMin\}/g, workMin >= 60 ? `${Math.floor(workMin / 60)} 小时${workMin % 60 ? workMin % 60 + ' 分' : ''}` : `${workMin} 分钟`)
      .replace(/\{readChars\}/g, readChars >= 10000 ? `${(readChars / 10000).toFixed(1)} 万字` : readChars >= 1000 ? `${(readChars / 1000).toFixed(1)}k 字` : `${readChars} 字`)
      .replace(/\{openTodos\}/g, String(openTodos))
      .replace(/\{topApp\}/g, topApp);
  }

  /** 洗牌袋：同一天尽量不重复 */
  function pickBag(pool, bag, rng) {
    const random = rng || Math.random;
    const list = bag && Array.isArray(bag.queue) ? bag.queue : null;
    if (!bag || !Array.isArray(bag.queue)) {
      const q = pool.map((_, i) => i);
      for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [q[i], q[j]] = [q[j], q[i]];
      }
      if (bag) bag.queue = q;
      else return q.pop();
      return bag.queue.pop();
    }
    if (!bag.queue.length) {
      bag.queue = pool.map((_, i) => i);
      for (let i = bag.queue.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag.queue[i], bag.queue[j]] = [bag.queue[j], bag.queue[i]];
      }
    }
    return bag.queue.pop();
  }

  function ensureBags(seed) {
    const bag = seed || {};
    for (const k of ['soft', 'data', 'poem', 'idle', 'celebrate']) {
      if (!bag[k] || !Array.isArray(bag[k].queue)) bag[k] = { queue: [] };
    }
    return bag;
  }

  /**
   * 选一条胶囊文案。
   * @param {object} ctx { now, stats, openTodos, celebrate, idle, seedBag }
   */
  function pickLine(ctx) {
    const c = ctx || {};
    const now = c.now || new Date();
    const bucket = timeBucket(now);
    const stats = { ...(c.stats || {}), openTodos: c.openTodos || 0 };
    const bag = ensureBags(c.seedBag);
    c.seedBag = bag;

    if (c.celebrate && CelebrateLines.length) {
      const i = pickBag(CelebrateLines, bag.celebrate);
      return {
        kind: 'celebrate',
        mood: bucket,
        text: replaceTokens(CelebrateLines[i], stats),
      };
    }

    if (c.idle && IdleLines.length && Math.random() < 0.65) {
      const i = pickBag(IdleLines, bag.idle);
      return { kind: 'idle', mood: bucket, text: IdleLines[i] };
    }

    // 约 35% 融数据，20% 诗句点缀，其余软问候
    const roll = Math.random();
    const hasData = (stats.workMs || 0) > 5 * 60000 || (stats.readChars || 0) > 20 || stats.topApp;
    const poemOk = c.poemEnabled !== false;
    if (hasData && roll < 0.35) {
      const i = pickBag(DataLines, bag.data);
      return { kind: 'data', mood: bucket, text: replaceTokens(DataLines[i], stats) };
    }
    if (poemOk && roll > 0.8) {
      const i = pickBag(PoemLines, bag.poem);
      return { kind: 'poem', mood: bucket, text: PoemLines[i] };
    }

    const pool = SoftLines[bucket] || SoftLines.day;
    const i = pickBag(pool, bag.soft);
    return { kind: 'soft', mood: bucket, text: pool[i] };
  }

  /** 主标签：清空时用庆祝，否则 LING */
  function pickLabel(ctx) {
    if (ctx && ctx.celebrate) return 'LING';
    return 'LING';
  }

  const CapsuleLife = {
    timeBucket,
    Moods,
    SoftLines,
    DataLines,
    CelebrateLines,
    IdleLines,
    PoemLines,
    replaceTokens,
    pickBag,
    ensureBags,
    pickLine,
    pickLabel,
    librarySize() {
      return (
        Object.values(SoftLines).reduce((n, a) => n + a.length, 0) +
        DataLines.length +
        CelebrateLines.length +
        IdleLines.length +
        PoemLines.length
      );
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CapsuleLife;
  global.CapsuleLife = CapsuleLife;
})(typeof globalThis !== 'undefined' ? globalThis : this);
