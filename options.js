// options.js —— 设置页逻辑。依赖先加载的 aiconfig.js（服务注册表 / 专家 / 模板）。
const $ = (id) => document.getElementById(id);
const MODE_BTNS = { grok: $("m-grok"), api: $("m-api"), demo: $("m-demo"), learn: $("m-learn") };
const MODE_LABEL = { grok: "Grok", api: "第三方 API", demo: "演示", learn: "学习" };
// 引擎对「不适用」的服务字段与状态的措辞。
const MODE_STATE = {
  grok: { service: "用不上", note: "复用你在 X 的 Grok 登录态" },
  api: { service: "", note: "" },
  demo: { service: "用不上", note: "只演示界面，不发任何请求" },
  learn: { service: "用不上", note: "只抓请求结构，不出解读" },
};

// 设置结构由 aiconfig.js 归一化：services / experts 列表 + 各自的活动 id，
// settings.prompt 是「当前专家提示词」的派生值，保持向后兼容。
let settings = xdbhNormalizeSettings();

function isPresetService(id) {
  return XDBH_SERVICE_PRESETS.some((preset) => preset.id === id);
}

function activeExpert() {
  return xdbhActiveExpert(settings);
}

function activeService() {
  return xdbhActiveService(settings);
}

function flashSaved() {
  const s = $("saved");
  s.classList.add("show");
  setTimeout(() => s.classList.remove("show"), 1200);
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

// 抬头那一行「现在会怎样」的摘要，省得用户来回翻设置猜。
function renderStatus() {
  const expert = activeExpert();
  const service = activeService();
  const state = MODE_STATE[settings.mode] || { service: "用不上", note: "" };
  setText("st-engine", MODE_LABEL[settings.mode] || settings.mode);
  setText("st-expert", expert ? (expert.emoji ? expert.emoji + " " + expert.name : expert.name) : "—");
  setText("st-service", settings.mode === "api" ? (service ? service.name : "未选择") : state.service);
  const missing = settings.mode === "api" ? xdbhServiceReady(service) : "";
  setText("st-ready", settings.mode === "api" ? (missing || "接口就绪") : state.note || "—");
  const chip = $("st-note");
  if (chip) {
    const dot = settings.mode === "grok" ? " live" : settings.mode === "api" ? (missing ? " wait" : " live") : "";
    chip.className = "chip" + dot;
  }
}

// 版本号是从 manifest 读的，读不到就留空（设置页打开时永远读得到）。
function renderBuild() {
  const el = $("build");
  if (!el) return;
  try {
    const manifest = chrome.runtime.getManifest();
    if (manifest && manifest.version) el.textContent = "v" + manifest.version;
  } catch (_) {}
}

function save(showTip) {
  // prompt 始终跟随当前专家，兜住任何忘记同步的路径。
  settings.prompt = (activeExpert() || {}).prompt || "";
  chrome.storage.local.set({ settings }, () => {
    if (showTip) flashSaved();
  });
}

// ---------- 渲染：基本设置 ----------
function applyBasicUI() {
  $("enabled").checked = settings.enabled;
  $("capture").checked = settings.capture;
  $("hideDrawer").checked = settings.hideDrawer;
  $("drawerSelector").value = settings.drawerSelector || "";
  $("theme").value = settings.theme || "graphite";
  $("delay").value = settings.hoverDelay;
  $("delayVal").textContent = (settings.hoverDelay / 1000).toFixed(1) + " 秒";
  for (const [mode, btn] of Object.entries(MODE_BTNS)) {
    const on = settings.mode === mode;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

// ---------- 渲染：解读专家 ----------
function renderExpertSelect() {
  const select = $("expertSelect");
  select.innerHTML = "";
  settings.experts.forEach((expert) => {
    const option = document.createElement("option");
    option.value = expert.id;
    option.textContent = (expert.emoji ? expert.emoji + " " : "") + expert.name;
    select.appendChild(option);
  });
  select.value = (activeExpert() || {}).id || "";
}

function renderExpertFields() {
  const expert = activeExpert();
  if (!expert) return;
  $("expertDesc").textContent = expert.desc || "";
  $("expertPrompt").value = expert.prompt || "";
  renderPreview();
}

function renderPreview() {
  const expert = activeExpert();
  const service = activeService();
  const preview = xdbhRenderTemplate((expert && expert.prompt) || "", {
    text: "（这里会自动填入推文正文）",
    url: "https://x.com/linzhiyuan/status/1845162903774826497",
    author: "林知远",
    handle: "@linzhiyuan",
    date: "2026-03-14T01:12:00.000Z",
    title: "把 12 万行代码挪到 Rust 之后",
    expert: expert ? expert.name : "",
    service: service ? service.name : "",
    model: service ? service.model : "",
    site: "x.com",
  });
  $("promptPreview").textContent = preview;
}

// ---------- 渲染：AI 服务 ----------
function renderServiceSelect() {
  const select = $("serviceSelect");
  select.innerHTML = "";
  settings.services.forEach((service) => {
    const option = document.createElement("option");
    option.value = service.id;
    option.textContent = service.name + (isPresetService(service.id) ? "" : "（自定义）");
    select.appendChild(option);
  });
  select.value = (activeService() || {}).id || "";
}

const SERVICE_FIELD_IDS = ["svcName", "svcUrl", "svcKey", "svcModel", "svcTemp", "svcSystem"];

function renderServiceFields() {
  const service = activeService();
  const has = !!service;
  SERVICE_FIELD_IDS.forEach((id) => { $(id).disabled = !has; });
  $("svcDelete").disabled = !has || isPresetService(service.id);
  if (!has) return;
  $("svcName").value = service.name;
  $("svcUrl").value = service.apiUrl;
  $("svcKey").value = service.apiKey;
  $("svcModel").value = service.model;
  $("svcTemp").value = service.temperature;
  $("svcSystem").value = service.systemPrompt;
}

// 把表单写回当前服务对象；不触发保存，调用方决定何时 save()。
function readServiceFields() {
  const service = activeService();
  if (!service) return null;
  service.name = $("svcName").value.trim() || "未命名服务";
  service.apiUrl = $("svcUrl").value.trim();
  service.apiKey = $("svcKey").value;
  service.model = $("svcModel").value.trim();
  service.temperature = xdbhClampTemperature($("svcTemp").value);
  service.systemPrompt = $("svcSystem").value;
  return service;
}

function setNote(text, kind) {
  const note = $("svcNote");
  note.textContent = text || "";
  note.className = "note" + (kind ? " " + kind : "");
}

function applyToUI() {
  applyBasicUI();
  renderExpertSelect();
  renderExpertFields();
  renderServiceSelect();
  renderServiceFields();
  renderStatus();
}

// ---------- 加载 ----------
chrome.storage.local.get("settings", (res) => {
  settings = xdbhNormalizeSettings(res && res.settings);
  applyToUI();
  renderBuild();
  setupRail();
  renderCaptures();
});

// 左侧分区导航：滚动到哪一段就把哪一段标亮。
function setupRail() {
  if (typeof document.querySelectorAll !== "function") return;
  const links = Array.from(document.querySelectorAll(".rail a"));
  if (!links.length) return;
  const sections = links
    .map((a) => document.getElementById(String(a.getAttribute("href") || "").slice(1)))
    .filter(Boolean);
  if (!sections.length) return;
  const mark = (id) => links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + id));
  if (typeof IntersectionObserver === "function") {
    const spy = new IntersectionObserver((entries) => {
      const top = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) mark(top.target.id);
    }, { rootMargin: "-12% 0px -72% 0px" });
    sections.forEach((section) => spy.observe(section));
  }
  mark(sections[0].id);
}

// ---------- 基本设置事件 ----------
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
for (const [mode, btn] of Object.entries(MODE_BTNS)) {
  btn.onclick = () => { settings.mode = mode; applyBasicUI(); renderStatus(); save(true); };
}

// ---------- 专家事件 ----------
$("expertSelect").onchange = (e) => {
  settings.activeExpertId = e.target.value;
  renderExpertFields();
  renderStatus();
  save(true);
};

$("expertPrompt").oninput = (e) => {
  const expert = activeExpert();
  if (!expert) return;
  expert.prompt = e.target.value;
  settings.prompt = e.target.value;
  renderPreview();
  save(false); // 静默保存，避免每敲一个字都闪提示
};
$("expertPrompt").onchange = () => save(true);

$("expertReset").onclick = () => {
  const expert = activeExpert();
  if (!expert) return;
  const preset = XDBH_EXPERTS.find((item) => item.id === expert.id);
  if (!preset) {
    setNote("这个专家没有内置默认提示词。", "bad");
    return;
  }
  expert.prompt = preset.prompt;
  settings.prompt = preset.prompt;
  renderExpertFields();
  save(true);
};

// ---------- 服务事件 ----------
$("serviceSelect").onchange = (e) => {
  settings.activeServiceId = e.target.value;
  setNote("");
  renderServiceFields();
  renderStatus();
  save(true);
};

SERVICE_FIELD_IDS.forEach((id) => {
  $(id).oninput = () => { readServiceFields(); renderServiceSelect(); renderStatus(); save(false); };
  $(id).onchange = () => { readServiceFields(); renderServiceSelect(); renderStatus(); save(true); };
});

$("svcAdd").onclick = () => {
  const service = {
    id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: "我的服务",
    apiUrl: "",
    apiKey: "",
    model: "",
    temperature: 0.3,
    systemPrompt: XDBH_DEFAULT_SYSTEM_PROMPT,
  };
  settings.services.push(service);
  settings.activeServiceId = service.id;
  setNote("已新增服务，填好地址与 Key 后点「保存并授权域名」。");
  renderServiceSelect();
  renderServiceFields();
  renderStatus();
  $("svcName").focus();
  save(true);
};

$("svcDelete").onclick = () => {
  const service = activeService();
  if (!service) return;
  if (isPresetService(service.id)) {
    setNote("内置服务不能删除，可以改地址或另建一个自定义服务。", "bad");
    return;
  }
  settings.services = settings.services.filter((item) => item.id !== service.id);
  settings.activeServiceId = (settings.services[0] || {}).id || XDBH_DEFAULT_SERVICE_ID;
  setNote("已删除「" + service.name + "」。");
  renderServiceSelect();
  renderServiceFields();
  renderStatus();
  save(true);
};

// 在点击回调里同步申请域名权限（用户手势，必须先于任何 await）。
// 返回是否已获授权；不支持 permissions API 时视为放行（由后台的失败信息兜底）。
function requestOrigin(service, done) {
  const pattern = service && service.apiUrl ? xdbhOriginPattern(service.apiUrl) : "";
  const permissions = chrome.permissions;
  if (!pattern || !permissions || typeof permissions.request !== "function") {
    done(true);
    return;
  }
  let pending;
  try {
    pending = permissions.request({ origins: [pattern] });
  } catch (_) {
    done(false);
    return;
  }
  Promise.resolve(pending).then(
    (granted) => done(granted !== false),
    () => done(false)
  );
}

function testConnection(service) {
  setNote("正在测试连接…");
  let replied = false;
  try {
    chrome.runtime.sendMessage({ type: "xdbh-api-test", service }, (res) => {
      if (chrome.runtime.lastError) {
        setNote("后台没有响应：" + chrome.runtime.lastError.message, "bad");
        return;
      }
      replied = true;
      if (res && res.ok) setNote("连接成功，模型可用 ✓", "ok");
      else setNote("连接失败：" + ((res && res.error) || "未知错误"), "bad");
    });
  } catch (error) {
    setNote("没能联系扩展后台：" + String(error && error.message || error), "bad");
    return;
  }
  setTimeout(() => {
    if (!replied) setNote("测试超时，请检查网络或接口地址。", "bad");
  }, 35000);
}

$("svcSave").onclick = () => {
  const service = readServiceFields();
  renderServiceSelect();
  save(true);
  if (!service) return;
  requestOrigin(service, (granted) => {
    if (granted) setNote("已保存，并已授权 " + service.apiUrl + " 的访问权限。", "ok");
    else setNote("已保存，但未授权域名权限，请求会被浏览器拦截。", "bad");
  });
};

$("svcTest").onclick = () => {
  const service = readServiceFields();
  renderServiceSelect();
  save();
  if (!service) return;
  const missing = xdbhServiceReady(service);
  if (missing) {
    setNote("还不能测试：" + missing, "bad");
    return;
  }
  setNote("正在申请域名权限…");
  requestOrigin(service, (granted) => {
    if (!granted) {
      setNote("未授权 " + xdbhOriginPattern(service.apiUrl) + "，无法发起请求。", "bad");
      return;
    }
    testConnection(service);
  });
};

// ---------- 捕获列表 ----------
function renderCaptures() {
  chrome.storage.local.get("captures", (res) => {
    const list = res && res.captures || [];
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
    const json = JSON.stringify(res && res.captures || [], null, 2);
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

// 捕获实时刷新（只关心 captures，别把本页自己写的 settings 又渲染回去）。
chrome.storage.onChanged.addListener((changes) => {
  if (changes.captures) renderCaptures();
});
