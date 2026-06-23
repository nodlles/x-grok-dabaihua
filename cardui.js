// cardui.js —— 卡片的主题解析、定位、防截断、拖动。与 content.js 同处隔离世界,顶层声明即共享全局。

function resolveTheme(theme) {
  const t = theme || "graphite";
  if (t !== "auto") return t;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "graphite";
  } catch (_) {
    return "graphite";
  }
}

function positionCard(el, tweet) {
  const rect = tweet.getBoundingClientRect();
  const W = 360;
  const M = 8; // 边距
  el.style.width = W + "px";

  let left = rect.right + 12;
  if (left + W > window.innerWidth - M) left = Math.max(M, window.innerWidth - W - M);

  // 贴推文顶部,但保证底部至少留出 240px(否则上移),触底也不会被截
  let top = rect.top;
  top = Math.max(M, Math.min(top, window.innerHeight - 240 - M));

  el.style.left = left + "px";
  el.style.top = top + "px";

  // 高度封顶 = top 到视口底的空间,正文内部滚动
  const avail = window.innerHeight - top - M;
  el.style.maxHeight = avail + "px";
  const body = el.querySelector(".xdbh-card-body");
  if (body) body.style.maxHeight = Math.max(120, avail - 96) + "px";
}

// 测得真实高度后,把卡片夹进视口(底部触发时不被截断)。已拖动则不动它。
function clampCard(el) {
  if (!el || el.dataset.dragged) return;
  const M = 8;
  const h = el.offsetHeight;
  let top = parseFloat(el.style.top) || M;
  if (top + h > window.innerHeight - M) top = window.innerHeight - h - M;
  el.style.top = Math.max(M, top) + "px";
  let left = parseFloat(el.style.left) || M;
  const w = el.offsetWidth;
  if (left + w > window.innerWidth - M) left = window.innerWidth - w - M;
  el.style.left = Math.max(M, left) + "px";
}

// 拖动:按住标题栏拖。一旦拖过,就不再自动重定位。
function makeDraggable(el) {
  const head = el.querySelector(".xdbh-card-head");
  if (!head) return;
  head.addEventListener("mousedown", (e) => {
    if (e.target.closest(".xdbh-close")) return;
    e.preventDefault();
    el.dataset.dragged = "1";
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    const move = (ev) => {
      const M = 4;
      let nl = ev.clientX - ox;
      let nt = ev.clientY - oy;
      nl = Math.min(Math.max(M, nl), window.innerWidth - el.offsetWidth - M);
      nt = Math.min(Math.max(M, nt), window.innerHeight - el.offsetHeight - M);
      el.style.left = nl + "px";
      el.style.top = nt + "px";
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
}
