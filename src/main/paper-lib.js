/**
 * 论文归档库 — 对齐用户既有 D:\paper 规范
 *
 * 命名：{发表年份}_{会议或期刊}_{模型简称}_{论文题目}.pdf
 * 模型简称可省略；识别失败用 UnknownYear / Unknown
 * 目录：01_… ~ 10_… + _manifest
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { enrichWithPdf } = require('./pdf-hints');

const TOPICS = [
  {
    id: '01_序列推荐_Sequential_Recommendation',
    label: '01 序列推荐',
    keywords: [
      'sequential recommendation',
      'sequential rec',
      'sequence recommendation',
      'sasrec', 'bert4rec', 'next-item', 'next item', 'session-based',
      'cross-domain sequential', 'user behavior sequence', 'autocdsr',
      'unirec', 'ticoserec', 'ss4rec', 'recgpt', 'htfrec', 'tsape',
    ],
  },
  {
    id: '02_推荐系统_其他',
    label: '02 推荐系统·其他',
    keywords: [
      'recommendation', 'recommender', 'retrieval', 'ranking', 'recsys',
      'collaborative filtering', 'click-through', 'ctr', 'fairness-aware recommendation',
      'generative retrieval', 'large language model', 'zero-shot rankers',
    ],
  },
  {
    id: '03_图与基础模型_Graph_Foundation',
    label: '03 图与基础模型',
    keywords: ['graph', 'gnn', 'opengraph', 'graph foundation', 'node classification', 'knowledge graph'],
  },
  {
    id: '04_行程与轨迹规划_Itinerary',
    label: '04 行程与轨迹',
    keywords: [
      'itinerary', 'trajectory', 'flight', 'travel', 'tourism', 'routing',
      'embark', 'urban travel', 'trip', 'logistics', 'airline',
    ],
  },
  {
    id: '05_LLM与NLP',
    label: '05 LLM与NLP',
    keywords: [
      'llm', 'language model', 'nlp', 'prompt', 'rag', 'agent', 'injection',
      'evolvesearch', 'distribution-aligned', 'injective', 'transformer language',
    ],
  },
  {
    id: '06_优化与运筹_Optimization',
    label: '06 优化与运筹',
    keywords: [
      'optimization', 'optimisation', 'shipping', 'emission', 'carbon',
      'scheduling', 'operations research', 'fuel', 'reinforcement learning',
    ],
  },
  {
    id: '07_自己的稿件与投稿_Own_Drafts',
    label: '07 自己的稿件',
    keywords: [
      'draft', 'tamrec', 'trace', 'submission', 'camera-ready', 'rebuttal',
      'reviewer', 'cover letter', 'supplementary',
    ],
  },
  {
    id: '08_arXiv未分类',
    label: '08 arXiv未分类',
    keywords: [],
  },
  {
    id: '09_证明与支撑材料',
    label: '09 证明与支撑',
    keywords: [
      'support', 'foreword', 'program note', 'programme', 'requirements',
      'certificate', 'proof', 'appendix', 'review form',
    ],
  },
  {
    id: '10_其他学术资料',
    label: '10 其他',
    keywords: [],
},
];

const VENUES = [
  'KDD', 'SIGIR', 'RecSys', 'WSDM', 'CIKM', 'WWW', 'TheWebConf',
  'NeurIPS', 'ICML', 'ICLR', 'AAAI', 'EMNLP', 'ACL',
  'TKDE', 'TPAMI', 'IPM', 'ESWA', 'Elsevier', 'Nature', 'Science',
  'arXiv', 'Draft', 'Support', 'PR', 'Other', 'Unknown',
];

function defaultPaperRoot() {
  // 本机约定 D:\paper；分发给他人时若无 D 盘则落到文档目录
  try {
    if (process.platform === 'win32' && fs.existsSync('D:\\')) {
      return path.join('D:\\', 'paper');
    }
  } catch (_) {}
  return path.join(
    process.env.USERPROFILE || 'C:\\Users\\Public',
    'Documents',
    'LingPanel-paper'
  );
}

function defaultDownloads() {
  return path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'Downloads');
}

function safeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** 明显不是论文的 PDF（表单/活动/证件类） */
function looksLikeNonPaper(rawName, title) {
  const text = `${rawName || ''} ${title || ''}`.toLowerCase();
  const keys = [
    '签到', '签到表', '志愿者', '迎新', '活动', '发票', '报销', '合同', '协议',
    '身份证', '学生证', '成绩单', '证书扫描', '护照', '签证', '体检',
    '简历', 'cover letter', '缴费', '收据', '门票', '报名表', '申请表',
    'word文档', '扫描件', '打印', '课程表', '课表', '座位表', '名单',
    'invoice', 'receipt', 'form ', 'ticket', 'certificate of attendance',
  ];
  for (const k of keys) {
    if (text.includes(k)) return true;
  }
  // 纯数字/工号姓名式文件名
  if (/^\d{6,}[-_]?[\u4e00-\u9fa5]{2,4}$/i.test(String(rawName || '').replace(/\.pdf$/i, ''))) {
    return true;
  }
  return false;
}

function ignoreDbPath(root) {
  return path.join(root, '_manifest', 'ignore.json');
}

function loadIgnoreDb(root) {
  try {
    const f = ignoreDbPath(root);
    if (fs.existsSync(f)) {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      return { items: raw.items || [], byFp: raw.byFp || {}, byPath: raw.byPath || {} };
    }
  } catch (_) {}
  return { items: [], byFp: {}, byPath: {} };
}

function saveIgnoreDb(root, db) {
  const f = ignoreDbPath(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // 控制体积：只保留最近 2000 条
  const items = (db.items || []).slice(-2000);
  const byFp = {};
  const byPath = {};
  for (const it of items) {
    if (it.fp) byFp[it.fp] = 1;
    if (it.sourcePath) byPath[it.sourcePath] = 1;
  }
  fs.writeFileSync(f, JSON.stringify({ items, byFp, byPath }, null, 2), 'utf8');
}

function isIgnored(root, sourcePath, fp) {
  const db = loadIgnoreDb(root);
  if (fp && db.byFp[fp]) return true;
  if (sourcePath && db.byPath[sourcePath]) return true;
  return false;
}

function addIgnore(root, { sourcePath, fp, fileName, reason }) {
  const db = loadIgnoreDb(root);
  const rec = {
    sourcePath: sourcePath || '',
    fp: fp || '',
    fileName: fileName || (sourcePath ? path.basename(sourcePath) : ''),
    reason: reason || 'manual',
    at: new Date().toISOString(),
  };
  db.items = (db.items || []).filter((x) => !(x.fp && rec.fp && x.fp === rec.fp) && x.sourcePath !== rec.sourcePath);
  db.items.push(rec);
  db.byFp[rec.fp] = 1;
  if (rec.sourcePath) db.byPath[rec.sourcePath] = 1;
  saveIgnoreDb(root, db);
  return rec;
}

function removeIgnore(root, { sourcePath, fp }) {
  const db = loadIgnoreDb(root);
  db.items = (db.items || []).filter((x) => {
    if (fp && x.fp === fp) return false;
    if (sourcePath && x.sourcePath === sourcePath) return false;
    return true;
  });
  delete db.byFp[fp];
  delete db.byPath[sourcePath];
  saveIgnoreDb(root, db);
  return true;
}

function listIgnored(root) {
  return loadIgnoreDb(root).items || [];
}

function hashFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha1').update(buf).digest('hex');
  } catch {
    return '';
  }
}

/**
 * 文件内容指纹（与路径/文件名无关）：
 * 全文件 sha1；超大文件用 size + 头尾分块 sha1，兼顾速度与稳定性。
 */
function contentFingerprint(filePath) {
  try {
    const st = fs.statSync(filePath);
    const MAX_FULL = 32 * 1024 * 1024;
    if (st.size <= MAX_FULL) {
      return `sha1:${crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex')}`;
    }
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(Math.min(1024 * 1024, st.size));
      fs.readSync(fd, head, 0, head.length, 0);
      const tailLen = Math.min(256 * 1024, st.size);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, Math.max(0, st.size - tailLen));
      const h = crypto.createHash('sha1');
      h.update(String(st.size));
      h.update(head);
      h.update(tail);
      return `part:${h.digest('hex')}`;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function hashCachePath(root) {
  return path.join(root, '_manifest', 'file_hashes.json');
}

function loadHashCache(root) {
  const file = hashCachePath(root);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  return { files: {} };
}

function saveHashCache(root, cache) {
  const file = hashCachePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
}

/** 带缓存的内容指纹（path + size + mtime 未变则复用） */
function fingerprintCached(root, filePath) {
  const cache = loadHashCache(root);
  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    return '';
  }
  const key = filePath;
  const rec = cache.files[key];
  const sig = `${st.size}:${Math.floor(st.mtimeMs)}`;
  if (rec && rec.sig === sig && rec.fp) return rec.fp;
  const fp = contentFingerprint(filePath);
  if (fp) {
    cache.files[key] = { sig, fp, mtime: st.mtime.toISOString() };
    saveHashCache(root, cache);
  }
  return fp;
}

/** 进程内缓存：避免每次扫描都全量重读库指纹 */
const _libFpCache = { root: null, byFp: null, at: 0 };

function invalidateLibFpCache() {
  _libFpCache.root = null;
  _libFpCache.byFp = null;
}

/**
 * 库内 PDF 内容指纹集合（带短 TTL 进程缓存，降低重复扫描开销）
 */
function libraryFingerprints(root) {
  const now = Date.now();
  if (_libFpCache.root === root && _libFpCache.byFp && now - _libFpCache.at < 60 * 1000) {
    return { byFp: _libFpCache.byFp, cache: loadHashCache(root) };
  }
  const cache = loadHashCache(root);
  const byFp = new Map();
  const folders = listTopicFolders(root);
  for (const topic of folders) {
    const dir = path.join(root, topic);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!/\.pdf$/i.test(f)) continue;
      const full = path.join(dir, f);
      const fp = fingerprintCached(root, full);
      if (fp) byFp.set(fp, full);
    }
  }
  _libFpCache.root = root;
  _libFpCache.byFp = byFp;
  _libFpCache.at = now;
  return { byFp, cache };
}

function isDuplicateContent(root, sourcePath) {
  const fp = fingerprintCached(root, sourcePath);
  if (!fp) return false;
  const { byFp } = libraryFingerprints(root);
  return byFp.has(fp);
}

/** 从文件名弱解析 year / venue / model / title */
function parsePaperName(rawName) {
  let base = String(rawName || '').replace(/\.pdf$/i, '');
  base = base.replace(/\s*\(\d+\)\s*$/, ''); // (3) 副本
  base = base.replace(/\s*\(\u65b0\u7248\)\s*/g, ' '); // (新版)
  base = base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  let year = '';
  const ym = base.match(/(19|20)\d{2}/);
  if (ym) year = ym[0];
  else year = 'UnknownYear';

  let venue = '';
  for (const v of VENUES) {
    if (new RegExp(`(^|[^a-zA-Z])${v}([^a-zA-Z]|$)`, 'i').test(base)) {
      venue = v;
      break;
    }
  }
  if (!venue) {
    if (/arxiv/i.test(base)) venue = 'arXiv';
    else if (/draft|tamrec|trace|submission/i.test(base)) venue = 'Draft';
    else if (/review|reviewer/i.test(base)) venue = 'PR';
    else if (/support|foreword|program/i.test(base)) venue = 'Support';
    else venue = 'Other';
  }

  // 去掉年份与会议前缀后再猜模型简称
  let rest = base;
  if (year && year !== 'UnknownYear') {
    rest = rest.replace(new RegExp(`^.*?${year}`), '');
  }
  rest = rest.replace(/^[^a-zA-Z0-9]+/, '');
  if (venue) {
    rest = rest.replace(new RegExp(`^${venue}\\b`, 'i'), '').replace(/^[^a-zA-Z0-9]+/, '');
  }

  let model = '';
  const modelMatch = rest.match(/^([A-Za-z][A-Za-z0-9]{1,12})(?=\s+[A-Z])/);
  const block = new Set(['With', 'For', 'And', 'The', 'Via', 'From', 'Towards', 'Using', 'Based']);
  if (modelMatch && !block.has(modelMatch[1])) {
    model = modelMatch[1];
  }

  let title = rest;
  title = title.replace(new RegExp(`^${venue}\\s*`, 'i'), '').trim();
  title = title.replace(/\s+/g, ' ').trim();
  if (!title || title.length < 3) title = safeFileName(base) || 'Unclassified Paper';

  return { year, venue, model, title: safeFileName(title) };
}

function classifyTopic(haystack, opts = {}) {
  const text = String(haystack || '').toLowerCase();
  if (/tamrec|trace|draft|submission|my paper/i.test(text) || opts.forceDraft) {
    return TOPICS.find((t) => t.id.startsWith('07_')).id;
  }
  if (/support|foreword|program note|requirements/i.test(text)) {
    return TOPICS.find((t) => t.id.startsWith('09_')).id;
  }
  for (const t of TOPICS) {
    if (!t.keywords.length) continue;
    for (const k of t.keywords) {
      if (text.includes(k.toLowerCase())) return t.id;
    }
  }
  // 后备：较宽的推荐词
  if (/recommend|recsys|ranker/i.test(text)) return '02_推荐系统_其他';
  if (/llm|language model/i.test(text)) return '05_LLM与NLP';
  if (/flight|itinerary|trajectory/i.test(text)) return '04_行程与轨迹规划_Itinerary';
  if (/graph/i.test(text)) return '03_图与基础模型_Graph_Foundation';
  return '08_arXiv未分类';
}

/** 组目标文件名：年_来源_模型_标题.pdf */
function formatPaperFileName({ year, venue, model, title, dupIndex = 0 }) {
  const y = year || 'UnknownYear';
  const v = venue || 'Unknown';
  const m = model ? `${model}_` : '';
  const t = safeFileName(title || 'Unclassified_Paper').replace(/\s+/g, ' ');
  const suffix = dupIndex > 0 ? `_${dupIndex}` : '';
  return `${y}_${v}_${m}${t}${suffix}.pdf`;
}

function ensurePaperTree(root) {
  const dirs = [root, path.join(root, '_manifest'), path.join(root, '_inbox')];
  for (const t of TOPICS) dirs.push(path.join(root, t.id));
  for (const d of dirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  return dirs;
}

function listTopicFolders(root) {
  if (!fs.existsSync(root)) return TOPICS.map((t) => t.id);
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{2}_/.test(d.name))
    .map((d) => d.name)
    .sort();
}

function appendManifest(root, rows) {
  const manifestDir = path.join(root, '_manifest');
  fs.mkdirSync(manifestDir, { recursive: true });
  const file = path.join(manifestDir, 'paper_manifest.csv');
  const header = 'filename,topic,year,venue,model,title,size_kb,mtime,dest_path\n';
  if (!fs.existsSync(file)) fs.writeFileSync(file, header, 'utf8');
  const lines = rows
    .map((r) => {
      const esc = (s) => {
        const v = String(s ?? '');
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      };
      return [
        esc(r.filename),
        esc(r.topic),
        esc(r.year),
        esc(r.venue),
        esc(r.model),
        esc(r.title),
        esc(r.size_kb),
        esc(r.mtime),
        esc(r.dest_path),
      ].join(',');
    })
    .join('\n');
  fs.appendFileSync(file, lines + '\n', 'utf8');
  return file;
}

function appendRenameMap(root, row) {
  const manifestDir = path.join(root, '_manifest');
  fs.mkdirSync(manifestDir, { recursive: true });
  const file = path.join(manifestDir, 'rename_map.csv');
  const header = 'folder,prev_name,new_name,year,venue,model,title,action,dest_path\n';
  if (!fs.existsSync(file)) fs.writeFileSync(file, header, 'utf8');
  const esc = (s) => {
    const v = String(s ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const line = [
    esc(row.folder),
    esc(row.prev_name),
    esc(row.new_name),
    esc(row.year),
    esc(row.venue),
    esc(row.model),
    esc(row.title),
    esc(row.action),
    esc(row.dest_path),
  ].join(',');
  fs.appendFileSync(file, line + '\n', 'utf8');
  return file;
}

function rescanSummary(root) {
  const topics = listTopicFolders(root);
  const summary = {
    updated_at: new Date().toISOString().slice(0, 19),
    total: 0,
    with_model_name: 0,
    format: '{发表年份}_{会议或期刊}_{模型简称}_{论文题目}.pdf',
    venue_counts: {},
    topic_counts: {},
  };
  for (const topic of topics) {
    const dir = path.join(root, topic);
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.pdf$/i.test(f)) continue;
      n += 1;
      summary.total += 1;
      const parsed = parsePaperName(f);
      if (parsed.model) summary.with_model_name += 1;
      summary.venue_counts[parsed.venue] = (summary.venue_counts[parsed.venue] || 0) + 1;
    }
    summary.topic_counts[topic] = n;
  }
  const file = path.join(root, '_manifest', 'summary.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}

/**
 * 扫描下载目录 PDF：
 * - 内容指纹已入库 → 隐藏
 * - 忽略列表 → 隐藏
 * - 非论文 PDF → nonPapers（单独标签）
 * - 其余 → items（主列表）
 */
function scanDownloads(root, downloadsDir) {
  const dir = downloadsDir || defaultDownloads();
  const items = [];
  const nonPapers = [];
  const skippedArchived = [];
  const skippedIgnored = [];
  const empty = {
    items,
    nonPapers,
    skippedArchived,
    skippedIgnored,
    skippedCount: 0,
    skippedIgnoredCount: 0,
  };
  if (!fs.existsSync(dir)) return empty;

  ensurePaperTree(root);
  const { byFp } = libraryFingerprints(root);
  const ignoreDb = loadIgnoreDb(root);

  for (const name of fs.readdirSync(dir)) {
    if (!/\.pdf$/i.test(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    // 路径已忽略：不必算哈希
    if (ignoreDb.byPath[full]) {
      skippedIgnored.push({ sourcePath: full, fileName: name, reason: 'path' });
      continue;
    }

    const fp = fingerprintCached(root, full);
    if (fp && ignoreDb.byFp[fp]) {
      skippedIgnored.push({ sourcePath: full, fileName: name, fp, reason: 'fp' });
      continue;
    }
    if (fp && byFp.has(fp)) {
      skippedArchived.push({
        sourcePath: full,
        fileName: name,
        archivedAs: byFp.get(fp),
        fp,
      });
      continue;
    }

    let parsed = parsePaperName(name);
    try {
      parsed = enrichWithPdf(parsed, full);
    } catch (_) {}
    const hay = `${name} ${parsed.title}`;
    const nonPaper = looksLikeNonPaper(name, parsed.title);
    const topic = classifyTopic(hay, {
      forceDraft: /tamrec|trace|draft|祁荣博/i.test(name),
    });
    const destName = formatPaperFileName(parsed);
    const destPath = path.join(root, topic, destName);

    const row = {
      id: full,
      sourcePath: full,
      fileName: name,
      sizeKb: Math.round(st.size / 102.4) / 10,
      mtime: st.mtime.toISOString(),
      year: parsed.year,
      venue: parsed.venue,
      model: parsed.model,
      title: parsed.title,
      topic,
      destName,
      destPath,
      suggested: true,
      fingerprint: fp,
      nonPaper,
      existsInLibrary: false,
      _pdfHints: parsed._pdfHints || null,
      _defaults: parsed._defaults || null,
    };
    if (nonPaper) nonPapers.push(row);
    else items.push(row);
  }

  const byTime = (a, b) => (a.mtime < b.mtime ? 1 : -1);
  items.sort(byTime);
  nonPapers.sort(byTime);
  return {
    items,
    nonPapers,
    skippedArchived,
    skippedIgnored,
    skippedCount: skippedArchived.length,
    skippedIgnoredCount: skippedIgnored.length,
  };
}

function collectPdfNames(root) {
  const set = new Set();
  if (!fs.existsSync(root)) return set;
  for (const topic of listTopicFolders(root)) {
    const dir = path.join(root, topic);
    try {
      for (const f of fs.readdirSync(dir)) {
        if (/\.pdf$/i.test(f)) set.add(f.toLowerCase());
      }
    } catch (_) {}
  }
  return set;
}

function uniqueDestPath(destPath) {
  if (!fs.existsSync(destPath)) return destPath;
  const dir = path.dirname(destPath);
  const base = path.basename(destPath, path.extname(destPath));
  for (let i = 2; i < 50; i++) {
    const p = path.join(dir, `${base}_${i}.pdf`);
    if (!fs.existsSync(p)) return p;
  }
  return path.join(dir, `${base}_${Date.now()}.pdf`);
}

/**
 * 归档一份 PDF（默认复制到 D:\paper，保留下载原件）
 * 内容指纹已在库中则拒绝重复入库。
 */
function archivePaper(root, payload) {
  const {
    sourcePath,
    topic,
    year,
    venue,
    model,
    title,
    mode = 'copy', // copy | move
  } = payload || {};

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: '源文件不存在' };
  }
  ensurePaperTree(root);

  const fp = fingerprintCached(root, sourcePath);
  const { byFp } = libraryFingerprints(root);
  if (fp && byFp.has(fp)) {
    return {
      ok: false,
      error: '内容已存在于文献库（按文件指纹）',
      duplicate: true,
      archivedAs: byFp.get(fp),
      fingerprint: fp,
    };
  }
  if (isIgnored(root, sourcePath, fp)) {
    return {
      ok: false,
      error: '该文件已在忽略列表',
      ignored: true,
      fingerprint: fp,
    };
  }

  const folders = listTopicFolders(root);
  const topicId = folders.includes(topic) ? topic : classifyTopic(`${title} ${sourcePath}`);

  const meta0 = {
    year: year || parsePaperName(sourcePath).year,
    venue: venue || parsePaperName(sourcePath).venue,
    model: model || parsePaperName(sourcePath).model,
    title: title || parsePaperName(sourcePath).title,
  };
  let meta = meta0;
  try {
    const base = enrichWithPdf({ ...meta0 }, sourcePath);
    meta = {
      year: meta0.year && meta0.year !== 'UnknownYear' ? meta0.year : base.year,
      venue: meta0.venue && meta0.venue !== 'Other' && meta0.venue !== 'Unknown' ? meta0.venue : base.venue,
      model: meta0.model || base.model,
      title:
        meta0.title && meta0.title !== 'Unclassified Paper' ? meta0.title : base.title || meta0.title,
    };
  } catch (_) {}

  let destName = formatPaperFileName(meta);
  let destPath = uniqueDestPath(path.join(root, topicId, destName));
  destName = path.basename(destPath);

  if (mode === 'move') {
    fs.renameSync(sourcePath, destPath);
  } else {
    fs.copyFileSync(sourcePath, destPath);
  }

  // 登记目标文件指纹
  const destFp = fingerprintCached(root, destPath);
  const cache = loadHashCache(root);
  if (destFp) {
    const st0 = fs.statSync(destPath);
    cache.files[destPath] = {
      sig: `${st0.size}:${Math.floor(st0.mtimeMs)}`,
      fp: destFp,
      mtime: st0.mtime.toISOString(),
    };
    saveHashCache(root, cache);
  }

  const st = fs.statSync(destPath);
  const row = {
    filename: destName,
    topic: topicId,
    year: meta.year,
    venue: meta.venue,
    model: meta.model,
    title: meta.title,
    size_kb: Math.round(st.size / 102.4) / 10,
    mtime: st.mtime.toISOString().slice(0, 19).replace('T', ' '),
    dest_path: destPath,
  };
  appendManifest(root, [row]);
  appendRenameMap(root, {
    folder: topicId,
    prev_name: path.basename(sourcePath),
    new_name: destName,
    year: meta.year,
    venue: meta.venue,
    model: meta.model,
    title: meta.title,
    action: mode === 'move' ? 'moved' : 'copied',
    dest_path: destPath,
  });
  invalidateLibFpCache();

  return {
    ok: true,
    destPath,
    destName,
    topic: topicId,
    fingerprint: destFp,
    summary: rescanSummary(root),
  };
}

function listLibrary(root) {
  const rows = [];
  for (const topic of listTopicFolders(root)) {
    const dir = path.join(root, topic);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!/\.pdf$/i.test(f)) continue;
      const full = path.join(dir, f);
      let st = { size: 0, mtime: new Date() };
      try {
        st = fs.statSync(full);
      } catch (_) {}
      const parsed = parsePaperName(f);
      rows.push({
        fileName: f,
        topic,
        path: full,
        year: parsed.year,
        venue: parsed.venue,
        model: parsed.model,
        title: parsed.title,
        sizeKb: Math.round(st.size / 1024),
        mtime: st.mtime.toISOString(),
      });
    }
  }
  rows.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return rows;
}

module.exports = {
  TOPICS,
  VENUES,
  defaultPaperRoot,
  defaultDownloads,
  parsePaperName,
  classifyTopic,
  formatPaperFileName,
  ensurePaperTree,
  listTopicFolders,
  scanDownloads,
  archivePaper,
  listLibrary,
  rescanSummary,
  appendManifest,
  uniqueDestPath,
  safeFileName,
  contentFingerprint,
  fingerprintCached,
  libraryFingerprints,
  isDuplicateContent,
  looksLikeNonPaper,
  loadIgnoreDb,
  saveIgnoreDb,
  isIgnored,
  addIgnore,
  removeIgnore,
  listIgnored,
  invalidateLibFpCache,
};
