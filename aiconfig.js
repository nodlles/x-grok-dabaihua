// aiconfig.js —— 共享的 AI 配置层：服务注册表、解读专家、提示词模板。
// 纯数据 + 纯函数，不碰 chrome.* / document，所以后台 Service Worker
// (importScripts)、内容脚本和设置页可以各自加载一份。

/* ============ 1. 提示词模板 ============ */

// 模板里可用的占位符。没写 {{text}} 的旧提示词会自动在末尾补上正文。
const XDBH_TEMPLATE_KEYS = [
  "text",
  "url",
  "author",
  "handle",
  "date",
  "title",
  "expert",
  "service",
  "model",
  "site",
];

// 把 {{...}} 替换成实际值。认不出的占位符原样保留，方便用户看出拼错的名字。
function xdbhRenderTemplate(template, vars) {
  const source = String(template == null ? "" : template);
  const values = {};
  for (const key of XDBH_TEMPLATE_KEYS) {
    const value = vars ? vars[key] : "";
    values[key] = value == null ? "" : String(value);
  }
  const rendered = source.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, name) => {
    const key = String(name).toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
  if (/\{\{\s*text\s*\}\}/i.test(source) || !values.text) return rendered;
  // 兼容没写 {{text}} 的旧写法：把正文追加到末尾。
  return rendered.replace(/\s*$/, "") + "\n\n" + values.text;
}

/* ============ 2. 第三方 AI 服务 ============ */

const XDBH_DEFAULT_SYSTEM_PROMPT =
  "你是一个中文解读助手。只输出解读内容本身，不要复述原文，不要写「以下是解读」这类开场白。" +
  "原文没有交代的信息不要编造，拿不准就说不确定。";

// 预设只是「填好接口地址和常见模型名」的模板，Key 与模型名都可以改。
const XDBH_SERVICE_PRESETS = [
  {
    id: "xai",
    name: "xAI Grok",
    apiUrl: "https://api.x.ai/v1/chat/completions",
    model: "grok-3-mini",
  },
  {
    id: "openai",
    name: "OpenAI",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    apiUrl: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "openai/gpt-4o-mini",
  },
  {
    id: "groq",
    name: "Groq",
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    apiUrl: "https://api.siliconflow.cn/v1/chat/completions",
    model: "deepseek-ai/DeepSeek-V3",
  },
  {
    id: "ollama",
    name: "Ollama（本机）",
    apiUrl: "http://localhost:11434/v1/chat/completions",
    model: "llama3.1",
    apiKey: "ollama",
  },
  { id: "custom", name: "自定义服务", apiUrl: "", model: "" },
];

const XDBH_DEFAULT_SERVICE_ID = "xai";

function xdbhClampTemperature(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.3;
  return Math.min(2, Math.max(0, n));
}

function xdbhIsLocalUrl(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0";
  } catch (_) {
    return false;
  }
}

function xdbhNormalizeService(item, base) {
  const merged = Object.assign({}, base || {}, item || {});
  return {
    id: String(merged.id || ""),
    name: String(merged.name || "未命名服务").trim() || "未命名服务",
    apiUrl: String(merged.apiUrl || "").trim(),
    apiKey: String(merged.apiKey || ""),
    model: String(merged.model || "").trim(),
    temperature: xdbhClampTemperature(merged.temperature),
    systemPrompt: String(merged.systemPrompt || XDBH_DEFAULT_SYSTEM_PROMPT),
  };
}

// 以预设为底叠加用户存过的改动；用户自己加的服务追加在后面。
function xdbhNormalizeServices(stored) {
  const list = [];
  const index = new Map();
  for (const preset of XDBH_SERVICE_PRESETS) {
    index.set(preset.id, list.length);
    list.push(xdbhNormalizeService(preset, preset));
  }
  for (const item of Array.isArray(stored) ? stored : []) {
    if (!item || typeof item !== "object" || !item.id) continue;
    const id = String(item.id);
    const preset = XDBH_SERVICE_PRESETS.find((p) => p.id === id);
    const service = xdbhNormalizeService(item, preset);
    if (index.has(id)) list[index.get(id)] = service;
    else {
      index.set(id, list.length);
      list.push(service);
    }
  }
  return list;
}

// 还缺什么才能发请求；返回空字符串表示就绪。
function xdbhServiceReady(service) {
  if (!service || !service.apiUrl) return "还没填接口地址";
  if (!service.model) return "还没填模型名";
  if (!service.apiKey && !xdbhIsLocalUrl(service.apiUrl)) return "还没填 API Key";
  return "";
}

// 给 chrome.permissions.request 用的域名匹配串。
function xdbhOriginPattern(apiUrl) {
  try {
    const url = new URL(String(apiUrl));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.protocol + "//" + url.hostname + "/*";
  } catch (_) {
    return "";
  }
}

/* ============ 3. 解读专家 ============ */

// 每个专家就是一段带 {{text}} 的提示词模板。写法沿用「领域范围 + 保真约束 +
// 禁止编造」三段式：先说清做什么，再约束别跑偏，最后禁止脑补。
// link: true 表示这条专家要把原帖链接一起交给模型（可以搜索、读全文）。
const XDBH_EXPERTS = [
  {
    id: "plain",
    name: "大白话",
    emoji: "💬",
    desc: "把内容讲成人话，必要的背景补一句",
    link: false,
    prompt:
      "用大白话、口语化的中文解释下面这条推文在讲什么,必要时补一句背景。别复述原文,直接说人话:\n\n{{text}}",
  },
  {
    id: "tech",
    name: "技术拆解",
    emoji: "🔧",
    desc: "讲清原理、取舍和坑，面向懂技术的读者",
    link: false,
    prompt: [
      "你负责向懂技术的读者拆解下面的内容。",
      "",
      "## 要求",
      "1. 先用一到两句话说明它在讲什么、解决什么问题",
      "2. 再拆关键技术点：用了什么方案、代价和取舍是什么、常见坑在哪",
      "3. 术语第一次出现时，中文说明后附上英文原词",
      "4. 只依据原文解读。原文没交代的架构、性能数字、公司背景不要补；不确定就标明不确定",
      "5. 不要复述原文，不要写「以下是解读」这类开场白",
      "",
      "【原文】",
      "{{text}}",
    ].join("\n"),
  },
  {
    id: "translate",
    name: "翻译 + 解读",
    emoji: "🌐",
    desc: "先给中文译文，再用几句话点破隐含意思",
    link: false,
    prompt: [
      "把下面的内容翻译成自然流畅的简体中文，然后附一段中文解读。",
      "",
      "## 要求",
      "1. 先只给译文，不加任何解释",
      "2. 另起一段，用两到三句话说明这段话在讲什么、有没有隐含意思",
      "3. 专有名词、产品名、代码保持原样；拿不准的译名保留英文并标注",
      "4. 不要扩写，不要补原文没有的信息",
      "",
      "【原文】",
      "{{text}}",
    ].join("\n"),
  },
  {
    id: "summary",
    name: "摘要要点",
    emoji: "📌",
    desc: "压成 3 到 5 条短句，只留结论和数字",
    link: false,
    prompt: [
      "把下面的内容压缩成要点，用简体中文。",
      "",
      "## 要求",
      "1. 用 3 到 5 条短句列出核心信息，每条不超过 30 字",
      "2. 保留结论、数字、时间、人名；丢掉铺垫、重复和情绪表达",
      "3. 原文本来就只有一句话时，直接概括成一句，不要硬凑条目",
      "4. 只总结原文写到的内容，不要补外部背景",
      "",
      "【原文】",
      "{{text}}",
    ].join("\n"),
  },
  {
    id: "critique",
    name: "纠错质疑",
    emoji: "🔍",
    desc: "把没出处的数字、牵强的因果和情绪化表述挑出来",
    link: false,
    prompt: [
      "你负责审视下面这段内容，用简体中文指出值得怀疑或需要留意的地方。",
      "",
      "## 要求",
      "1. 先用一句话说清它主张了什么",
      "2. 再列出可疑之处：没有出处的数字和结论、把相关当因果、以偏概全、情绪化表述、明显的推销或夸张",
      "3. 分开说清哪些部分有据可依、哪些只是观点",
      "4. 只针对原文本身，不要引入原文没提到的外部事实，也不要猜作者动机",
      "5. 确实没发现明显问题时，直接说它说得比较克制，不要强行找问题",
      "",
      "【原文】",
      "{{text}}",
    ].join("\n"),
  },
  {
    id: "custom",
    name: "自定义",
    emoji: "✏️",
    desc: "自己写提示词；默认保留「连同原帖一起交给模型」的旧行为",
    link: true,
    prompt:
      "用大白话、口语化的中文解释下面这条推文在讲什么,必要时补一句背景。别复述原文,直接说人话:\n\n{{text}}",
  },
];

const XDBH_DEFAULT_EXPERT_ID = "plain";

function xdbhNormalizeExpert(item, base) {
  const merged = Object.assign({}, base || {}, item || {});
  return {
    id: String(merged.id || ""),
    name: String(merged.name || "未命名专家").trim() || "未命名专家",
    emoji: String(merged.emoji || "✏️"),
    desc: String(merged.desc || ""),
    link: merged.link == null ? !!(base && base.link) : !!merged.link,
    prompt: String(merged.prompt == null ? "" : merged.prompt),
  };
}

function xdbhNormalizeExperts(stored) {
  const list = XDBH_EXPERTS.map((expert) => xdbhNormalizeExpert(expert, expert));
  const index = new Map(list.map((expert, i) => [expert.id, i]));
  for (const item of Array.isArray(stored) ? stored : []) {
    if (!item || typeof item !== "object" || !item.id) continue;
    const id = String(item.id);
    const base = XDBH_EXPERTS.find((e) => e.id === id);
    const expert = xdbhNormalizeExpert(item, base);
    if (index.has(id)) list[index.get(id)] = expert;
    else {
      index.set(id, list.length);
      list.push(expert);
    }
  }
  return list;
}

function xdbhActiveExpert(settings) {
  const list = (settings && settings.experts) || xdbhNormalizeExperts();
  const id = settings && settings.activeExpertId;
  return list.find((expert) => expert.id === id) || list[0];
}

function xdbhActiveService(settings) {
  const list = (settings && settings.services) || xdbhNormalizeServices();
  const id = settings && settings.activeServiceId;
  return list.find((service) => service.id === id) || list[0] || null;
}

/* ============ 4. 设置归一化 ============ */

const XDBH_MODES = ["grok", "api", "demo", "learn"];
const XDBH_LEGACY_PROMPT =
  "用大白话、口语化的中文解释下面这条推文在讲什么,必要时补一句背景。别复述原文,直接说人话:";

function xdbhNormalizeSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const delay = Number(input.hoverDelay);
  const settings = {
    enabled: input.enabled !== false,
    mode: XDBH_MODES.includes(input.mode) ? input.mode : "grok",
    hoverDelay: Number.isFinite(delay) ? Math.min(5000, Math.max(200, Math.round(delay))) : 1200,
    capture: !!input.capture,
    hideDrawer: input.hideDrawer !== false,
    drawerSelector: String(input.drawerSelector || ""),
    theme: String(input.theme || "graphite"),
    activeExpertId: String(input.activeExpertId || XDBH_DEFAULT_EXPERT_ID),
    activeServiceId: String(input.activeServiceId || XDBH_DEFAULT_SERVICE_ID),
    services: xdbhNormalizeServices(input.services),
    experts: xdbhNormalizeExperts(input.experts),
  };
  // 0.4.0 之前只有一个 prompt 字段：用户改过的把它迁到「自定义」专家，
  // 没动过就继续用内置的大白话专家。
  const legacy = typeof input.prompt === "string" ? input.prompt : "";
  if (legacy.trim() && legacy.trim() !== XDBH_LEGACY_PROMPT && !Array.isArray(input.experts)) {
    const custom = settings.experts.find((expert) => expert.id === "custom");
    if (custom) custom.prompt = legacy;
    settings.activeExpertId = "custom";
  }
  settings.prompt = (xdbhActiveExpert(settings) || {}).prompt || "";
  return settings;
}
