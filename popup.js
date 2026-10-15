// popup.js —— 工具栏弹窗逻辑。依赖先加载的 aiconfig.js。
// 只读 `settings` 并报当前状态；除了「启用插件」这一个开关，改配置都去设置页。
const $ = (id) => document.getElementById(id);
const MODE_LABEL = { grok: "Grok", api: "第三方 API", demo: "演示", learn: "学习" };
// 这里只挑弹窗里要显示的一行，措辞跟设置页抬头保持一致。
const MODE_STATE = {
  grok: { service: "用不上", note: "复用你在 X 的 Grok 登录态", dot: "live" },
  api: { service: "", note: "", dot: "" },
  demo: { service: "用不上", note: "只演示界面，不发请求", dot: "" },
  learn: { service: "用不上", note: "只抓请求结构，不出解读", dot: "" },
};

let settings = null;

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function renderBuild() {
  const el = $("build");
  if (!el) return;
  try {
    const manifest = chrome.runtime.getManifest();
    if (manifest && manifest.version) el.textContent = "v" + manifest.version;
  } catch (_) {}
}

function render() {
  const expert = xdbhActiveExpert(settings);
  const service = xdbhActiveService(settings);
  const state = MODE_STATE[settings.mode] || { service: "用不上", note: "", dot: "" };
  const missing = settings.mode === "api" ? xdbhServiceReady(service) : "";

  setText("f-engine", MODE_LABEL[settings.mode] || settings.mode);
  setText("f-expert", expert ? (expert.emoji ? expert.emoji + " " + expert.name : expert.name) : "—");
  setText("f-service", settings.mode === "api" ? (service ? service.name : "未选择") : state.service);

  const dot = $("f-dot");
  const status = $("f-status");
  if (!settings.enabled) {
    setText("f-status-text", "已暂停，悬停不再解读");
    if (dot) dot.className = "dot";
    if (status) status.classList.remove("wait");
  } else if (missing) {
    setText("f-status-text", missing);
    if (dot) dot.className = "dot wait";
    if (status) status.classList.add("wait");
  } else {
    setText("f-status-text", settings.mode === "api" ? "接口就绪" : state.note || "—");
    if (dot) dot.className = "dot" + (state.dot ? " " + state.dot : "");
    if (status) status.classList.remove("wait");
  }

  const hint = $("hint");
  if (hint) {
    const spot = missing
      ? missing + "，点上面的按钮去设置页补上。"
      : settings.mode === "api"
        ? "引擎、专家、接口地址都在设置页里改。"
        : "想换引擎、专家或接第三方 API，都在设置页里改。";
    hint.textContent = spot;
    hint.classList.toggle("wait", !!missing);
  }

  document.body.classList.toggle("off", !settings.enabled);
}

function saveEnabled(enabled) {
  settings.enabled = enabled;
  render();
  chrome.storage.local.set({ settings });
}

function init() {
  renderBuild();
  chrome.storage.local.get("settings", (data) => {
    settings = xdbhNormalizeSettings(data && data.settings);
    $("enabled").checked = settings.enabled;
    render();
  });
  $("enabled").addEventListener("change", (event) => saveEnabled(event.target.checked));
  $("open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    // 设置页会占住前台，弹窗留在那里反而挡着，关掉更干净。
    if (typeof window !== "undefined" && window.close) window.close();
  });
}

init();
