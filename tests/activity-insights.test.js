const test = require('node:test');
const assert = require('node:assert');

const activity = require('../src/main/activity-tracker');

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
