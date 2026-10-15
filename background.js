// background.js —— MV3 Service Worker：代理第三方 AI 请求。
//
// 内容脚本跑在页面源里，受 CORS 约束，直连 api.openai.com 这类不带
// Access-Control-Allow-Origin 的接口会被浏览器拦掉。所以请求改在扩展后台发，
// 只要求用户对目标域名授权（manifest 里的 optional_host_permissions，按需申请）。
// 后台只做「转发 + 解析流」，不持有任何密钥副本：服务配置随消息传入，用完即弃。

importScripts("aiconfig.js");

const XDBH_API_TIMEOUT_MS = 120000;
const XDBH_TEST_TIMEOUT_MS = 30000;

function xdbhSeconds(ms) {
  return Math.round(ms / 1000);
}

function xdbhApiErrorMessage(error, timeoutMs) {
  if (!error) return "请求失败";
  if ((error.name || "") === "AbortError") {
    return "请求超过 " + xdbhSeconds(timeoutMs || XDBH_API_TIMEOUT_MS) + " 秒未完成，已中止";
  }
  const raw = String(error.message || error);
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "连不上接口地址：检查网址是否正确，以及是否已在设置页授权该域名";
  }
  return raw.slice(0, 400);
}

function xdbhApiHeaders(service) {
  const headers = { "Content-Type": "application/json" };
  if (service.apiKey) headers.Authorization = "Bearer " + service.apiKey;
  return headers;
}

function xdbhApiBody(service, messages, stream) {
  const body = { model: service.model, messages: messages, stream: stream };
  if (typeof service.temperature === "number") body.temperature = service.temperature;
  return JSON.stringify(body);
}

// 同时吃流式 delta 和一次性 message 两种返回形状。
function xdbhDeltaText(payload) {
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  if (!choice || typeof choice !== "object") return { text: "", status: "" };
  const piece = choice.delta || choice.message || {};
  let text = "";
  if (typeof piece.content === "string") text = piece.content;
  else if (Array.isArray(piece.content)) {
    text = piece.content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("");
  }
  let status = "";
  if (typeof piece.reasoning_content === "string") status = piece.reasoning_content;
  else if (typeof piece.reasoning === "string") status = piece.reasoning;
  return { text: text, status: status };
}

function xdbhHttpError(status, text) {
  let detail = String(text || "").trim();
  try {
    const parsed = JSON.parse(detail);
    const error = parsed && parsed.error;
    const message = error && (error.message || error.msg || error);
    if (typeof message === "string" && message) detail = message;
  } catch (_) {}
  const known = {
    401: "API Key 无效或没有权限",
    403: "没有权限访问该模型",
    404: "接口地址不存在",
    429: "触发限流或额度不足",
    500: "接口内部错误",
    502: "接口网关错误",
    503: "服务暂不可用",
  };
  const head = known[status] || "接口返回错误";
  return head + "（HTTP " + status + "）" + (detail ? "：" + detail.slice(0, 200) : "");
}

function xdbhParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function xdbhCallApi(service, messages, options) {
  const settings = options || {};
  const stream = settings.stream !== false;
  const response = await fetch(service.apiUrl, {
    method: "POST",
    headers: xdbhApiHeaders(service),
    body: xdbhApiBody(service, messages, stream),
    signal: settings.signal,
  });
  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch (_) {}
    throw new Error(xdbhHttpError(response.status, text));
  }
  if (settings.onStart) settings.onStart();
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!stream || !response.body || type.includes("application/json")) {
    const parsed = xdbhDeltaText(xdbhParseJson(await response.text()));
    if (parsed.text && settings.onChunk) settings.onChunk(parsed.text);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (!data || data === "[DONE]") return;
    const parsed = xdbhDeltaText(xdbhParseJson(data));
    if (parsed.text) {
      if (settings.onChunk) settings.onChunk(parsed.text);
    } else if (parsed.status && settings.onStatus) {
      settings.onStatus("思考中…");
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  }
  if (buffer.trim()) handleLine(buffer);
}

// ---------- 内容脚本：流式转发 ----------
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "xdbh-api") return;
  const state = { controller: null };
  port.onDisconnect.addListener(() => {
    if (state.controller) state.controller.abort();
    state.controller = null;
  });
  port.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "abort") {
      if (state.controller) state.controller.abort();
      return;
    }
    if (message.type !== "start") return;
    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    const post = (payload) => {
      try {
        port.postMessage(payload);
      } catch (_) {}
    };
    const missing = xdbhServiceReady(message.service);
    if (missing) {
      post({ type: "error", error: missing });
      return;
    }
    state.controller = controller;
    const timer = setTimeout(() => controller.abort(), XDBH_API_TIMEOUT_MS);
    xdbhCallApi(message.service, message.messages || [], {
      stream: message.stream !== false,
      signal: controller.signal,
      onStart: () => post({ type: "start" }),
      onChunk: (text) => post({ type: "chunk", text: text }),
      onStatus: (text) => post({ type: "status", text: text }),
    })
      .then(() => post({ type: "done" }))
      .catch((error) => post({ type: "error", error: xdbhApiErrorMessage(error, XDBH_API_TIMEOUT_MS) }))
      .finally(() => {
        clearTimeout(timer);
        if (state.controller === controller) state.controller = null;
      });
  });
});

// ---------- 设置页：测试连接 ----------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "xdbh-api-test") return undefined;
  const missing = xdbhServiceReady(message.service);
  if (missing) {
    sendResponse({ ok: false, error: missing });
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), XDBH_TEST_TIMEOUT_MS);
  xdbhCallApi(message.service, [{ role: "user", content: "ping" }], {
    stream: false,
    signal: controller.signal,
  })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: xdbhApiErrorMessage(error, XDBH_TEST_TIMEOUT_MS) }))
    .finally(() => clearTimeout(timer));
  return true; // 异步回复
});
