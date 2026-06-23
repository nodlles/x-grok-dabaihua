// cache.js —— 解释结果缓存(替代「会话复用」):同一条推文再次 hover 秒出,省时省额度。
// 与 content.js 同处隔离世界,顶层声明为共享全局。
const XDBH_CACHE_TTL = 24 * 3600 * 1000; // 24 小时
const XDBH_CACHE_MAX = 80;
const explainCache = new Map(); // url -> { raw, sources, ts }

function xdbhCacheAlive() {
  try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
}

// 启动时载入持久缓存(过期的丢弃)
try {
  chrome.storage.local.get("explainCache", (res) => {
    const obj = (res && res.explainCache) || {};
    const now = Date.now();
    Object.keys(obj).forEach((url) => {
      if (now - (obj[url].ts || 0) < XDBH_CACHE_TTL) explainCache.set(url, obj[url]);
    });
  });
} catch (_) {}

function getCache(url) {
  if (!url) return null;
  const c = explainCache.get(url);
  if (!c) return null;
  if (Date.now() - (c.ts || 0) > XDBH_CACHE_TTL) {
    explainCache.delete(url);
    return null;
  }
  return c;
}

function saveCache(url, data) {
  if (!url || !data || !data.raw) return;
  explainCache.set(url, { ...data, ts: Date.now() });
  while (explainCache.size > XDBH_CACHE_MAX) {
    explainCache.delete(explainCache.keys().next().value); // 删最旧
  }
  if (!xdbhCacheAlive()) return;
  try {
    const obj = {};
    explainCache.forEach((v, k) => (obj[k] = v));
    chrome.storage.local.set({ explainCache: obj });
  } catch (_) {}
}
