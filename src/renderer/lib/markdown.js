/**
 * 轻量 Markdown 渲染器 — 解决原项目 issue #8「笔记没有支持 Markdown」
 * 支持：标题、粗斜体、删除线、行内代码、代码块、引用、列表、链接、图片、表格、水平线
 */
(function (global) {
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(src) {
    let text = escapeHtml(src);
    // images
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img alt="$1" src="$2" />');
    // links
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    // bold / italic / strike / code
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    return text;
  }

  function renderMarkdown(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let i = 0;
    let inCode = false;
    let codeLang = '';
    let codeBuf = [];
    let listType = null; // 'ul' | 'ol'
    let listBuf = [];
    let tableBuf = [];

    function flushList() {
      if (!listType) return;
      const tag = listType;
      const items = listBuf
        .map((line) => {
          const content = line.replace(/^([-*+]|\d+\.)\s+/, '');
          return `<li>${renderInline(content)}</li>`;
        })
        .join('');
      html.push(`<${tag}>${items}</${tag}>`);
      listType = null;
      listBuf = [];
    }

    function flushTable() {
      if (!tableBuf.length) return;
      const rows = tableBuf.map((r) =>
        r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      );
      if (rows.length >= 2) {
        const head = rows[0];
        const body = rows.slice(2); // skip separator
        const thead = `<tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr>`;
        const tbody = body
          .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
          .join('');
        html.push(`<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`);
      }
      tableBuf = [];
    }

    while (i < lines.length) {
      const line = lines[i];

      if (inCode) {
        if (/^```/.test(line.trim())) {
          html.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
          inCode = false;
          codeBuf = [];
          codeLang = '';
        } else {
          codeBuf.push(line);
        }
        i += 1;
        continue;
      }

      const codeOpen = line.match(/^```([\w-]*)\s*$/);
      if (codeOpen) {
        flushList();
        flushTable();
        inCode = true;
        codeLang = codeOpen[1] || '';
        codeBuf = [];
        i += 1;
        continue;
      }

      if (/^\s*$/.test(line)) {
        flushList();
        flushTable();
        i += 1;
        continue;
      }

      if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
        flushList();
        flushTable();
        html.push('<hr />');
        i += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushList();
        flushTable();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushList();
        flushTable();
        const buf = [];
        while (i < lines.length) {
          const m = lines[i].match(/^>\s?(.*)$/);
          if (!m) break;
          buf.push(m[1]);
          i += 1;
        }
        html.push(`<blockquote>${renderInline(buf.join(' '))}</blockquote>`);
        continue;
      }

      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        flushTable();
        const isOrdered = /^\s*\d+\./.test(line);
        const nextType = isOrdered ? 'ol' : 'ul';
        if (listType && listType !== nextType) flushList();
        listType = nextType;
        listBuf.push(line);
        i += 1;
        continue;
      }

      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
        flushList();
        tableBuf.push(line);
        i += 1;
        while (i < lines.length && lines[i].includes('|')) {
          tableBuf.push(lines[i]);
          i += 1;
        }
        flushTable();
        continue;
      }

      flushList();
      flushTable();
      // paragraph: merge consecutive plain lines
      const para = [line];
      i += 1;
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^```/.test(lines[i]) &&
        !/^#{1,6}\s/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
        !/^---+\s*$/.test(lines[i])
      ) {
        para.push(lines[i]);
        i += 1;
      }
      html.push(`<p>${renderInline(para.join(' '))}</p>`);
    }

    if (inCode) {
      html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
    }
    flushList();
    flushTable();
    return html.join('\n');
  }

  global.LingMarkdown = { renderMarkdown, escapeHtml };
})(typeof window !== 'undefined' ? window : globalThis);
