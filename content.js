// content.js —— 运行在「隔离世界」,能用 chrome.storage,负责 UI 与交互。
// 职责:hover 进度环 → 触发 → 炫酷卡片;接收主世界 hook 的捕获结果并存储。
(function () {
  "use strict";

  const DEFAULTS = {
    enabled: true,
    mode: "grok", // grok（真·大白话） | demo（看 UI） | learn（抓请求结构）
    hoverDelay: 1200,
    capture: true,
    hideDrawer: true, // 隐藏 X 自己的 Grok 抽屉
    drawerSelector: "", // 自定义抽屉选择器(我猜不中时手动填)
    theme: "graphite", // graphite | light | ocean | neon | auto
    prompt:
      "用大白话、口语化的中文解释下面这条推文在讲什么,必要时补一句背景。别复述原文,直接说人话:",
  };

  let settings = { ...DEFAULTS };
  let hoverTimer = null;
  let activeTweet = null;
  let ring = null;
  let card = null;
  let pending = null; // { reqId, api, raw, started }
  let dead = false;
  let suppressCardClose = false; // 我们主动点击页面按钮(Grok/抽屉)时,别让「点卡片外关闭」误关自己的卡片

  // 程序化点击页面元素(X 的 Grok 按钮、抽屉控件)时,这些 click 会冒泡到 document,
  // 被下面的「点击卡片外 → 关卡片」逻辑当成点了外面。用此 helper 临时抑制关闭。
  function safeClick(el) {
    if (!el) return;
    suppressCardClose = true;
    try { el.click(); } catch (_) {}
    setTimeout(() => { suppressCardClose = false; }, 0);
  }

  // 扩展被重新加载/卸载后,旧的 content.js 会变成「孤儿」,再调 chrome.* 就抛
  // 「Extension context invalidated」。用这个守卫静默跳过。
  function alive() {
    if (dead) return false;
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      dead = true;
      return false;
    }
  }

  function teardown() {
    dead = true;
    try { if (drawerObserver) drawerObserver.disconnect(); } catch (_) {}
  }

  // ---------- 设置加载 ----------
  try {
    chrome.storage.local.get("settings", (res) => {
      settings = { ...DEFAULTS, ...((res && res.settings) || {}) };
      pushConfigToHook();
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (!alive()) return;
      if (changes.settings) {
        settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
        pushConfigToHook();
      }
    });
  } catch (_) {}

  function pushConfigToHook() {
    window.postMessage({ __xdbh: "config", capture: settings.capture }, "*");
  }

  // ---------- 接收主世界 hook 的消息 ----------
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || !d.__xdbh) return;
    if (!alive()) { teardown(); return; }

    // 学习模式:捕获结构
    if (d.__xdbh === "capture" && d.payload) {
      storeCapture(d.payload);
      if (card && card.dataset.mode === "learn") {
        const note = card.querySelector(".xdbh-learn-note");
        if (note) note.textContent = "✓ 已捕获 1 个 Grok 请求 —— 打开设置页查看结构";
      }
      return;
    }

    // 真·大白话模式:流式回答
    if (!pending || pending.reqId !== d.reqId) return;
    if (d.__xdbh === "grok-start") {
      pending.started = true;
      pending.raw = "";
      pending.sources = [];
      pending.api.hideSkeleton();
      pending.api.setStatus("Grok 正在用大白话解释…");
    } else if (d.__xdbh === "grok-status") {
      pending.api.setStatus(d.text);
    } else if (d.__xdbh === "grok-sources") {
      (d.sources || []).forEach((s) => {
        if (s.url && !pending.sources.some((x) => x.url === s.url)) pending.sources.push(s);
      });
      if (pending.raw) pending.api.setHtml(xdbhRenderRich(pending.raw, pending.sources));
    } else if (d.__xdbh === "grok-chunk") {
      pending.raw += d.text;
      pending.api.setHtml(xdbhRenderRich(pending.raw, pending.sources));
    } else if (d.__xdbh === "grok-done") {
      pending.api.setStatus("");
      if (!pending.raw.trim()) {
        pending.api.setText("Grok 没有返回文字内容(可能是图片/视频帖,或被它当成了别的请求)。");
      } else {
        saveCache(pending.url, { raw: pending.raw, sources: pending.sources });
      }
      pending = null;
    } else if (d.__xdbh === "grok-error") {
      pending.api.hideSkeleton();
      pending.api.setStatus("");
      pending.api.setText("出错了:" + d.error);
      pending = null;
    }
  });

  function storeCapture(payload) {
    if (!alive()) return;
    try {
      chrome.storage.local.get("captures", (res) => {
        if (!alive()) return;
        const list = (res && res.captures) || [];
        list.unshift(payload);
        try { chrome.storage.local.set({ captures: list.slice(0, 30) }); } catch (_) {}
      });
    } catch (_) {}
  }


  // ---------- hover 检测 ----------
  document.addEventListener("mouseover", (e) => {
    if (!settings.enabled) return;
    const t = e.target.closest('article[data-testid="tweet"]');
    if (!t || t === activeTweet) return;
    startHover(t);
  });

  document.addEventListener("mouseout", (e) => {
    const t = e.target.closest('article[data-testid="tweet"]');
    if (!t || t !== activeTweet) return;
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    if (ring && e.relatedTarget && ring.contains(e.relatedTarget)) return;
    cancelHover();
  });

  function startHover(tweet) {
    cancelHover();
    activeTweet = tweet;
    ring = buildRing(tweet);
    document.body.appendChild(ring);
    // 下一帧启动环动画,与 hoverDelay 同步
    requestAnimationFrame(() => {
      if (!ring) return; // hover 可能在这一帧前已被 cancelHover 清掉
      const fg = ring.querySelector(".xdbh-ring-fg");
      if (!fg) return;
      fg.style.transition = `stroke-dashoffset ${settings.hoverDelay}ms linear`;
      fg.style.strokeDashoffset = "0";
    });
    hoverTimer = setTimeout(() => trigger(tweet), settings.hoverDelay);
  }

  function cancelHover() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    if (ring) ring.remove();
    ring = null;
    activeTweet = null;
  }

  // ---------- 进度环 ----------
  function buildRing(tweet) {
    const rect = tweet.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "xdbh-ring";
    el.style.top = Math.max(8, rect.top + 8) + "px";
    el.style.left = Math.min(window.innerWidth - 44, rect.right - 42) + "px";
    el.innerHTML = `
      <svg viewBox="0 0 36 36">
        <circle class="xdbh-ring-bg" cx="18" cy="18" r="15"></circle>
        <circle class="xdbh-ring-fg" cx="18" cy="18" r="15"></circle>
      </svg>
      <span class="xdbh-ring-icon">✦</span>`;
    el.title = "点击立即用大白话解释";
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (hoverTimer) clearTimeout(hoverTimer);
      trigger(tweet);
    });
    el.addEventListener("mouseenter", () => {
      if (hoverTimer) {
        // 鼠标进环时暂停自动触发,等点击
      }
    });
    return el;
  }

  // ---------- 触发 ----------
  function trigger(tweet) {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    if (ring) {
      ring.remove();
      ring = null;
    }
    const text = extractTweetText(tweet);
    showCard(tweet, text);
  }

  function extractTweetText(tweet) {
    const nodes = tweet.querySelectorAll('[data-testid="tweetText"]');
    const tt = Array.from(nodes)
      .map((n) => n.innerText)
      .join("\n")
      .trim();
    if (tt) return tt;
    // X 长文「文章」没有 tweetText —— 详情页正文在专门的富文本容器里,
    // 这里抓出来塞进 prompt,Grok 就能直接读到全文(不必依赖 X 的分析后端)。
    return extractArticleText(tweet);
  }

  // 仅文章「详情/阅读视图」有完整正文;时间线卡片只有封面+标题(返回空,
  // 走 GROK_ANALYZE 让 X 后端补正文)。
  function extractArticleText(scope) {
    const sel =
      '[data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"]';
    const rv = (scope && scope.querySelector(sel)) || document.querySelector(sel);
    if (!rv) return "";
    const title = document.querySelector('[data-testid="twitter-article-title"]');
    const body = ((title ? title.innerText + "\n\n" : "") + rv.innerText).trim();
    return body.slice(0, 6000); // 控制长度,避免请求体过大
  }

  function extractTweetUrl(tweet) {
    const a = tweet.querySelector('a[href*="/status/"]');
    if (!a) return "";
    return new URL(a.getAttribute("href"), location.origin).href.split("?")[0];
  }

  // ---------- 卡片 ----------
  function showCard(tweet, text) {
    if (card) card.remove();
    card = document.createElement("div");
    card.className = "xdbh-card";
    card.dataset.mode = settings.mode;
    card.dataset.theme = resolveTheme(settings.theme);
    card.innerHTML = `
      <div class="xdbh-card-inner">
        <header class="xdbh-card-head">
          <span class="xdbh-logo">✦</span>
          <span class="xdbh-title">大白话解读</span>
          <span class="xdbh-badge">${settings.mode === "learn" ? "学习" : settings.mode === "demo" ? "演示" : "大白话"}</span>
          <button class="xdbh-close" title="关闭">×</button>
        </header>
        <div class="xdbh-card-body">
          <div class="xdbh-skeleton">
            <span></span><span></span><span></span>
          </div>
          <div class="xdbh-text"></div>
          <div class="xdbh-learn-note"></div>
        </div>
        <footer class="xdbh-card-foot">
          <span class="xdbh-status"></span>
          <button class="xdbh-redo">重新解释</button>
        </footer>
      </div>`;
    positionCard(card, tweet);
    document.body.appendChild(card);
    requestAnimationFrame(() => {
      card.classList.add("xdbh-in");
      clampCard(card);
    });
    makeDraggable(card);

    card.querySelector(".xdbh-close").onclick = () => {
      card.remove();
      card = null;
      restoreGrokDrawers();
    };
    const api = makeCardApi(card);
    const run = (force) => {
      api.reset();
      if (settings.mode === "learn") runLearn(tweet, text, api);
      else if (settings.mode === "demo") runDemo(text, api);
      else runGrok(tweet, text, api, force);
    };
    card.querySelector(".xdbh-redo").onclick = () => run(true);
    run(false);
  }

  function makeCardApi(el) {
    const skeleton = el.querySelector(".xdbh-skeleton");
    const textEl = el.querySelector(".xdbh-text");
    const statusEl = el.querySelector(".xdbh-status");
    const noteEl = el.querySelector(".xdbh-learn-note");
    return {
      reset() {
        skeleton.style.display = "flex";
        textEl.textContent = "";
        noteEl.textContent = "";
        statusEl.textContent = "";
      },
      setStatus(s) {
        statusEl.textContent = s;
      },
      hideSkeleton() {
        skeleton.style.display = "none";
      },
      note(s) {
        noteEl.textContent = s;
      },
      setText(s) {
        skeleton.style.display = "none";
        textEl.textContent = s;
        const body = el.querySelector(".xdbh-card-body");
        if (body) body.scrollTop = body.scrollHeight;
      },
      setHtml(h) {
        skeleton.style.display = "none";
        textEl.innerHTML = h;
        const body = el.querySelector(".xdbh-card-body");
        if (body) body.scrollTop = body.scrollHeight;
      },
      async stream(str) {
        for (let i = 0; i < str.length; i++) {
          textEl.textContent += str[i];
          if (i % 2 === 0) await sleep(12);
        }
        statusEl.textContent = "";
      },
    };
  }

  // ---------- 两种模式 ----------
  async function runDemo(text, api) {
    api.setStatus("正在用大白话解释…");
    await sleep(550);
    api.hideSkeleton();
    const msg =
      "【演示文本】这条推文大概在说:\n\n" +
      (text ? "“" + text.slice(0, 60) + "…” " : "") +
      "——现在是 UI 演示模式,还没接真正的 Grok。\n\n等你在「学习模式」下点一次 Grok、插件抓到请求结构后,这里就会换成真·大白话解读。";
    await api.stream(msg);
  }

  async function runGrok(tweet, text, api, force) {
    const reqId = "r" + Date.now() + Math.random().toString(36).slice(2, 6);
    const tweetUrl = extractTweetUrl(tweet);

    // 命中缓存:同一条推文秒出,不再调 Grok
    if (!force) {
      const cached = getCache(tweetUrl);
      if (cached) {
        api.hideSkeleton();
        api.setHtml(xdbhRenderRich(cached.raw, cached.sources));
        api.setStatus("缓存结果 · 点「重新解释」刷新");
        return;
      }
    }

    pending = { reqId, api, raw: "", started: false, sources: [], url: tweetUrl };
    api.setStatus("正在唤起 Grok…");

    // 武装主世界 hook:下一个 add_response 改写成我们的大白话 prompt
    window.postMessage(
      { __xdbh: "arm", reqId, prompt: settings.prompt, tweetUrl, tweetText: text },
      "*"
    );

    // 触发 X 真实的 Grok 解读(由它去签名发送,我们只改写 + 读取)
    await sleep(120);
    const btn = findGrokButton(tweet);
    if (btn) {
      safeClick(btn);
    } else if (text && text.trim().length > 12) {
      // 文章详情页等:没有内联「Grok 操作」分析按钮,但我们已抓到正文 ——
      // 改为驱动 Grok 抽屉发一条消息,hook 会把它改写成大白话指令(含正文)。
      summarizeViaDrawer(api);
    } else {
      api.note("没自动找到 Grok 按钮 —— 请手动点一次这条推文的 Grok 解读,插件会自动接管");
    }

    // 抽屉弹出后尽快把它移到屏幕外(MutationObserver 也会兜底)
    if (settings.hideDrawer) {
      let tries = 0;
      let hidden = 0;
      const timer = setInterval(() => {
        hidden += hideGrokDrawers() || 0;
        if (++tries >= 24) {
          // 约 3 秒
          clearInterval(timer);
          if (!hidden) {
            console.warn(
              "[X大白话] 没匹配到 Grok 抽屉元素。请右键抽屉→检查,把它的选择器填到设置页『自定义抽屉选择器』。"
            );
          }
        }
      }, 125);
    }

    // 超时兜底
    setTimeout(() => {
      if (pending && pending.reqId === reqId && !pending.started) {
        api.hideSkeleton();
        api.setStatus("");
        api.setText(
          "没等到 Grok 响应 😕\n可能没触发到那个 Grok 解读按钮。试试:\n1) 手动点一次该推文的 Grok 解读;\n2) 或在设置里临时切到「演示」看 UI。"
        );
        window.postMessage({ __xdbh: "disarm" }, "*");
        pending = null;
      }
    }, 10000);
  }

  async function runLearn(tweet, text, api) {
    api.setStatus("学习模式:正在触发 Grok…");
    const btn = findGrokButton(tweet);
    await sleep(300);
    api.hideSkeleton();
    if (btn) {
      btn.click();
      await api.stream(
        "已自动点击这条推文的 Grok 按钮。\n\n插件正在后台监听并捕获 Grok 的网络请求。"
      );
      api.note("等待捕获中…");
    } else {
      await api.stream(
        "没在这条推文上找到 Grok 按钮 😅\n\n请你手动点一次页面上的 Grok 解读按钮(任意推文都行),插件会自动在后台捕获那次请求结构。"
      );
      api.note("等待你手动点击 Grok…");
    }
  }

  // Grok「解读/分析」按钮：推文走 aria-label/testid;X 文章(长文)的按钮常在
  // article 容器之外、且文案是可见文字而非 aria-label。所以分四级兜底:
  //   1) 文内按选择器  2) 文内按可见文字  3) 全文档按选择器  4) 全文档按可见文字
  // 只认「Grok」这个品牌词 —— 它独一无二,绝不会出现在「查看帖子分析/浏览量」按钮上。
  // (上一版用「分析/Analyze」做兜底,结果误点了 X 的分析按钮,弹出「浏览量」框。)
  const GROK_BTN_SELECTORS = [
    'button[aria-label*="Grok" i]',
    'a[aria-label*="Grok" i]',
    '[role="button"][aria-label*="Grok" i]',
    'button[data-testid*="grok" i]',
    'a[data-testid*="grok" i]',
    '[role="button"][data-testid*="grok" i]',
    '[data-testid*="grok" i]',
  ];
  const GROK_TEXT_RE = /grok/i;
  // 即便文字含 grok,也排除分析/浏览量类按钮,双保险
  const NOT_GROK_RE = /(分析|浏览量|查看|互动|analytics|views|impression)/i;

  // 排除会「整页跳转到 /i/grok」的导航入口(侧边栏 Grok tab、链接),它们不是
  // 帖子内联按钮 —— 点了会离开当前页,我们的同页请求拦截就失效了。
  function isNavLink(el) {
    if (el.closest('[role="navigation"], nav, header[role="banner"]')) return true;
    const href = el.getAttribute("href") || (el.tagName === "A" ? el.href : "");
    if (href && /\/i\/grok\b/i.test(href)) return true;
    const tid = el.getAttribute("data-testid") || "";
    if (/(AppTabBar|SideNav|ScrollSnap)/i.test(tid)) return true;
    return false;
  }

  function isGrokEl(el) {
    if (!el || el.closest(".xdbh-card")) return false;
    if (isNavLink(el)) return false; // 跳转入口一律不点
    // Grok 抽屉的开关/头部:点了只是打开空抽屉,不会分析当前帖 —— 不当分析按钮。
    // (文章详情页若把它当成分析按钮点下去,只会弹出空抽屉、永远等不到响应。)
    const tid = el.getAttribute("data-testid") || "";
    if (/GrokDrawer/i.test(tid)) return false;
    const label = (el.getAttribute("aria-label") || "") + " " + (el.innerText || el.textContent || "");
    if (NOT_GROK_RE.test(label) && !/grok/i.test(label)) return false;
    return true;
  }

  // 文章详情页没有内联「Grok 操作」按钮:打开 Grok 抽屉,在输入框发一条消息触发
  // add_response。正文已通过 arm 交给 hook,hook 会把这条消息改写成大白话指令(含
  // 正文)并流式读回 —— 所以这里输入什么不重要,只是为了让 X 发出那个请求。
  function summarizeViaDrawer(api) {
    const opener =
      document.querySelector('[data-testid="GrokDrawerHeader"]') ||
      Array.from(document.querySelectorAll("button")).find(
        (b) => /^grok$/i.test((b.getAttribute("aria-label") || "").trim())
      );
    if (opener) safeClick(opener);

    let tries = 0;
    const timer = setInterval(() => {
      const ta = Array.from(document.querySelectorAll("textarea")).find((t) =>
        /随便问|问点什么|ask/i.test(t.getAttribute("placeholder") || "")
      );
      if (ta) {
        clearInterval(timer);
        try {
          ta.focus();
          const set = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value"
          ).set;
          set.call(ta, "总结");
          ta.dispatchEvent(new Event("input", { bubbles: true }));
        } catch (_) {}
        // 输入后发送按钮才会激活,等一拍再点
        setTimeout(() => {
          const send = Array.from(
            document.querySelectorAll('button,[role="button"]')
          ).find((b) => /问\s*Grok|发送|send/i.test(b.getAttribute("aria-label") || ""));
          if (send) safeClick(send);
          else if (api) api.note("已打开 Grok,请按回车发送一下,插件会接管");
        }, 320);
        return;
      }
      if (++tries >= 24) {
        clearInterval(timer);
        if (api) api.note("没能自动打开 Grok 输入框 —— 请手动在 Grok 里随便发一句");
      }
    }, 150);
  }

  function bySelector(root) {
    for (const s of GROK_BTN_SELECTORS) {
      let nodes;
      try { nodes = root.querySelectorAll(s); } catch (_) { continue; }
      for (const el of nodes) if (isGrokEl(el)) return el;
    }
    return null;
  }

  function byText(root) {
    const cands = root.querySelectorAll('button, a, [role="button"]');
    for (const el of cands) {
      if (el.closest(".xdbh-card")) continue; // 别点到自己卡片上的按钮
      const label = (el.getAttribute("aria-label") || "") + " " + (el.innerText || el.textContent || "");
      if (GROK_TEXT_RE.test(label) && isGrokEl(el)) return el;
    }
    return null;
  }

  function findGrokButton(tweet) {
    if (tweet) {
      const inTweet = bySelector(tweet) || byText(tweet);
      if (inTweet) return inTweet;
    }
    // 文章页:按钮多半在 article 容器之外,全文档兜底
    return bySelector(document) || byText(document);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // 滚动 / 点击空白处关闭卡片
  document.addEventListener("click", (e) => {
    if (suppressCardClose) return; // 我们自己点的 Grok/抽屉按钮,不算「点卡片外」
    // 点 Grok 抽屉内部(我们驱动总结时会用到)也不关卡片
    if (e.target.closest && e.target.closest('[data-testid="GrokDrawer"]')) return;
    if (card && !card.contains(e.target)) {
      card.remove();
      card = null;
      restoreGrokDrawers();
    }
  });

  // ---------- 隐藏 X 自己的 Grok 抽屉 ----------
  // 用「移到屏幕外」而非关闭,避免取消正在进行的流式请求。
  const DRAWER_SELECTORS = [
    '[data-testid="GrokDrawer"]',
    '[data-testid*="GrokDrawer"]',
    '[data-testid*="grokDrawer"]',
    '[data-testid="grok-drawer"]',
    '[data-testid*="grok" i][role="dialog"]',
    '[aria-label="Grok"][role="dialog"]',
    '[aria-label*="Grok" i][role="dialog"]',
  ];

  function currentDrawerSelectors() {
    const list = DRAWER_SELECTORS.slice();
    if (settings.drawerSelector && settings.drawerSelector.trim()) {
      list.push(settings.drawerSelector.trim());
    }
    return list;
  }

  function hideGrokDrawers() {
    if (!settings.hideDrawer) return;
    let hit = 0;
    for (const sel of currentDrawerSelectors()) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (_) { continue; }
      nodes.forEach((n) => {
        if (n.closest(".xdbh-card")) return; // 别误伤自己
        if (n.dataset.xdbhHidden) { hit++; return; }
        n.dataset.xdbhHidden = "1";
        n.style.setProperty("position", "fixed", "important");
        n.style.setProperty("left", "-99999px", "important");
        n.style.setProperty("top", "-99999px", "important");
        n.style.setProperty("opacity", "0", "important");
        n.style.setProperty("pointer-events", "none", "important");
        hit++;
      });
    }
    return hit;
  }

  // 关卡片时把被移到屏幕外的原生 Grok 抽屉复位,否则用户之后用不了 X 自己的 Grok
  function restoreGrokDrawers() {
    document.querySelectorAll('[data-xdbh-hidden="1"]').forEach((n) => {
      n.style.removeProperty("position");
      n.style.removeProperty("left");
      n.style.removeProperty("top");
      n.style.removeProperty("opacity");
      n.style.removeProperty("pointer-events");
      delete n.dataset.xdbhHidden;
    });
  }

  let drawerObsScheduled = false;
  const drawerObserver = new MutationObserver(() => {
    if (drawerObsScheduled) return;
    drawerObsScheduled = true;
    requestAnimationFrame(() => {
      drawerObsScheduled = false;
      hideGrokDrawers();
    });
  });
  drawerObserver.observe(document.documentElement, { childList: true, subtree: true });

  console.log("%c[X大白话] 已加载 · 模式将按设置生效", "color:#7c5cff");
})();
