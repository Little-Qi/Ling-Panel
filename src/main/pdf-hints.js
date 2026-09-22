/**
 * PDF 弱解析：优先读文档 Info / XMP 元数据，再从首页内容流抠文本。
 * 失败则返回空字段，仍用文件名解析结果作为默认值。
 */

const fs = require('fs');

const VENUE_IN_TEXT = [
  'KDD', 'SIGIR', 'RecSys', 'WSDM', 'CIKM', 'NeurIPS', 'ICML', 'ICLR', 'AAAI',
  'EMNLP', 'ACL', 'WWW', 'TheWebConf', 'TKDE', 'TPAMI', 'IPM', 'Nature', 'Science',
  'ESWA', 'Elsevier',
];

function readPdfChunks(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const st = fs.fstatSync(fd);
      const headN = Math.min(180 * 1024, st.size);
      const tailN = Math.min(24 * 1024, st.size);
      const head = Buffer.alloc(headN);
      fs.readSync(fd, head, 0, headN, 0);
      let tail = Buffer.alloc(0);
      if (st.size > headN) {
        tail = Buffer.alloc(tailN);
        fs.readSync(fd, tail, 0, tailN, st.size - tailN);
      }
      return { head, tail, size: st.size };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function unescapePdfText(s) {
  return String(s)
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function decodePdfHex(hex) {
  const clean = String(hex || '').replace(/[^0-9A-Fa-f]/g, '');
  const bytes = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  // UTF-16BE BOM
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }
  try {
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return String.fromCharCode(...bytes);
  }
}

/** 从 PDF 文档信息字典抠 /Title /Author /CreationDate 等 */
function extractInfoDict(buf) {
  if (!buf) return {};
  const text = buf.toString('latin1');
  const out = {};
  function readVal(key) {
    // /Key (string) or /Key<hex> or /Key 123
    const reStr = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`, 'i');
    const m1 = text.match(reStr);
    if (m1 && m1[1] != null) return unescapePdfText(m1[1]);
    const reHex = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`, 'i');
    const m2 = text.match(reHex);
    if (m2 && m2[1] != null) return decodePdfHex(m2[1]);
    const reNum = new RegExp(`/${key}\\s+(\\d{4}|\\d{2})`, 'i');
    const m3 = text.match(reNum);
    if (m3) return m3[1];
    return '';
  }
  out.title = (readVal('Title') || '').trim();
  out.author = (readVal('Author') || '').trim();
  out.subject = (readVal('Subject') || '').trim();
  out.keywords = (readVal('Keywords') || '').trim();
  out.creationDate = (readVal('CreationDate') || '').trim();
  out.modDate = (readVal('ModDate') || '').trim();
  return out;
}

/** XMP 里 dc:title / dc:creator */
function extractXmp(buf) {
  if (!buf) return {};
  const text = buf.toString('utf8');
  const out = {};
  const titleM =
    text.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i) ||
    text.match(/<dc:title>([\s\S]*?)<\/dc:title>/i);
  if (titleM) out.title = titleM[1].replace(/\s+/g, ' ').trim();
  const creatorM =
    text.match(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i) ||
    text.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i);
  if (creatorM) out.author = creatorM[1].replace(/\s+/g, ' ').trim();
  const dateM =
    text.match(/<xmp:CreateDate>([\s\S]*?)<\/xmp:CreateDate>/i) ||
    text.match(/<xmp:ModifyDate>([\s\S]*?)<\/xmp:ModifyDate>/i);
  if (dateM) out.creationDate = dateM[1].trim();
  return out;
}

/** 从 PDF 字节里抠出可打印片段（含 Tj/TJ 文本） */
function extractRawStrings(buf) {
  if (!buf) return [];
  const out = [];
  const latin = buf.toString('latin1');
  // (Hello World) Tj
  const re1 = /\((?:\\.|[^\\)]){2,}\)\s*Tj/g;
  // [(A)(B)] TJ
  const re2 = /\[(?:\s*\((?:\\.|[^\\)])+\)\s*-?\d*\.?\d*)+\]\s*TJ/g;
  let m;
  while ((m = re1.exec(latin)) !== null) {
    const inner = m[0].match(/\(((?:\\.|[^\\)])*)\)/);
    if (inner) out.push(unescapePdfText(inner[1]));
  }
  while ((m = re2.exec(latin)) !== null) {
    const parts = [];
    const reP = /\(((?:\\.|[^\\)])*)\)/g;
    let pm;
    while ((pm = reP.exec(m[0])) !== null) parts.push(unescapePdfText(pm[1]));
    if (parts.length) out.push(parts.join(''));
  }
  // 兜底：括号里的长 ASCII/混合串
  const re3 = /\(([A-Za-z0-9][^\x00-\x1f()]{6,160})\)/g;
  while ((m = re3.exec(latin)) !== null) {
    out.push(unescapePdfText(m[1]));
  }
  return out
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 3 && /[\p{L}]/u.test(s));
}

function looksLikeTitle(s) {
  if (!s || s.length < 8 || s.length > 180) return false;
  if (/^(arxiv|doi|http|www|copyright|abstract|figure|table|proceedings|conference)/i.test(s)) return false;
  if (/^\d+$/.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (/^[\d.\s]+$/.test(s)) return false;
  return true;
}

function scoreTitle(s) {
  let score = 0;
  if (looksLikeTitle(s)) score += 1;
  score += Math.min(2, (s.match(/[A-Z]/g) || []).length / 8);
  if (s.length > 20 && s.length < 120) score += 1;
  if (/[一-鿿]/.test(s)) score += 0.5;
  if (/\b(recognition|recommendation|learning|model|framework|analysis|system|for|with|via|a |an |the )\b/i.test(s)) {
    score += 1.2;
  }
  return score;
}

function yearFromDate(str) {
  if (!str) return '';
  const s = String(str);
  // D:20240315120000Z（PDF 日期，不能用 \b，因为后面常跟日）
  const dm = s.match(/D:(\d{4})\d{0,4}/);
  if (dm) return dm[1];
  // 2024-03-15 或 2024
  const m = s.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}

function findYear(strs, extra) {
  for (const s of extra || []) {
    const y = yearFromDate(s);
    if (y) return y;
  }
  for (const s of strs) {
    const m = s.match(/\b(19|20)\d{2}\b/);
    if (m) return m[0];
  }
  return 'UnknownYear';
}

function findVenue(strs, meta) {
  const joined = `${strs.join(' · ')} ${meta.title || ''} ${meta.subject || ''} ${meta.keywords || ''}`;
  for (const v of VENUE_IN_TEXT) {
    const re = new RegExp(`(^|[^A-Za-z])${v}([^A-Za-z]|$)`, 'i');
    if (re.test(joined)) return v === 'TheWebConf' ? 'WWW' : v;
  }
  if (/arxiv/i.test(joined)) return 'arXiv';
  return '';
}

function findTitle(strs) {
  let best = '';
  let bestScore = 0;
  for (const s of strs.slice(0, 40)) {
    const sc = scoreTitle(s);
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return bestScore >= 1.8 ? best : '';
}

function cleanTitle(t) {
  return String(t || '')
    .replace(/\.pdf$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9一-鿿]+/, '')
    .trim()
    .replace(/\.pdf$/i, '')
    .trim()
    .slice(0, 160);
}

function weakTitle(t) {
  return (
    !t ||
    t === 'Unclassified Paper' ||
    /unknown_paper|untitled|download|document|paper\.pdf|\d{4}.*paper/i.test(t) ||
    t.length < 8
  );
}

function weakYear(y) {
  return !y || y === 'UnknownYear' || y === '0000';
}

function weakVenue(v) {
  return !v || v === 'Other' || v === 'Unknown' || v === '';
}

/**
 * 弱解析 PDF，默认值补全
 * @returns {{ title, year, venue, model, authors, rawTitles, sample, source }}
 */
function mergeInfo(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v != null && String(v).trim() !== '') out[k] = v;
  }
  return out;
}

function extractPdfHints(filePath) {
  const chunks = readPdfChunks(filePath);
  const head = chunks && chunks.head;
  const tail = chunks && chunks.tail;
  const info = mergeInfo(extractInfoDict(head), extractInfoDict(tail));
  const xmp = mergeInfo(extractXmp(head), extractXmp(tail));
  const meta = {
    title: cleanTitle(info.title || xmp.title || ''),
    author: (info.author || xmp.author || '').trim(),
    creationDate: info.creationDate || xmp.creationDate || '',
  };
  const strs = extractRawStrings(head);
  const contentTitle = cleanTitle(findTitle(strs));
  // 元数据标题更可靠；没有再用内容流
  const title = meta.title || contentTitle;
  const year = findYear(strs, [meta.creationDate, meta.title, ...strs.slice(0, 3)]);
  const venue = findVenue(strs, meta);
  return {
    title,
    year,
    venue,
    model: '',
    authors: meta.author,
    creationDate: meta.creationDate,
    rawTitles: [meta.title, contentTitle, ...strs.filter(looksLikeTitle)]
      .map(cleanTitle)
      .filter(Boolean)
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .slice(0, 5),
    sample: strs.slice(0, 12),
    source: meta.title ? 'meta' : contentTitle ? 'content' : 'none',
  };
}

/**
 * 用 PDF 弱解析补全 parsePaperName 的结果（缺什么补什么）
 */
function enrichWithPdf(parsed, filePath) {
  const p = { ...parsed };
  let hints = null;
  try {
    hints = extractPdfHints(filePath);
  } catch {
    hints = null;
  }
  if (!hints) return p;

  if (weakTitle(p.title) && hints.title) {
    p.title = cleanTitle(hints.title);
  }
  if (weakYear(p.year) && hints.year && !weakYear(hints.year)) {
    p.year = hints.year;
  }
  if (weakVenue(p.venue) && hints.venue) {
    p.venue = hints.venue;
  }
  // 标题仍弱时，用 rawTitles 第一条像标题的
  if (weakTitle(p.title) && hints.rawTitles && hints.rawTitles.length) {
    const alt = hints.rawTitles.find((t) => !weakTitle(t) && looksLikeTitle(t));
    if (alt) p.title = cleanTitle(alt);
  }
  p._pdfHints = hints;
  p._defaults = {
    title: hints.title || p.title,
    year: hints.year || p.year,
    venue: hints.venue || p.venue,
    model: hints.model || p.model || '',
    authors: hints.authors || '',
    fromPdf: !!(hints.title || (hints.year && !weakYear(hints.year)) || hints.venue),
  };
  return p;
}

module.exports = {
  extractPdfHints,
  enrichWithPdf,
  extractRawStrings,
  extractInfoDict,
  cleanTitle,
  weakTitle,
  weakYear,
  weakVenue,
};
