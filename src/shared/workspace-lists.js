(function (global) {
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
    const id = global.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
    return `${prefix}_${id}`;
  }

  const sections = { clip: 'clips', note: 'notes', todo: 'todos', link: 'links' };

  function makeEntry(actionId, payload) {
    const text = payload.text;
    const kind = isUrlText(text) ? 'url' : payload && payload.paperRef && payload.paperRef.isPaperRef ? 'paper' : 'text';
    if (actionId === 'clip') {
      return { id: uid('c'), content: text, createdAt: payload.createdAt || Date.now(), kind };
    }

    if (actionId === 'note') {
      const title = previewText(text, 32) || '剪贴笔记';
      return {
        id: uid('note'),
        title,
        content: text,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    if (actionId === 'link') {
      const raw = text.trim();
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^www\./i, 'www.')}`;
      return {
        id: uid('link'),
        url: /^https?:\/\//i.test(raw) ? raw : /^www\./i.test(raw) ? `https://${raw}` : url,
        title: previewText(raw, 40),
        group: '默认',
        favicon: '',
        createdAt: Date.now(),
      };
    }

    if (actionId === 'todo') {
      return {
        id: uid('t'),
        title: previewText(text, 60) || '剪贴待办',
        status: 'today',
        note: text.slice(0, 500),
        dueAt: payload.dueAt || Date.now() + 24 * 3600e3,
        priority: 'normal',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
  }

  // 同一主进程回调内读取最新数据，一次原子保存目标分区和剩余收件箱。
  function applyInboxAction(store, ids, actionId, countWritten) {
    const selected = new Set(ids);
    const section = sections[actionId];
    const source = actionId === 'deleteClip' ? 'clips' : 'clipInbox';
    if (!Object.hasOwn(sections, actionId) && actionId !== 'drop' && actionId !== 'deleteClip') {
      throw new Error('未知的剪贴板操作');
    }
    const keep = [];
    const entries = [];
    const list = store.getSection(source) || [];
    const due = new Date();
    due.setHours(23, 30, 0, 0);
    for (const item of list) {
      if (!selected.has(item.id) || (section && !String(item.content || '').trim())) keep.push(item);
      else if (section) entries.push(makeEntry(actionId, { ...item, text: item.content, dueAt: due.getTime() }));
    }
    const count = list.length - keep.length;
    if (!count) return 0;
    const patch = { [source]: keep };
    if (section) {
      const list = entries.concat(store.getSection(section) || []);
      patch[section] = section === 'clips' ? list.slice(0, 500) : list;
    }
    if (actionId === 'note' && countWritten) {
      patch.activity = countWritten(entries.reduce((n, item) => n + item.content.length, 0));
    }
    store.save(patch);
    return count;
  }

  function clipSummary(store) {
    const inbox = store.getSection('clipInbox') || [];
    return { inbox: inbox.slice(0, 3), inboxCount: inbox.length, clipCount: (store.getSection('clips') || []).length };
  }

  function notePage(notes, { query = '', offset = 0, limit = 50 } = {}) {
    const summary = ({ id, title, updatedAt }) => ({ id, title, updatedAt });
    const term = query.trim().toLowerCase();
    if (!term) return { total: notes.length, items: notes.slice(offset, offset + limit).map(summary) };
    const items = [];
    let total = 0;
    for (const note of notes) {
      if (![note.title, note.content].some((v) => String(v || '').toLowerCase().includes(term))) continue;
      if (total++ < offset || items.length >= limit) continue;
      items.push(summary(note));
    }
    return { total, items };
  }

  function homeOverview(store, now = Date.now()) {
    let openCount = 0;
    let overdueCount = 0;
    const due = [];
    for (const todo of store.getSection('todos') || []) {
      if (todo.status === 'done') continue;
      openCount++;
      if (!todo.dueAt || todo.dueAt >= now + 3600e3) continue;
      if (todo.dueAt < now) overdueCount++;
      const idx = due.findIndex((item) => item.dueAt > todo.dueAt);
      if (idx >= 0) due.splice(idx, 0, todo);
      else if (due.length < 5) due.push(todo);
      if (due.length > 5) due.pop();
    }
    return {
      openCount, overdueCount, due,
      notes: (store.getSection('notes') || []).slice(0, 4).map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
      links: (store.getSection('links') || []).slice(0, 3),
      pomodoro: store.getSection('pomodoro'),
    };
  }

  function groupPages(rows, key, pages = {}, expandDone = false) {
    const groups = new Map();
    for (const row of rows) {
      const name = row[key] || (key === 'group' ? '默认' : 'today');
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    return Array.from(groups, ([name, items]) => {
      const done = key === 'status' && name === 'done';
      if (key === 'status') {
        items.sort(done
          ? (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
          : (a, b) => (a.dueAt || 0) - (b.dueAt || 0));
      }
      const size = done && !expandDone ? 6 : 50;
      const pageCount = Math.ceil(items.length / size);
      const page = Math.max(0, Math.min(Math.floor(Number(pages[name])) || 0, pageCount - 1));
      return { name, total: items.length, page, pageCount, items: items.slice(page * size, (page + 1) * size) };
    });
  }

  const api = { previewText, isUrlText, sections, makeEntry, applyInboxAction, clipSummary, notePage, homeOverview, groupPages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WorkspaceLists = api;
})(globalThis);
