/**
 * 大模型会话记录：Q / A 分段保存，可挂多个 session
 * 与剪贴板归档联动，便于随时记录与 LLM 的交互。
 */

const fs = require('fs');
const path = require('path');

function aiLogPath(root) {
  return path.join(root, '_manifest', 'ai-log.json');
}

function loadAiLog(root) {
  try {
    const f = aiLogPath(root);
    if (fs.existsSync(f)) {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      return {
        sessions: raw.sessions || [],
        items: raw.items || [],
      };
    }
  } catch (_) {}
  return { sessions: [], items: [] };
}

function saveAiLog(root, data) {
  const f = aiLogPath(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const sessions = (data.sessions || []).slice(-200);
  const items = (data.items || []).slice(-5000);
  fs.writeFileSync(f, JSON.stringify({ sessions, items }, null, 2), 'utf8');
  return { sessions, items };
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultTitleFrom(content) {
  const s = String(content || '').replace(/\s+/g, ' ').trim();
  if (!s) return '新会话';
  return s.slice(0, 40) + (s.length > 40 ? '…' : '');
}

function createSession(root, title) {
  const db = loadAiLog(root);
  const s = {
    id: uid('sess'),
    title: String(title || '新会话').trim().slice(0, 80) || '新会话',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.sessions.unshift(s);
  saveAiLog(root, db);
  return s;
}

function renameSession(root, id, title) {
  const db = loadAiLog(root);
  const s = db.sessions.find((x) => x.id === id);
  if (!s) return null;
  s.title = String(title || s.title).trim().slice(0, 80) || s.title;
  s.updatedAt = Date.now();
  saveAiLog(root, db);
  return s;
}

function removeSession(root, id) {
  const db = loadAiLog(root);
  db.sessions = db.sessions.filter((s) => s.id !== id);
  db.items = db.items.filter((it) => it.sessionId !== id);
  saveAiLog(root, db);
  return true;
}

function listSessions(root) {
  return loadAiLog(root).sessions;
}

function listItems(root, sessionId) {
  const db = loadAiLog(root);
  let items = db.items;
  if (sessionId) items = items.filter((it) => it.sessionId === sessionId);
  return items
    .slice()
    .sort((a, b) => {
      const oa = Number.isFinite(a.order) ? a.order : a.createdAt;
      const ob = Number.isFinite(b.order) ? b.order : b.createdAt;
      return oa - ob || (a.createdAt || 0) - (b.createdAt || 0);
    });
}

/** 按展示顺序（自上而下）写回会话内条目 */
function reorderItems(root, sessionId, orderedIds) {
  const db = loadAiLog(root);
  const ids = (orderedIds || []).map(String);
  const inSess = db.items.filter((it) => it.sessionId === sessionId);
  const map = new Map(inSess.map((it) => [it.id, it]));
  const next = [];
  ids.forEach((id, i) => {
    const it = map.get(id);
    if (it) {
      it.order = i;
      next.push(it);
      map.delete(id);
    }
  });
  for (const it of map.values()) {
    it.order = next.length;
    next.push(it);
  }
  const others = db.items.filter((it) => it.sessionId !== sessionId);
  db.items = others.concat(next);
  saveAiLog(root, db);
  return next;
}

/** 会话下最后一条的 role，用于建议下一条是 Q 还是 A */
function suggestNextRole(root, sessionId) {
  const items = listItems(root, sessionId);
  if (!items.length) return 'q';
  const last = items[items.length - 1];
  return last.role === 'q' ? 'a' : 'q';
}

/**
 * role: 'q' | 'a'
 * source: 'clipboard' | 'manual'
 * autoTitle: 无 sessionId 时用 content 生成会话标题
 */
function addItem(root, { sessionId, role, content, title, source, autoTitle }) {
  const db = loadAiLog(root);
  let sessId = sessionId;
  const text = String(content || '').slice(0, 20000);
  if (!text.trim()) return { ok: false, error: '内容为空' };

  if (!sessId) {
    const sTitle = title || (autoTitle ? defaultTitleFrom(text) : '新会话');
    const s = {
      id: uid('sess'),
      title: String(sTitle).trim().slice(0, 80) || '新会话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.sessions.unshift(s);
    sessId = s.id;
  } else if (!db.sessions.find((s) => s.id === sessId)) {
    const s = {
      id: sessId,
      title: String(title || '新会话').slice(0, 80),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.sessions.unshift(s);
  }

  const item = {
    id: uid('ai'),
    sessionId: sessId,
    role: role === 'a' ? 'a' : 'q',
    content: text,
    source: source === 'clipboard' ? 'clipboard' : 'manual',
    createdAt: Date.now(),
    order: db.items.filter((x) => x.sessionId === sessId).length,
  };
  db.items.push(item);
  const sess = db.sessions.find((s) => s.id === sessId);
  if (sess) {
    sess.updatedAt = Date.now();
    if ((sess.title === '新会话' || sess.title === 'LLM chat') && item.role === 'q') {
      sess.title = defaultTitleFrom(text);
    }
  }
  saveAiLog(root, db);
  return { ok: true, item, sessionId: sessId, nextRole: suggestNextRole(root, sessId) };
}

function removeItem(root, id) {
  const db = loadAiLog(root);
  db.items = db.items.filter((it) => it.id !== id);
  saveAiLog(root, db);
  return true;
}

function updateItem(root, id, patch) {
  const db = loadAiLog(root);
  const it = db.items.find((x) => x.id === id);
  if (!it) return null;
  if (patch.content != null) it.content = String(patch.content).slice(0, 20000);
  if (patch.role === 'q' || patch.role === 'a') it.role = patch.role;
  if (patch.sessionId) {
    it.sessionId = patch.sessionId;
  }
  saveAiLog(root, db);
  return it;
}

module.exports = {
  loadAiLog,
  saveAiLog,
  createSession,
  renameSession,
  removeSession,
  listSessions,
  listItems,
  reorderItems,
  addItem,
  removeItem,
  updateItem,
  suggestNextRole,
  defaultTitleFrom,
  aiLogPath,
};
