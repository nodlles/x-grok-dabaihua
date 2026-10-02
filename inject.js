// inject.js —— 主世界(MAIN)。拦截页面自己的 fetch / XHR / WebSocket。
// 两件事:
//   1) 【改写】武装后把 WebSocket response.create 或旧版 add_response 的消息
//      改成「大白话」指令 —— 复用 X 自己的连接与请求,不碰签名。
//   2) 【流式读取】读取 gateway 回答事件或旧版 NDJSON,实时发给 content.js 渲染。
//   附带:学习模式下仍可捕获 Grok 请求结构(凭证打码)。
(function () {
  "use strict";

  let capture = false;
  let captureEpoch = 0;
  let activeRequest = null;
  let armed = null; // { reqId, prompt, tweetUrl, tweetText }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || !d.__xdbh) return;
    if (d.__xdbh === "config") {
      if (capture !== !!d.capture) captureEpoch++;
      capture = !!d.capture;
    } else if (d.__xdbh === "arm") {
      cancelRequest();
      armed = d;
      activeRequest = { reqId: d.reqId, cancelled: false, reader: null };
    } else if (d.__xdbh === "disarm" && activeRequest && d.reqId === activeRequest.reqId) {
      cancelRequest();
    }
  });

  function cancelRequest() {
    armed = null;
    if (!activeRequest) return;
    activeRequest.cancelled = true;
    // 只停止扩展读取的 clone,保留 X 自己的原始请求和响应。
    if (activeRequest.reader) activeRequest.reader.cancel().catch(() => {});
    activeRequest = null;
  }

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
        const msg = a.followup ? a.message : buildPrompt(a, origMsg);
        // 保留原 response 的其它字段(promptSource 等),只换 message
        body.responses = [Object.assign({}, orig, { message: msg, sender: 1 })];
        if (hasOwnText || a.followup) {
          delete body.promptMetadata; // 正文已自带,切普通聊天
        }
        // 否则保留 promptMetadata,让后端补正文
        return JSON.stringify(body);
      }
    } catch (_) {}
    return bodyStr;
  }

  // ---- 流式解析 NDJSON,把 final 文字发给 content.js ----
  async function streamToCard(res, task) {
    const reqId = task.reqId;
    try {
      if (task.cancelled) return;
      if (!res.ok) throw new Error("Grok HTTP " + res.status);
      post({ __xdbh: "grok-start", reqId });
      if (!res.body || !res.body.getReader) {
        const txt = await res.text();
        if (task.cancelled) return;
        txt.split("\n").forEach((l) => handleLine(l, reqId));
        post({ __xdbh: "grok-done", reqId });
        return;
      }
      const reader = res.body.getReader();
      task.reader = reader;
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (task.cancelled) return;
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
      if (!task.cancelled) post({ __xdbh: "grok-error", reqId, error: String(e) });
    } finally {
      if (task.reader) task.reader.releaseLock();
      if (activeRequest === task) activeRequest = null;
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
      if (Array.isArray(h)) h.forEach(([k, v]) => put(k, v));
      else if (typeof h.forEach === "function") h.forEach((v, k) => put(k, v));
      else for (const k in h) put(k, h[k]);
    } catch (_) {}
    return out;
  }
  function captureResp(res, url, method, init, epoch) {
    try {
      res.text().then((txt) => {
        if (!capture || epoch !== captureEpoch) return;
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

  // 新版 X Grok 通过 WebSocket gateway 发送 response.create,不再走 add_response。
  // 包装 prototype.send 也能覆盖已经建立的连接,不改变连接、凭证或原生消息监听器。
  const WS = window.WebSocket;
  if (WS) {
    const origSend = WS.prototype.send;
    const observed = new WeakSet();
    WS.prototype.send = function (data) {
      let frame;
      if (looksLikeGrok(this.url) && typeof data === "string") {
        try { frame = JSON.parse(data); } catch (_) {}
        if (!observed.has(this)) {
          observed.add(this);
          this.addEventListener("message", (e) => handleSocketMessage(this, e.data));
          const disconnected = () => {
            const task = activeRequest;
            if (task && task.socket === this && !task.cancelled) {
              post({ __xdbh: "grok-error", reqId: task.reqId, error: "Grok 连接中断,请重试。" });
              cancelRequest();
            }
          };
          this.addEventListener("close", disconnected);
          this.addEventListener("error", disconnected);
        }
      }
      const event = frame && frame.event;
      const item = event && event.item;
      const text = item && Array.isArray(item.content) && item.content.find((p) => p && p.type === "input_text" && typeof p.text === "string");
      let task = null;
      if (armed && event && event.type === "response.create" && event.event_id &&
          frame.session_id && text && item.role === "user" &&
          (!armed.followup || text.text === armed.message)) {
        text.text = armed.followup ? armed.message : buildPrompt(armed, text.text);
        data = JSON.stringify(frame);
        task = activeRequest;
        Object.assign(task, { socket: this, sessionId: frame.session_id, eventId: event.event_id, responseId: null, seen: new Set(), textFormat: null });
        armed = null;
      }
      try {
        return origSend.call(this, data);
      } catch (e) {
        if (task && !task.cancelled) {
          post({ __xdbh: "grok-error", reqId: task.reqId, error: String(e) });
          cancelRequest();
        }
        throw e;
      }
    };
  }

  function handleSocketMessage(socket, data) {
    const task = activeRequest;
    if (!task || task.cancelled || task.socket !== socket || typeof data !== "string") return;
    let frame;
    try { frame = JSON.parse(data); } catch (_) { return; }
    const event = frame && frame.event;
    if (!event || frame.session_id !== task.sessionId) return;
    const reqId = task.reqId;
    if (event.type === "error" && (!event.client_event_id || event.client_event_id === task.eventId)) {
      post({ __xdbh: "grok-error", reqId, error: event.error && event.error.message || "Grok 请求失败" });
      cancelRequest();
      return;
    }
    if (event.type === "response.created") {
      if (event.client_event_id !== task.eventId || !event.response || !event.response.id || task.responseId) return;
      task.responseId = event.response.id;
      post({ __xdbh: "grok-start", reqId });
      return;
    }
    const responseId = event.response_id || event.response && event.response.id;
    if (!task.responseId || responseId !== task.responseId) return;
    if (event.event_id) {
      if (task.seen.has(event.event_id)) return;
      task.seen.add(event.event_id);
    }
    if (event.type === "response.chunk") {
      const chunk = event.chunk || {};
      const text = chunk.text;
      if (text && typeof text.text === "string") {
        if (text.channel === "CHANNEL_ASSISTANT_RESPONSE") {
          if (!task.textFormat || task.textFormat === "chunk") {
            task.textFormat = "chunk";
            post({ __xdbh: "grok-chunk", reqId, text: text.text });
          }
        } else if (text.channel === "CHANNEL_ASSISTANT_NOTETAKER_HEADER") {
          post({ __xdbh: "grok-status", reqId, text: text.text });
        }
      }
      const pages = chunk.tool_result && chunk.tool_result.web_search && chunk.tool_result.web_search.webpages;
      if (Array.isArray(pages) && pages.length) {
        post({ __xdbh: "grok-sources", reqId, sources: pages.filter((p) => p && p.url).map((p) => ({ url: p.url, title: p.title })) });
      }
    } else if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      if (!task.textFormat || task.textFormat === "delta") {
        task.textFormat = "delta";
        post({ __xdbh: "grok-chunk", reqId, text: event.delta });
      }
    } else if (event.type === "response.output_text.done" && !task.textFormat && typeof event.text === "string" && event.text) {
      task.textFormat = "done";
      post({ __xdbh: "grok-chunk", reqId, text: event.text });
    } else if (event.type === "response.done" && event.response) {
      if (event.response.status === "completed") post({ __xdbh: "grok-done", reqId });
      else post({ __xdbh: "grok-error", reqId, error: "Grok 回答未完成: " + event.response.status });
      if (activeRequest === task) activeRequest = null;
    }
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
    let task = null;
    // 追问只接管插件实际填入的那条消息,避免误改写同时发生的原生聊天。
    let matchesArmed = true;
    if (armed && armed.followup) {
      try { matchesArmed = JSON.parse(bodyStr).responses[0].message === armed.message; }
      catch (_) { matchesArmed = false; }
    }
    if (isAdd && armed && matchesArmed) {
      task = activeRequest;
      init = Object.assign({}, init, { body: rewriteBody(bodyStr, armed) });
      armed = null;
    }

    const p = origFetch.call(this, input, init);

    if (task) {
      p.then((res) => {
        if (!task.cancelled) return streamToCard(res.clone(), task);
      }).catch((e) => {
        if (!task.cancelled) post({ __xdbh: "grok-error", reqId: task.reqId, error: String(e) });
        if (activeRequest === task) activeRequest = null;
      });
    } else if (capture && (looksLikeGrok(url) || isAdd)) {
      // 学习模式:连 add_response(URL 可能为空)也按请求体形状抓下来
      const epoch = captureEpoch;
      p.then((res) => {
        if (capture && epoch === captureEpoch) captureResp(res.clone(), url || "(add_response)", init && init.method || "POST", init, epoch);
      }).catch(() => {});
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
      const epoch = captureEpoch;
      this.addEventListener("load", function () {
        if (!capture || epoch !== captureEpoch) return;
        let sample = "";
        try { sample = String(this.responseText || "").slice(0, 6000); } catch (_) {}
        post({ __xdbh: "capture", payload: { kind: "xhr", ts: Date.now(), method: info.method, url: info.url, reqBody: String(body || "").slice(0, 4000), respLen: sample.length, respSample: sample } });
      });
    }
    return origSend.apply(this, arguments);
  };

  console.log("%c[X大白话] 已就绪(主世界 · fetch/WebSocket Grok)", "color:#7c5cff");
})();
