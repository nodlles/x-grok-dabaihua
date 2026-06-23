// render.js —— 纯函数:清洗 Grok 标签 + 极简安全 Markdown 渲染 + 引用角标 + 来源列表。
// 与 content.js 同处隔离世界,顶层函数声明即为共享全局,content.js 可直接调用。

function xdbhEscapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function xdbhEscapeAttr(s) {
  return xdbhEscapeHtml(s).replace(/"/g, "&quot;");
}
function xdbhSafeUrl(u) {
  return /^https?:\/\//i.test(u || "") ? u : "#";
}

// 把 Grok 自定义标签清洗成「带引用 token」的纯文本
function xdbhCleanGrok(s) {
  // <grok:render ... citation_id>6</...> → {{cite:6}} 占位
  s = s.replace(/<grok:render\b[^>]*>([\s\S]*?)<\/grok:render>/g, (m, inner) => {
    const id = (inner.match(/citation_id"?\s*>?\s*(\d+)/) || [])[1];
    return id ? " {{cite:" + id + "}}" : "";
  });
  s = s.replace(/<grok:render\b[\s\S]*$/g, ""); // 流式半截标签先藏
  s = s.replace(/<\/?xai:[^>]*>/g, "");
  s = s.replace(/^\s*[-•]\s*/, "");
  return s;
}

// 极简、安全的 Markdown 渲染(先转义,再处理子集)
function xdbhRenderMarkdown(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return " C" + (codes.length - 1) + " ";
  });
  s = xdbhEscapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (m, t, u) => `<a href="${xdbhEscapeAttr(xdbhSafeUrl(u))}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/^#{1,6}\s*(.+)$/gm, "<strong>$1</strong>");
  s = s.replace(/^&gt;\s?(.+)$/gm, '<span class="xdbh-quote">$1</span>');

  const lines = s.split(/\n/);
  let html = "", inUl = false, inOl = false;
  const close = () => {
    if (inUl) { html += "</ul>"; inUl = false; }
    if (inOl) { html += "</ol>"; inOl = false; }
  };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^\s*[-*]\s+(.+)$/))) {
      if (inOl) { html += "</ol>"; inOl = false; }
      if (!inUl) { html += "<ul>"; inUl = true; }
      html += "<li>" + m[1] + "</li>";
    } else if ((m = line.match(/^\s*\d+\.\s+(.+)$/))) {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (!inOl) { html += "<ol>"; inOl = true; }
      html += "<li>" + m[1] + "</li>";
    } else if (line.trim() === "") {
      close();
      html += "<br>";
    } else {
      close();
      html += line + "<br>";
    }
  }
  close();
  html = html.replace(/C(\d+)/g, (m, i) => "<code>" + xdbhEscapeHtml(codes[+i]) + "</code>");
  return html;
}

// 完整渲染:清洗 → markdown → 引用角标 → 来源列表
function xdbhRenderRich(raw, sources) {
  let html = xdbhRenderMarkdown(xdbhCleanGrok(raw));
  html = html.replace(/\{\{cite:(\d+)\}\}/g, (m, n) => {
    const src = sources && sources[+n - 1];
    const label = "[" + n + "]";
    if (src && src.url) {
      return `<sup class="xdbh-cite"><a href="${xdbhEscapeAttr(xdbhSafeUrl(src.url))}" target="_blank" rel="noopener noreferrer" title="${xdbhEscapeAttr(src.title || src.url)}">${label}</a></sup>`;
    }
    return `<sup class="xdbh-cite">${label}</sup>`;
  });
  if (sources && sources.length) {
    html += '<div class="xdbh-sources"><div class="xdbh-sources-h">📎 来源</div>';
    sources.forEach((s, i) => {
      if (!s.url) return;
      html += `<a class="xdbh-src" href="${xdbhEscapeAttr(xdbhSafeUrl(s.url))}" target="_blank" rel="noopener noreferrer">[${i + 1}] ${xdbhEscapeHtml(s.title || s.url)}</a>`;
    });
    html += "</div>";
  }
  return html;
}
