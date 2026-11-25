const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const paper = require('../src/main/paper-lib');

test('一次批处理只读写一次指纹索引，归档统计只提交一次', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-batch-'));
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-files-'));
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(dl, 'paper-' + i + '.pdf'), '%PDF-' + i);
  const reads = t.mock.method(fs, 'readFileSync');
  const writes = t.mock.method(fs, 'writeFileSync');
  const count = (spy, name) => spy.mock.calls.filter(({ arguments: [file] }) => path.basename(file) === name).length;
  const scan = paper.scanDownloads(root, dl);
  assert.strictEqual(scan.items.length, 100);
  assert.strictEqual(count(reads, 'file_hashes.json'), 1);
  assert.strictEqual(count(writes, 'file_hashes.json.tmp'), 1);
  reads.mock.resetCalls();
  writes.mock.resetCalls();
  paper.scanDownloads(root, dl);
  assert.strictEqual(count(reads, 'file_hashes.json'), 1);
  assert.strictEqual(count(writes, 'file_hashes.json.tmp'), 0);
  reads.mock.resetCalls();
  writes.mock.resetCalls();
  const { results, summary } = paper.archivePapers(root, [...scan.items.slice(0, 20), scan.items[0]]);
  assert.strictEqual(summary.total, 20);
  assert.strictEqual(results.filter((r) => r.ok).length, 20);
  assert.ok(results.at(-1).duplicate);
  assert.strictEqual(count(reads, 'file_hashes.json'), 1);
  assert.strictEqual(count(writes, 'file_hashes.json.tmp'), 1);
  assert.strictEqual(count(writes, 'summary.json.tmp'), 1);
});

test('移动归档遇到清单写入失败时保留源文件，重试只生成一份 PDF 和清单记录', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-retry-'));
  const sourcePath = path.join(root, 'download.pdf');
  fs.writeFileSync(sourcePath, 'PDF data');
  const original = fs.appendFileSync;
  const fail = t.mock.method(fs, 'appendFileSync', (file, ...rest) => {
    if (path.basename(file) === 'rename_map.csv') throw Error('磁盘已满');
    return original(file, ...rest);
  });
  const params = { sourcePath, title: 'Retry', mode: 'move' };
  const failure = paper.archivePaper(root, params);
  assert.strictEqual(failure.ok, false);
  assert.strictEqual(fs.readFileSync(sourcePath, 'utf8'), 'PDF data');
  assert.strictEqual(paper.listLibrary(root).length, 0);
  fail.mock.restore();
  const saved = paper.archivePaper(root, params);
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(fs.existsSync(sourcePath), false);
  assert.strictEqual(fs.readFileSync(saved.destPath, 'utf8'), 'PDF data');
  for (const name of ['rename_map.csv', 'paper_manifest.csv']) {
    const csv = fs.readFileSync(path.join(root, '_manifest', name), 'utf8');
    assert.strictEqual(csv.trim().split('\n').length, 2);
  }
});

test('忽略一组 PDF 只提交一次，并按路径和内容合并重复条目', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-ignore-'));
  paper.addIgnore(root, { sourcePath: 'old.pdf', fp: 'a' });
  const writes = t.mock.method(fs, 'writeFileSync');
  const ignored = paper.addIgnores(root, [
    { sourcePath: 'new.pdf', fingerprint: 'a' }, { sourcePath: 'new.pdf', fp: 'b' }, { sourcePath: 'other.pdf', fp: 'c' },
  ]);
  assert.strictEqual(writes.mock.callCount(), 1);
  assert.deepStrictEqual(ignored.map((x) => x.fp), ['b', 'c']);
  assert.deepStrictEqual(paper.listIgnored(root), ignored);
});

test('后台线程按顺序处理归档和扫描，后续任务看到最终结果', async () => {
  const jobs = require('../src/main/paper-jobs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-worker-'));
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-dl-'));
  const sourcePath = path.join(dl, 'sample.pdf');
  fs.writeFileSync(sourcePath, 'sample');
  const archive = jobs.run('archivePaper', root, { sourcePath, title: 'Sample' });
  const scan = jobs.run('scanDownloads', root, dl);
  assert.ok((await archive).ok);
  assert.strictEqual((await scan).skippedCount, 1);
  await jobs.drain();
  assert.strictEqual(jobs.busy(), false);
});

test('parsePaperName extracts year venue title', () => {
  const p = paper.parsePaperName('2025_KDD_AutoCDSR_Revisiting Self-attention for Cross-domain Sequential Recommendation.pdf');
  assert.strictEqual(p.year, '2025');
  assert.strictEqual(p.venue, 'KDD');
  assert.strictEqual(p.model, 'AutoCDSR');
  assert.match(p.title, /Revisiting Self-attention/i);
});

test('parsePaperName handles Chinese download names', () => {
  const p = paper.parsePaperName('（TAMRec）Which Item\'s Audience Matches the Target User_ Time-Aligned Audience Modeling.pdf');
  assert.ok(p.year === 'UnknownYear' || p.year.length === 4);
  assert.ok(p.title.length > 3);
});

test('classifyTopic prefers seq rec', () => {
  const t = paper.classifyTopic('Sequential Recommendation with Dual Side Information');
  assert.strictEqual(t, '01_序列推荐_Sequential_Recommendation');
});

test('classifyTopic drafts', () => {
  const t = paper.classifyTopic('TAMRec Which Item Audience Matches', { forceDraft: true });
  assert.strictEqual(t, '07_自己的稿件与投稿_Own_Drafts');
});

test('formatPaperFileName follows user convention', () => {
  const n = paper.formatPaperFileName({
    year: '2025',
    venue: 'KDD',
    model: 'AutoCDSR',
    title: 'Revisiting Self-attention for Cross-domain Sequential Recommendation',
  });
  assert.strictEqual(
    n,
    '2025_KDD_AutoCDSR_Revisiting Self-attention for Cross-domain Sequential Recommendation.pdf'
  );
});

test('archivePaper copies into topic folder and updates manifest', () => {
  const root = path.join(os.tmpdir(), `paper-test-${Date.now()}`);
  const srcDir = path.join(os.tmpdir(), `paper-src-${Date.now()}`);
  fs.mkdirSync(srcDir, { recursive: true });
  const src = path.join(srcDir, 'seq_rec_paper.pdf');
  fs.writeFileSync(src, 'fake-pdf-bytes');

  paper.ensurePaperTree(root);
  const res = paper.archivePaper(root, {
    sourcePath: src,
    topic: '01_序列推荐_Sequential_Recommendation',
    year: '2024',
    venue: 'arXiv',
    model: '',
    title: 'Sequential Recommendation Demo',
    mode: 'copy',
  });
  assert.strictEqual(res.ok, true);
  assert.ok(fs.existsSync(res.destPath));
  assert.match(path.basename(res.destPath), /^2024_arXiv_Sequential Recommendation Demo/);
  assert.ok(fs.existsSync(path.join(root, '_manifest', 'paper_manifest.csv')));
  assert.ok(fs.existsSync(src), 'copy mode keeps source');
});

test('scanDownloads lists pdfs and hides content-archived', () => {
  const root = path.join(os.tmpdir(), `paper-lib-${Date.now()}`);
  const dl = path.join(os.tmpdir(), `paper-dl-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(dl, { recursive: true });
  const body = '%PDF-1.4 demo-body-same-bytes';
  fs.writeFileSync(path.join(dl, '2023_SIGIR_Modeling User Fatigue for Sequential Recommendation.pdf'), body);
  fs.writeFileSync(path.join(dl, 'renamed-copy-of-same.pdf'), body); // 同内容不同文件名
  fs.writeFileSync(path.join(dl, 'notes.txt'), 'skip');

  const r1 = paper.scanDownloads(root, dl);
  assert.strictEqual(r1.items.length, 2);
  assert.strictEqual(r1.skippedCount, 0);

  // 归档其中一份后，同内容的另一份应被隐藏
  paper.archivePaper(root, {
    sourcePath: path.join(dl, '2023_SIGIR_Modeling User Fatigue for Sequential Recommendation.pdf'),
    topic: '01_序列推荐_Sequential_Recommendation',
    year: '2023',
    venue: 'SIGIR',
    title: 'Modeling User Fatigue for Sequential Recommendation',
    mode: 'copy',
  });
  const r2 = paper.scanDownloads(root, dl);
  assert.strictEqual(r2.skippedCount, 2, '两份同内容都应视为已归档');
  assert.strictEqual(r2.items.length, 0);
});

test('archivePaper rejects duplicate content even with different name', () => {
  const root = path.join(os.tmpdir(), `paper-dup-${Date.now()}`);
  const dl = path.join(os.tmpdir(), `paper-dup-src-${Date.now()}`);
  fs.mkdirSync(dl, { recursive: true });
  const body = '%PDF-unique-bytes-xyz';
  const a = path.join(dl, 'first.pdf');
  const b = path.join(dl, 'totally-different-name.pdf');
  fs.writeFileSync(a, body);
  fs.writeFileSync(b, body);
  const r1 = paper.archivePaper(root, {
    sourcePath: a,
    topic: '10_其他学术资料',
    year: '2024',
    venue: 'Other',
    title: 'First',
    mode: 'copy',
  });
  assert.strictEqual(r1.ok, true);
  const r2 = paper.archivePaper(root, {
    sourcePath: b,
    topic: '10_其他学术资料',
    year: '2024',
    venue: 'Other',
    title: 'Second',
    mode: 'copy',
  });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.duplicate, true);
});

test('non-paper PDFs split out and ignore hides them', () => {
  const root = path.join(os.tmpdir(), `paper-np-${Date.now()}`);
  const dl = path.join(os.tmpdir(), `paper-np-dl-${Date.now()}`);
  fs.mkdirSync(dl, { recursive: true });
  fs.writeFileSync(path.join(dl, '2026迎新志愿者签到表.pdf'), 'form');
  fs.writeFileSync(path.join(dl, '2024_arXiv_Sequential Recommendation Demo.pdf'), 'paper-bytes');

  let r = paper.scanDownloads(root, dl);
  assert.strictEqual(r.nonPapers.length, 1);
  assert.strictEqual(r.items.length, 1);
  assert.ok(paper.looksLikeNonPaper('2026迎新志愿者签到表.pdf'));

  paper.addIgnore(root, {
    sourcePath: r.nonPapers[0].sourcePath,
    fp: r.nonPapers[0].fingerprint,
    fileName: r.nonPapers[0].fileName,
    reason: 'manual',
  });
  r = paper.scanDownloads(root, dl);
  assert.strictEqual(r.skippedIgnoredCount, 1);
  assert.strictEqual(r.nonPapers.length, 0);
  assert.strictEqual(r.items.length, 1);
});

