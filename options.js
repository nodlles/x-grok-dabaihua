// options.js —— 设置页逻辑
const DEFAULTS = {
  enabled: true,
  mode: "grok",
  hoverDelay: 1200,
  capture: true,
  hideDrawer: true,
  drawerSelector: "",
  theme: "graphite",
  prompt:
    "用大白话、口语化的中文解释下面这条推文在讲什么,必要时补一句背景。别复述原文,直接说人话:",
};

const $ = (id) => document.getElementById(id);
let settings = { ...DEFAULTS };

function applyToUI() {
  $("enabled").checked = settings.enabled;
  $("capture").checked = settings.capture;
  $("hideDrawer").checked = settings.hideDrawer;
  $("drawerSelector").value = settings.drawerSelector || "";
  $("theme").value = settings.theme || "graphite";
  $("delay").value = settings.hoverDelay;
  $("delayVal").textContent = (settings.hoverDelay / 1000).toFixed(1) + " 秒";
  $("prompt").value = settings.prompt;
  $("m-grok").classList.toggle("on", settings.mode === "grok");
  $("m-demo").classList.toggle("on", settings.mode === "demo");
  $("m-learn").classList.toggle("on", settings.mode === "learn");
}

function save(showTip) {
  chrome.storage.local.set({ settings }, () => {
    if (showTip) {
      const s = $("saved");
      s.classList.add("show");
      setTimeout(() => s.classList.remove("show"), 1200);
    }
  });
}

// 加载
chrome.storage.local.get("settings", (res) => {
  settings = { ...DEFAULTS, ...(res.settings || {}) };
  applyToUI();
  renderCaptures();
});

// 控件事件
$("enabled").onchange = (e) => { settings.enabled = e.target.checked; save(); };
$("capture").onchange = (e) => { settings.capture = e.target.checked; save(); };
$("hideDrawer").onchange = (e) => { settings.hideDrawer = e.target.checked; save(true); };
$("drawerSelector").onchange = (e) => { settings.drawerSelector = e.target.value; save(true); };
$("theme").onchange = (e) => { settings.theme = e.target.value; save(true); };
$("delay").oninput = (e) => {
  settings.hoverDelay = +e.target.value;
  $("delayVal").textContent = (settings.hoverDelay / 1000).toFixed(1) + " 秒";
};
$("delay").onchange = () => save();
$("m-grok").onclick = () => { settings.mode = "grok"; applyToUI(); save(true); };
$("m-demo").onclick = () => { settings.mode = "demo"; applyToUI(); save(true); };
$("m-learn").onclick = () => { settings.mode = "learn"; applyToUI(); save(true); };
$("save").onclick = () => { settings.prompt = $("prompt").value; save(true); };

// ---------- 捕获列表 ----------
function renderCaptures() {
  chrome.storage.local.get("captures", (res) => {
    const list = res.captures || [];
    const box = $("caps");
    if (!list.length) {
      box.innerHTML = '<div class="empty">还没有捕获到任何 Grok 请求。</div>';
      return;
    }
    box.innerHTML = "";
    list.forEach((c) => {
      const div = document.createElement("div");
      div.className = "cap";
      const t = new Date(c.ts || Date.now()).toLocaleString("zh-CN");
      div.innerHTML =
        `<span class="m">${escapeHtml(c.method || "")}</span> ` +
        `<span class="u">${escapeHtml(c.url || "")}</span>\n` +
        `时间: ${t} · 响应长度: ${c.respLen || 0}\n` +
        `--- 请求体 ---\n${escapeHtml((c.reqBody || "(空)").slice(0, 1500))}\n` +
        `--- 响应样本 ---\n${escapeHtml((c.respSample || "(空)").slice(0, 1500))}`;
      box.appendChild(div);
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

$("copy").onclick = () => {
  chrome.storage.local.get("captures", (res) => {
    const json = JSON.stringify(res.captures || [], null, 2);
    navigator.clipboard.writeText(json).then(() => {
      const b = $("copy");
      const old = b.textContent;
      b.textContent = "已复制 ✓";
      setTimeout(() => (b.textContent = old), 1200);
    });
  });
};

$("clear").onclick = () => {
  chrome.storage.local.set({ captures: [] }, renderCaptures);
};

// 捕获实时刷新
chrome.storage.onChanged.addListener((changes) => {
  if (changes.captures) renderCaptures();
});
