// inject.js —— 主世界(MAIN)。拦截页面自己的 fetch / XHR。
// 两件事:
//   1) 【改写】当我们「武装(arm)」后,把 X 发出的 Grok add_response 请求体里的
//      message 改成「大白话」指令 —— 复用 X 自己已签名的请求,我们不碰签名。
//   2) 【流式读取】把 Grok 的 NDJSON 流解析出 final 文字,实时发给 content.js 渲染。
//   附带:学习模式下仍可捕获 Grok 请求结构(凭证打码)。
(function () {
  "use strict";

  let capture = true;
  let armed = null; // { reqId, prompt, tweetUrl, tweetText }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || !d.__xdbh) return;
    if (d.__xdbh === "config") capture = !!d.capture;
    else if (d.__xdbh === "arm") armed = d; // 准备改写下一个 add_response
    else if (d.__xdbh === "disarm") armed = null;
  });

  function post(msg) {
    try { window.postMessage(msg, "*"); } catch (_) {}
  }

  // ---- URL 是否是真正的 Grok 接口(只看路径,避开 features 噪音)----
  function looksLikeGrok(url) {
    try {
      const u = new URL(url, location.origin);
      if (/grok/i.test(u.pathname)) return true;
      if (/(^|\.)grok\./i.test(u.hostname)) return true;
    } catch (_) {}
    return false;
  }

  // ---- 通过【请求体形状】识别 add_response(最稳,不依赖 URL)----
  function isAddResponseBody(bodyStr) {
    return (
      typeof bodyStr === "string" &&
      /"responses"\s*:/.test(bodyStr) &&
      /"conversationId"\s*:/.test(bodyStr)
    );
  }

  // ---- 拼装我们的大白话 prompt ----
  // origMsg 是 X 原始请求里的 message —— 对帖子/文章常常就是一个 URL。
  // 即便 content.js 没传 tweetUrl,也从这里兜底拿到链接,确保 Grok 能定位原帖。
  function buildPrompt(a, origMsg) {
    const parts = [a.prompt || "用大白话、口语化的中文解释这条推文在讲什么,别复述原文,直接说人话:"];
    if (a.tweetText) parts.push("\n【推文原文】\n" + a.tweetText);
    let url = a.tweetUrl || "";
    if (!url && typeof origMsg === "string" && /^https?:\/\/\S+$/.test(origMsg.trim())) {
      url = origMsg.trim();
    }
    if (url) parts.push("\n【原帖链接】" + url);
    return parts.join("\n");
  }

  // ---- 改写 add_response 的请求体 ----
  // 复用 X 自己已签名的「分析(GROK_ANALYZE)」请求,把 message 换成大白话指令。
  // 关键分两种情况(修复:文章/图片帖总结失败):
  //  - 我们已抓到原帖正文(普通推文):塞进 prompt,并去掉 promptMetadata 切成普通
  //    聊天,免得「分析模式」的系统提示盖过我们的口语化风格。
  //  - 没抓到正文(X 长文「文章」、纯图/视频帖 —— 这类 DOM 里没有 tweetText):
  //    【保留】promptMetadata(GROK_ANALYZE)+ 原始 message 里的 URL,让 X 后端
  //    照常去抓原帖/文章正文,我们只在末尾追加「请说大白话」的风格要求。
  //    (之前无条件删 promptMetadata,导致文章只剩一个裸链接、Grok 没正文可读 → 失败。)
  function rewriteBody(bodyStr, a) {
    try {
      const body = JSON.parse(bodyStr);
      if (body && Array.isArray(body.responses) && body.responses[0]) {
        const orig = body.responses[0];
        const origMsg = typeof orig.message === "string" ? orig.message : "";
        const hasOwnText = !!(a.tweetText && String(a.tweetText).trim());
        const msg = buildPrompt(a, origMsg);
        // 保留原 response 的其它字段(promptSource 等),只换 message
        body.responses = [Object.assign({}, orig, { message: msg, sender: 1 })];
        if (hasOwnText) {
          delete body.promptMetadata; // 正文已自带,切普通聊天
        }
        // 否则保留 promptMetadata,让后端补正文
        return JSON.stringify(body);
      }
    } catch (_) {}
    return bodyStr;
  }

  // ---- 流式解析 NDJSON,把 final 文字发给 content.js ----
  async function streamToCard(res, reqId) {
    try {
      post({ __xdbh: "grok-start", reqId });
      if (!res.body || !res.body.getReader) {
        const txt = await res.text();
        txt.split("\n").forEach((l) => handleLine(l, reqId));
        post({ __xdbh: "grok-done", reqId });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          handleLine(line, reqId);
        }
      }
      if (buf.trim()) handleLine(buf, reqId);
      post({ __xdbh: "grok-done", reqId });
    } catch (e) {
      post({ __xdbh: "grok-error", reqId, error: String(e) });
    }
  }

  function handleLine(line, reqId) {
    const s = line.trim();
    if (!s) return;
    let o;
    try { o = JSON.parse(s); } catch (_) { return; }
    const r = o && o.result;
    if (!r) return;
    if (r.messageTag === "final" && typeof r.message === "string") {
      post({ __xdbh: "grok-chunk", reqId, text: r.message });
    } else if (Array.isArray(r.webResults) && r.webResults.length) {
      // 收集来源(供引用角标 [n] 链接)
      post({
        __xdbh: "grok-sources",
        reqId,
        sources: r.webResults.map((w) => ({ url: w.url, title: w.title })),
      });
    } else if (r.isThinking && r.message && r.messageTag === "header") {
      post({ __xdbh: "grok-status", reqId, text: r.message });
    }
  }

  // ---- 学习模式:捕获 Grok 请求结构(脱敏)----
  const SENSITIVE = ["authorization", "cookie", "x-csrf-token", "x-client-transaction-id", "x-guest-token", "x-twitter-auth-type"];
  function redactHeaders(h) {
    const out = {};
    if (!h) return out;
    try {
      const put = (k, v) => (out[k] = SENSITIVE.includes(String(k).toLowerCase()) ? "«已打码·" + String(v).length + "字符»" : v);
      if (typeof h.forEach === "function") h.forEach((v, k) => put(k, v));
      else if (Array.isArray(h)) h.forEach(([k, v]) => put(k, v));
      else for (const k in h) put(k, h[k]);
    } catch (_) {}
    return out;
  }
  function captureResp(res, url, method, init) {
    try {
      res.text().then((txt) => {
        post({
          __xdbh: "capture",
          payload: {
            kind: "fetch", ts: Date.now(), method, url,
            reqHeaders: redactHeaders(init && init.headers),
            reqBody: String((init && init.body) || "").slice(0, 4000),
            respLen: txt.length, respSample: txt.slice(0, 6000),
          },
        });
      }).catch(() => {});
    } catch (_) {}
  }

  // ---- 包装 fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = "";
    if (typeof input === "string") url = input;
    else if (input instanceof Request) url = input.url;
    else if (input instanceof URL) url = input.href;
    else if (input && input.url) url = input.url;

    const bodyStr = init && typeof init.body === "string" ? init.body : "";
    const isAdd = isAddResponseBody(bodyStr);

    // 改写(仅当已武装且这是 add_response)
    let reqId = null;
    if (isAdd && armed) {
      reqId = armed.reqId;
      init = Object.assign({}, init, { body: rewriteBody(bodyStr, armed) });
      armed = null;
    }

    const p = origFetch.call(this, input, init);

    if (isAdd && reqId) {
      p.then((res) => streamToCard(res.clone(), reqId)).catch((e) => post({ __xdbh: "grok-error", reqId, error: String(e) }));
    } else if (capture && (looksLikeGrok(url) || isAdd)) {
      // 学习模式:连 add_response(URL 可能为空)也按请求体形状抓下来
      p.then((res) => captureResp(res.clone(), url || "(add_response)", init && init.method || "POST", init));
    }
    return p;
  };

  // ---- 包装 XHR(仅用于学习模式捕获,add_response 走 fetch)----
  const XHR = window.XMLHttpRequest;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;
  XHR.prototype.open = function (method, url) {
    this.__xdbh = { method, url };
    return origOpen.apply(this, arguments);
  };
  XHR.prototype.send = function (body) {
    const info = this.__xdbh;
    if (info && capture && looksLikeGrok(info.url)) {
      this.addEventListener("load", function () {
        let sample = "";
        try { sample = String(this.responseText || "").slice(0, 6000); } catch (_) {}
        post({ __xdbh: "capture", payload: { kind: "xhr", ts: Date.now(), method: info.method, url: info.url, reqBody: String(body || "").slice(0, 4000), respLen: sample.length, respSample: sample } });
      });
    }
    return origSend.apply(this, arguments);
  };

  console.log("%c[X大白话] 已就绪(主世界 · 可改写+流式读取 Grok)", "color:#7c5cff");
})();
