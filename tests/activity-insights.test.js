const test = require('node:test');
const assert = require('node:assert');

const activity = require('../src/main/activity-tracker');

test('连续空闲不探测进程、不写盘，跨天只归档一次', async () => {
  let stats = activity.emptyDay(), writes = 0, probes = 0;
  const tracker = new activity.ActivityTracker({
    store: { getSection: () => stats, setSection: (_key, data) => { writes++; stats = data; } },
    getIdleMs: () => 120000,
    probeApp: async () => { probes++; return 'Code'; },
  });
  for (let i = 0; i < 6; i++) await tracker.tick();
  assert.deepStrictEqual([writes, probes], [0, 0]);
  stats.date = '2000-01-01';
  await tracker.tick();
  await tracker.tick();
  assert.deepStrictEqual([writes, probes], [1, 0]);
  assert.strictEqual(stats.history[0].date, '2000-01-01');
});

test('insightsPayload includes hours and day history', () => {
  let stats = activity.emptyDay('2026-09-20');
  stats = activity.applySample(
    stats,
    { activeMs: 3600000, app: 'Code', appMs: 3600000 },
    new Date('2026-09-20T10:10:00').getTime()
  );
  stats = activity.applySample(
    stats,
    { activeMs: 1200000, readChars: 800 },
    new Date('2026-09-21T15:00:00').getTime()
  );
  const pack = activity.insightsPayload(stats);
  assert.strictEqual(pack.date, '2026-09-21');
  assert.strictEqual(pack.workMin, 20);
  assert.strictEqual(pack.readChars, 800);
  assert.strictEqual(pack.hours[15], 1200000);
  assert.ok(pack.days.length >= 2);
  assert.strictEqual(pack.days[0].date, '2026-09-20');
  assert.strictEqual(pack.days[0].workMin, 60);
});

test('topApps returns prettified sorted list', () => {
  const s = activity.emptyDay('2026-09-21');
  s.apps = { Code: 1000, chrome: 5000, WeChat: 2000 };
  const apps = activity.topApps(s, 3);
  assert.strictEqual(apps[0].name, 'Chrome');
  assert.strictEqual(apps[1].name, '微信');
  assert.strictEqual(apps[2].name, 'VS Code');
});

test('Weixin process shows as 微信', () => {
  assert.strictEqual(activity.prettifyApp('Weixin'), '微信');
  assert.strictEqual(activity.prettifyApp('Weixin.exe'), '微信');
});

test('typed keys and chars accumulate on today', () => {
  const tracker = new activity.ActivityTracker({
    store: {
      data: activity.emptyDay('2026-09-21'),
      getSection() {
        return this.data;
      },
      setSection(_k, v) {
        this.data = v;
      },
    },
    getIdleMs: () => 0,
    probeApp: async () => 'Code',
    intervalMs: 1000,
  });
  tracker.addTypedKeys(12);
  tracker.addTypedChars(8);
  tracker.addTypedChars(4);
  const pack = activity.insightsPayload(tracker.load());
  assert.strictEqual(pack.typedKeys, 12);
  assert.strictEqual(pack.typedChars, 12);
});

test('rollDay preserves history across midnight', () => {
  const day1 = activity.applySample(
    activity.emptyDay('2026-01-01'),
    { activeMs: 60000 },
    new Date('2026-01-01T23:59:00').getTime()
  );
  const day2 = activity.rollDay(day1, new Date('2026-01-02T00:10:00'));
  assert.strictEqual(day2.date, '2026-01-02');
  assert.strictEqual(day2.workMs, 0);
  assert.ok(day2.history.some((h) => h.date === '2026-01-01' && h.workMs === 60000));
});

test('history is capped', () => {
  let stats = activity.emptyDay('2020-01-01');
  for (let i = 0; i < 20; i++) {
    const d = new Date(2020, 0, 1 + i, 12, 0, 0);
    stats = activity.applySample(stats, { activeMs: 1000 }, d.getTime());
  }
  assert.ok(stats.history.length <= activity.HISTORY_LIMIT);
});

test('insightsPayload 为每一天带上明细，供切换日期', () => {
  let stats = activity.emptyDay('2026-09-19');
  stats = activity.applySample(
    stats,
    { activeMs: 3600000, app: 'Code', appMs: 3600000 },
    new Date('2026-09-19T09:00:00').getTime()
  );
  stats = activity.applySample(
    stats,
    { activeMs: 60000, readChars: 300, typedChars: 40 },
    new Date('2026-09-20T11:00:00').getTime()
  );
  const pack = activity.insightsPayload(stats);
  const yesterday = pack.days.find((d) => d.date === '2026-09-19');
  assert.ok(yesterday, '历史日应出现在 days 中');
  assert.strictEqual(yesterday.workMin, 60);
  assert.strictEqual(yesterday.hours[9], 3600000, '历史日应带小时分布');
  assert.ok(Array.isArray(yesterday.apps) && yesterday.apps.length > 0, '历史日应带软件占用');
  assert.strictEqual(yesterday.apps[0].name, 'VS Code');
});

test('days 按时间升序且每天始终有 hours 数组', () => {
  let stats = activity.emptyDay('2026-09-01');
  for (let i = 1; i <= 5; i++) {
    const d = new Date(2026, 8, i, 10, 0, 0);
    stats = activity.applySample(stats, { activeMs: 60000, readChars: i * 10 }, d.getTime());
  }
  const pack = activity.insightsPayload(stats);
  const dates = pack.days.map((d) => d.date);
  assert.deepStrictEqual(dates, [...dates].sort(), 'days 应按日期升序，便于前后翻页');
  for (const d of pack.days) {
    assert.strictEqual(d.hours.length, 24, `${d.date} 的 hours 必须是 24 段`);
  }
});

test('insightsPayload 保持旧字段不变（向后兼容）', () => {
  const stats = activity.emptyDay('2026-09-20');
  const pack = activity.insightsPayload(stats);
  for (const k of ['date', 'workMs', 'workMin', 'readChars', 'typedKeys', 'typedChars', 'hours', 'apps', 'days']) {
    assert.ok(k in pack, `payload 应保留字段 ${k}`);
  }
});
