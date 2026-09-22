const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extractPdfHints,
  enrichWithPdf,
  extractInfoDict,
  cleanTitle,
  weakTitle,
  weakYear,
  weakVenue,
} = require('../src/main/pdf-hints');

function writeTempPdf(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-hints-'));
  const f = path.join(dir, name);
  fs.writeFileSync(f, body);
  return f;
}

test('extractInfoDict reads Title and CreationDate', () => {
  const buf = Buffer.from(
    '1 0 obj << /Title (Deep Learning for Sequential Recommendation) /Author (Alice) /CreationDate (D:20240315120000Z) >> endobj',
    'latin1'
  );
  const info = extractInfoDict(buf);
  assert.match(info.title, /Deep Learning for Sequential Recommendation/);
  assert.strictEqual(info.author, 'Alice');
  assert.match(info.creationDate, /20240315/);
});

test('extractPdfHints prefers metadata title and year', () => {
  const body = [
    '%PDF-1.4',
    '1 0 obj << /Title (Graph Foundation Models for Recommendation) /CreationDate (D:20230101) >> endobj',
    '(noise text) Tj',
  ].join('\n');
  const f = writeTempPdf('download.pdf', body);
  const h = extractPdfHints(f);
  assert.strictEqual(h.title, 'Graph Foundation Models for Recommendation');
  assert.strictEqual(h.year, '2023');
  assert.strictEqual(h.source, 'meta');
});

test('extractPdfHints falls back to content stream title', () => {
  const body = [
    '%PDF-1.4',
    '(Modeling User Fatigue for Sequential Recommendation with Dual Attention) Tj',
    '(KDD 2025) Tj',
  ].join('\n');
  const f = writeTempPdf('paper.pdf', body);
  const h = extractPdfHints(f);
  assert.match(h.title, /User Fatigue|Sequential Recommendation/i);
  assert.ok(h.year === '2025' || h.year === 'UnknownYear');
});

test('enrichWithPdf fills weak name fields', () => {
  const body = '%PDF-1.4\n/Title (AutoCDSR Revisiting Self-attention) /CreationDate (D:20250401)';
  const f = writeTempPdf('unknown_paper.pdf', body);
  const p = enrichWithPdf(
    { year: 'UnknownYear', venue: 'Other', model: '', title: 'Unclassified Paper' },
    f
  );
  assert.strictEqual(p.year, '2025');
  assert.match(p.title, /AutoCDSR/);
  assert.ok(p._pdfHints);
  assert.ok(p._defaults);
});

test('enrichWithPdf keeps strong filename values', () => {
  const body = '%PDF-1.4\n/Title (Something Else Entirely) /CreationDate (D:19990101)';
  const f = writeTempPdf('2024_KDD_Foo_Bar Title.pdf', body);
  const p = enrichWithPdf(
    { year: '2024', venue: 'KDD', model: 'Foo', title: 'Bar Title From Filename' },
    f
  );
  assert.strictEqual(p.year, '2024');
  assert.strictEqual(p.venue, 'KDD');
  assert.strictEqual(p.model, 'Foo');
  assert.strictEqual(p.title, 'Bar Title From Filename');
});

test('weak helpers', () => {
  assert.ok(weakTitle('Unclassified Paper'));
  assert.ok(weakTitle('download'));
  assert.ok(!weakTitle('A Real Research Paper Title'));
  assert.ok(weakYear('UnknownYear'));
  assert.ok(!weakYear('2024'));
  assert.ok(weakVenue('Other'));
  assert.ok(!weakVenue('KDD'));
  assert.strictEqual(cleanTitle('  Hello   World.pdf '), 'Hello World');
});
