/**
 * 剪贴板系统通知：Windows Toast + 可点按钮（分层归档）
 * 不依赖渲染进程是否展开；普通复制也不必进 AI 页。
 */

const { Notification } = require('electron');

const { previewText, isUrlText, sections, makeEntry, applyInboxAction } = require('../shared/workspace-lists');

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

/** 系统通知也可以直接把当前剪贴内容归档。 */
function applyArchive(actionId, payload, deps) {
  const { store, aiLog, aiRoot } = deps || {};
  const text = String((payload && payload.text) || '');
  if (!text.trim()) return { ok: false, error: '空内容' };
  if (actionId === 'ignore') return { ok: true, skipped: true };
  if (Object.hasOwn(sections, actionId)) {
    if (payload.inboxId) {
      const count = applyInboxAction(store, [payload.inboxId], actionId);
      return { ok: count > 0, dest: actionId };
    }
    const section = sections[actionId];
    store.setSection(section, [makeEntry(actionId, { ...payload, text }), ...(store.getSection(section) || [])]);
    return { ok: true, dest: actionId };
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
  // 通知对象短命，避免长期占着监听
  setTimeout(() => {
    try {
      n.removeAllListeners();
      n.close();
    } catch (_) {}
  }, 20000);
  return true;
}

module.exports = {
  previewText,
  isUrlText,
  buildActions,
  applyArchive,
  applyInboxAction,
  showClipboardSystemNotify,
};
