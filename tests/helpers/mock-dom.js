function createMockDom() {
  class Node {
    constructor(type) {
      this.nodeType = type;
      this.childNodes = [];
      this.parentNode = null;
      this._listeners = {};
    }
    appendChild(child) {
      if (child == null || typeof child !== 'object' || (child.nodeType !== 1 && child.nodeType !== 3)) {
        throw new TypeError('parameter 1 is not of type "Node".');
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
    }
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    removeEventListener() {}
    dispatch(type, event) {
      for (const fn of this._listeners[type] || []) fn(event);
    }
    setAttribute(k, v) {
      this[k] = v;
    }
    matches() {
      return false;
    }
    closest() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = null; }
    remove() {
      if (this === document.activeElement || collect(this, []).includes(document.activeElement)) document.activeElement = null;
      if (this.parentNode) {
        const i = this.parentNode.childNodes.indexOf(this);
        if (i >= 0) this.parentNode.childNodes.splice(i, 1);
        this.parentNode = null;
      }
    }
    /** 按 '.class' 递归查找；'#id' 走 id */
    querySelector(sel) {
      const all = [];
      collect(this, all);
      const s = String(sel);
      if (s.startsWith('.')) {
        const cls = s.slice(1);
        return all.find((n) => String(n.className || '').split(/\s+/).includes(cls)) || null;
      }
      if (s.startsWith('#')) return all.find((n) => n.id === s.slice(1)) || null;
      return all.find((n) => String(n.tagName || '').toLowerCase() === s.toLowerCase()) || null;
    }
  }

  function collect(node, out) {
    for (const c of node.childNodes || []) {
      if (c.nodeType === 1) {
        out.push(c);
        collect(c, out);
      }
    }
    return out;
  }

  class Element extends Node {
    constructor(tag) {
      super(1);
      this.tagName = String(tag).toUpperCase();
      this.className = '';
      this.style = {};
      this.hidden = false;
      this.value = '';
      this.checked = false;
      this._classes = new Set();
      this.dataset = {};
      const self = this;
      this.classList = {
        add(c) {
          self._classes.add(c);
          self.className = [...self._classes].join(' ');
        },
        remove(c) {
          self._classes.delete(c);
          self.className = [...self._classes].join(' ');
        },
        contains(c) {
          return self._classes.has(c);
        },
        toggle(c, force) {
          const want = force === undefined ? !self._classes.has(c) : !!force;
          if (want) self._classes.add(c);
          else self._classes.delete(c);
          self.className = [...self._classes].join(' ');
          return want;
        },
      };
    }
    set textContent(v) {
      this._text = v;
      this.childNodes = [];
    }
    get textContent() {
      return this._text != null ? this._text : this.childNodes.map((c) => c.textContent).join('');
    }
    set innerHTML(v) {
      this._html = v;
      this.childNodes = [];
    }
    get innerHTML() {
      return this._html || '';
    }
  }

  class Text extends Node {
    constructor(data) {
      super(3);
      this.data = data;
    }
    get textContent() {
      return this.data;
    }
  }

  const body = new Element('body');
  const document = {
    createElement: (tag) => new Element(tag),
    createTextNode: (data) => new Text(data),
    getElementById: (id) => body.querySelector('#' + id),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    // applyMood 会写 documentElement.style 上的 CSS 变量
    documentElement: { style: { setProperty: () => {} } },
    body,
    activeElement: null,
  };

  return { document, Element, Text, Node, collect };
}

module.exports = { createMockDom };
