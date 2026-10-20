/**
 * 灵墨 LingMark — Markdown 渲染层
 *
 * 主路径：marked（GFM）+ DOMPurify（净化）。
 * 降级路径：两者缺失时走内置保守渲染，保证任何情况下都不会输出可执行脚本。
 */
(function (global) {
  const marked = global.marked;
  const DOMPurify = global.DOMPurify;

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 只放行安全协议，挡掉 javascript: / vbscript: 之类 */
  function safeUrl(href) {
    const s = String(href == null ? '' : href).trim();
    if (/^(javascript|vbscript|data:text\/html)/i.test(s)) return '#';
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:|^mailto:|^file:/i.test(s)) return '#';
    return s;
  }

  function slugify(text) {
    const s = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[`*_~[\]()#!]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '');
    return s || 'section';
  }

  let configured = false;
  function configure() {
    if (configured || !marked) return;
    configured = true;
    const renderer = new marked.Renderer();

    renderer.heading = function (text, level, raw) {
      const id = slugify(raw);
      return (
        `<h${level} id="${id}" class="md-h">${text}` +
        `<a class="md-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>` +
        `</h${level}>\n`
      );
    };

    renderer.code = function (code, infostring) {
      const lang = (infostring || '').match(/^\S*/)[0] || '';
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      return `<pre class="md-code"><code${cls}>${escapeHtml(code)}</code></pre>\n`;
    };

    renderer.link = function (href, title, text) {
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(safeUrl(href))}"${t} target="_blank" rel="noreferrer noopener">${text}</a>`;
    };

    renderer.image = function (href, title, text) {
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(safeUrl(href))}"${t} alt="${escapeHtml(text)}" loading="lazy" />`;
    };

    marked.use({ renderer, gfm: true, breaks: false });
  }

  /** 无 DOMPurify 时的保守净化：去脚本/样式/事件属性/危险协议 */
  function fallbackSanitize(html) {
    return String(html)
      .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, '')
      .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
      .replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript):[^"']*\2/gi, '$1=$2#$2');
  }

  let purifyHooked = false;
  function hookPurify() {
    if (purifyHooked || !DOMPurify || !DOMPurify.addHook) return;
    purifyHooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      // 任务清单要可点，marked 默认会加 disabled
      if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') {
        node.removeAttribute('disabled');
      }
      // style 只放行表格对齐；其余一律丢弃，
      // 避免恶意文档用 position:fixed 覆盖界面
      const style = node.getAttribute && node.getAttribute('style');
      if (style) {
        const m = style.match(/text-align\s*:\s*(left|center|right)/i);
        if (m) node.setAttribute('style', `text-align:${m[1].toLowerCase()}`);
        else node.removeAttribute('style');
      }
    });
  }

  function sanitize(html) {
    hookPurify();
    if (DOMPurify && DOMPurify.sanitize) {
      return DOMPurify.sanitize(String(html), {
        ADD_ATTR: ['target', 'loading', 'id', 'checked', 'type'],
        FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'link', 'meta'],
        FORBID_ATTR: ['style'],
      });
    }
    return fallbackSanitize(html);
  }

  /**
   * 渲染 Markdown → HTML 字符串
   * @param {string} md
   * @param {{inline?:boolean, sanitize?:boolean}} [opts]
   */
  function renderMarkdown(md, opts = {}) {
    const source = String(md == null ? '' : md);
    if (!source.trim()) return '';
    configure();
    if (!marked) return fallbackSanitize(escapeHtml(source).replace(/\n/g, '<br />'));
    let html;
    try {
      html = opts.inline ? marked.parseInline(source) : marked.parse(source);
    } catch (err) {
      console.error('[lingmark] markdown render failed', err);
      return `<p>${escapeHtml(source)}</p>`;
    }
    return opts.sanitize === false ? html : sanitize(html);
  }

  function renderInline(text) {
    return renderMarkdown(text, { inline: true });
  }

  /**
   * 提取标题大纲（跳过围栏代码块内的 # 号）
   * @returns {{level:number,text:string,line:number,slug:string}[]}
   */
  function extractOutline(md) {
    const lines = String(md == null ? '' : md).split('\n');
    const out = [];
    let inFence = false;
    let fenceMark = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (!inFence) {
          inFence = true;
          fenceMark = fence[1][0];
        } else if (fence[1][0] === fenceMark) {
          inFence = false;
        }
        continue;
      }
      if (inFence) continue;
      const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (m) {
        const text = m[2].trim();
        out.push({ level: m[1].length, text, line: i, slug: slugify(text) });
      }
    }
    return out;
  }

  /**
   * 源码里的任务清单条目（与预览里的 checkbox 顺序一致）
   * @returns {{line:number,checked:boolean,text:string}[]}
   */
  function extractTasks(md) {
    const lines = String(md == null ? '' : md).split('\n');
    const out = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
      if (m) out.push({ line: i, checked: m[2].toLowerCase() === 'x', text: m[3].trim() });
    }
    return out;
  }

  /** 统计字数：中文按字、英文按词 */
  function countWords(md) {
    const s = String(md == null ? '' : md);
    const cjk = (s.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
    const latin = (s.match(/[A-Za-z0-9_]+/g) || []).length;
    return { chars: s.length, cjk, words: latin, total: cjk + latin };
  }

  /** 独立 HTML 导出模板 */
  function exportHtml(md, title) {
    const bodyHtml = renderMarkdown(md);
    const safeTitle = escapeHtml(title || '未命名');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 40px 24px; font: 16px/1.75 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
         color: #1a1f2a; background: #fff; }
  .wrap { max-width: 780px; margin: 0 auto; }
  pre.md-code { background: #f4f6fa; padding: 14px 16px; border-radius: 10px; overflow: auto; }
  code { font-family: "Cascadia Code", Consolas, monospace; font-size: .92em; }
  pre.md-code code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: .2em 1em; border-left: 3px solid #c9d2e3; color: #55607a; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #dde3ec; padding: 8px 10px; text-align: left; }
  th { background: #f7f9fc; }
  img { max-width: 100%; }
  .md-anchor { display: none; }
  @media (prefers-color-scheme: dark) {
    body { color: #e8ecf4; background: #111418; }
    pre.md-code { background: #1b2029; }
    th { background: #1b2029; }
    th, td { border-color: #2b323d; }
    blockquote { border-color: #3a4250; color: #9aa3b5; }
  }
</style>
</head>
<body><div class="wrap">
${bodyHtml}
</div></body>
</html>`;
  }

  global.LingMarkdown = {
    renderMarkdown,
    renderInline,
    escapeHtml,
    safeUrl,
    slugify,
    sanitize,
    extractOutline,
    extractTasks,
    countWords,
    exportHtml,
    hasMarked: !!marked,
    hasPurify: !!DOMPurify,
  };
})(typeof window !== 'undefined' ? window : globalThis);
