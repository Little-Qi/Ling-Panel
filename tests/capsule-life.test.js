const test = require('node:test');
const assert = require('node:assert');

const CapsuleLife = require('../src/renderer/lib/capsule-life');
const activity = require('../src/main/activity-tracker');

test('library is large enough to avoid quick repeats', () => {
  assert.ok(CapsuleLife.librarySize() >= 70, `size=${CapsuleLife.librarySize()}`);
});

test('timeBucket covers full day', () => {
  assert.strictEqual(CapsuleLife.timeBucket(new Date('2026-01-01T06:00:00')), 'dawn');
  assert.strictEqual(CapsuleLife.timeBucket(new Date('2026-01-01T10:00:00')), 'day');
  assert.strictEqual(CapsuleLife.timeBucket(new Date('2026-01-01T15:00:00')), 'afternoon');
  assert.strictEqual(CapsuleLife.timeBucket(new Date('2026-01-01T19:00:00')), 'dusk');
  assert.strictEqual(CapsuleLife.timeBucket(new Date('2026-01-01T23:00:00')), 'night');
});

test('replaceTokens formats work and read stats', () => {
  const text = CapsuleLife.replaceTokens('专注 {workMin} · 读写 {readChars} · 还剩 {openTodos}', {
    workMs: 95 * 60000,
    readChars: 1280,
    openTodos: 3,
    topApp: 'VS Code',
  });
  assert.match(text, /1 小时35 分/);
  assert.match(text, /1\.3k 字/);
  assert.match(text, /还剩 3/);
});

test('pickLine returns celebrate when requested', () => {
  const bag = {};
  const line = CapsuleLife.pickLine({
    now: new Date('2026-01-01T10:00:00'),
    stats: { workMs: 30 * 60000, readChars: 500, topApp: 'VS Code' },
    openTodos: 0,
    celebrate: true,
    seedBag: bag,
  });
  assert.ok(line.text.length > 0);
  assert.strictEqual(line.kind, 'celebrate');
});

test('pickLine honors poemEnabled=false', () => {
  const bag = {};
  for (let i = 0; i < 40; i++) {
    const line = CapsuleLife.pickLine({
      now: new Date('2026-01-01T10:00:00'),
      stats: {},
      openTodos: 2,
      poemEnabled: false,
      seedBag: bag,
    });
    assert.notStrictEqual(line.kind, 'poem');
  }
});

test('activity applySample rolls across days', () => {
  const day1 = activity.applySample(
    activity.emptyDay('2026-01-01'),
    { activeMs: 60000, readChars: 100, app: 'Code', appMs: 60000 },
    new Date('2026-01-01T12:00:00').getTime()
  );
  assert.strictEqual(day1.workMs, 60000);
  assert.strictEqual(day1.apps.Code, 60000);
  assert.strictEqual(day1.hours[12], 60000);

  const day2 = activity.applySample(day1, { activeMs: 1000 }, new Date('2026-01-02T09:00:00').getTime());
  assert.strictEqual(day2.date, '2026-01-02');
  assert.strictEqual(day2.workMs, 1000);
  assert.strictEqual(day2.readChars, 0);
});

test('summarize exposes top app pretty name', () => {
  const stats = activity.emptyDay('2026-01-01');
  stats.apps = { Code: 5000, chrome: 9000 };
  const s = activity.summarize(stats);
  assert.strictEqual(s.topApp, 'Chrome');
  assert.strictEqual(s.workMin, 0);
});

test('sampleActive credits by idle', () => {
  const tracker = new activity.ActivityTracker({
    store: { getSection: () => null, setSection: () => {} },
    getIdleMs: () => 1000,
  });
  assert.strictEqual(tracker.sampleActive(15000).credited, 15000);
  tracker.getIdleMs = () => 20000;
  assert.strictEqual(tracker.sampleActive(15000).credited, 0);
  tracker.getIdleMs = () => 8000;
  assert.strictEqual(tracker.sampleActive(15000).credited, 7000);
});
