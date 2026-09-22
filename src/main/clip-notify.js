/**
 * 剪贴板系统通知：Windows Toast + 可点按钮（分层归档）
 * 不依赖渲染进程是否展开；普通复制也不必进 AI 页。
 */

const { Notification } = require('electron');

function previewText(text, max = 90) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function isUrlText(text) {
  const t = String(text || '').trim();
  return /^https?:\/\/\S+$/i.test(t) || /^www\.\S+$/i.test(t);
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 可测：根据内容生成通知动作（顺序即 action index） */
function buildActions(text) {
  const acts = [
    { id: 'clip', text: '片段' },
    { id: 'note', text: '笔记' },
    { id: 'ai-q', text: 'AI·Q' },
    { id: 'ai-a', text: 'AI·A' },
  ];
  if (isUrlText(text)) acts.splice(2, 0, { id: 'link', text: '链接' });
  acts.push({ id: 'ignore', text: '忽略' });
  return acts;
}

/** 可测：执行一条归档（在主进程完成，不经过渲染） */
function applyArchive(actionId, payload, deps) {
  const { store, aiLog, aiRoot } = deps || {};
  const text = String((payload && payload.text) || '');
  if (!text.trim()) return { ok: false, error: '空内容' };
  const kind = isUrlText(text) ? 'url' : payload && payload.paperRef && payload.paperRef.isPaperRef ? 'paper' : 'text';

  if (actionId === 'ignore') return { ok: true, skipped: true };

  if (actionId === 'clip') {
    const clips = (store.getSection('clips') || []).slice();
    clips.unshift({ id: uid('c'), content: text, createdAt: Date.now(), kind });
    store.setSection('clips', clips.slice(0, 500));
    return { ok: true, dest: 'clip' };
  }

  if (actionId === 'note') {
    const notes = (store.getSection('notes') || []).slice();
    const title = previewText(text, 32) || '剪贴笔记';
    notes.unshift({
      id: uid('note'),
      title,
      content: text,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    store.setSection('notes', notes);
    return { ok: true, dest: 'note' };
  }

  if (actionId === 'link') {
    const raw = text.trim();
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^www\./i, 'www.')}`;
    const links = (store.getSection('links') || []).slice();
    links.unshift({
      id: uid('link'),
      url: /^https?:\/\//i.test(raw) ? raw : /^www\./i.test(raw) ? `https://${raw}` : url,
      title: previewText(raw, 40),
      group: '默认',
      favicon: '',
      createdAt: Date.now(),
    });
    store.setSection('links', links);
    return { ok: true, dest: 'link' };
  }

  if (actionId === 'todo') {
    const todos = (store.getSection('todos') || []).slice();
    todos.unshift({
      id: uid('t'),
      title: previewText(text, 60) || '剪贴待办',
      status: 'today',
      note: text.slice(0, 500),
      dueAt: Date.now() + 24 * 3600e3,
      priority: 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    store.setSection('todos', todos);
    return { ok: true, dest: 'todo' };
  }

  if (actionId === 'ai-q' || actionId === 'ai-a') {
    const role = actionId === 'ai-a' ? 'a' : 'q';
    const root = typeof aiRoot === 'function' ? aiRoot() : aiRoot;
    const r = aiLog.addItem(root, {
      role,
      content: text,
      source: 'clipboard',
      autoTitle: true,
    });
    return { ok: !!r.ok, dest: 'ai', role, ...r };
  }

  return { ok: false, error: '未知操作' };
}

/**
 * 弹出系统通知；actions 可点，点击正文打开分层归档面板
 * @returns {boolean} 是否成功弹出
 */
function showClipboardSystemNotify(payload, deps) {
  if (!Notification.isSupported()) return false;
  const text = String((payload && payload.text) || '');
  const acts = buildActions(text);
  const n = new Notification({
    title: '剪贴板 · 分层归档',
    body: `${previewText(text, 100)}\n点按钮直接归档，或点通知打开更多选项`,
    silent: false,
    actions: acts.map((a) => ({ type: 'button', text: a.text })),
    timeoutType: 'default',
  });

  n.on('action', (_e, index) => {
    const act = acts[index];
    if (!act) return;
    if (act.id === 'ignore') return;
    try {
      const r = applyArchive(act.id, payload, deps);
      if (deps && typeof deps.onArchived === 'function') deps.onArchived(act.id, r, payload);
    } catch (err) {
      console.error('[clip-notify] archive failed', err);
    }
  });

  n.on('click', () => {
    if (deps && typeof deps.onOpenChooser === 'function') deps.onOpenChooser(payload);
  });

  n.show();
  return true;
}

module.exports = {
  previewText,
  isUrlText,
  buildActions,
  applyArchive,
  showClipboardSystemNotify,
};
