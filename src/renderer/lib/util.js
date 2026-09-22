(function (global) {
  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function formatDay(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function dueLabel(ts) {
    if (!ts) return '无截止';
    const now = Date.now();
    const diff = ts - now;
    if (diff < 0) return `已逾期 ${formatDuration(-diff)}前`;
    if (diff < 3600e3) return `${Math.round(diff / 60e3)} 分钟后`;
    if (diff < 86400e3) return `${Math.round(diff / 3600e3)} 小时后`;
    return formatDay(ts);
  }

  function isOverdue(ts) {
    return ts && ts < Date.now();
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** 长文本默认缩略，可点「展开/收起」 */
  function expandableText(full, opts = {}) {
    const text = String(full || '');
    const limit = opts.limit || 120;
    const collapsedClass = opts.class || 'expandable-text';
    const short = text.length > limit ? text.slice(0, limit).replace(/\s+$/, '') + '…' : text;
    const isLong = text.length > limit;
    let open = false;
    const body = el('div', {
      class: collapsedClass,
      text: isLong && !open ? short : text,
    });
    if (!isLong) return body;
    const toggle = el('button', {
      class: 'btn sm ghost expandable-toggle',
      text: '展开',
      onclick: (e) => {
        e.stopPropagation();
        open = !open;
        body.textContent = open ? text : short;
        body.classList.toggle('is-open', open);
        toggle.textContent = open ? '收起' : '展开';
      },
    });
    return el('div', { class: 'expandable-wrap' }, [body, toggle]);
  }

  /** 展平 children（含 .map() 产生的嵌套数组），避免 appendChild(Array) 报错 */
  function flattenChildren(children, out = []) {
    if (children == null || children === false) return out;
    if (Array.isArray(children)) {
      for (const c of children) flattenChildren(c, out);
      return out;
    }
    out.push(children);
    return out;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'hidden') {
        node.hidden = !!v;
      } else if (v !== undefined && v !== null) {
        node.setAttribute(k, v);
      }
    }
    for (const child of flattenChildren(children)) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  /**
   * 绑定输入焦点 → 主进程 IME 安全模式
   * 解决 issues #4 / #9：输入法候选词被置顶面板遮挡
   */
  function bindImeSafe(root) {
    if (!root || !window.ling) return;
    const selector = 'input, textarea, [contenteditable="true"]';
    root.addEventListener(
      'focusin',
      (e) => {
        if (e.target && e.target.matches && e.target.matches(selector)) {
          window.ling.panel.inputFocus();
        }
      },
      true
    );
    root.addEventListener(
      'focusout',
      (e) => {
        if (e.target && e.target.matches && e.target.matches(selector)) {
          // 延迟，避免输入法窗口短暂 focus 切换导致误恢复
          setTimeout(() => {
            const active = document.activeElement;
            if (!active || !active.matches || !active.matches(selector)) {
              window.ling.panel.inputBlur();
            }
          }, 120);
        }
      },
      true
    );
  }

  global.LingUtil = { formatTime, formatDay, formatDuration, dueLabel, isOverdue, uid, debounce, el, flattenChildren, expandableText, bindImeSafe };
})(typeof window !== 'undefined' ? window : globalThis);
