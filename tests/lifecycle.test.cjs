const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.XDBH_TEST_ROOT || path.join(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  const setTimeout = (fn, ms = 0) => { timers.set(++id, { at: now + ms, fn }); return id; };
  return {
    setTimeout, clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => setTimeout(fn, 16),
    setInterval(fn, ms) { const key = ++id; const repeat = () => { fn(); if (timers.has(key)) timers.set(key, { at: now + ms, fn: repeat, interval: true }); }; timers.set(key, { at: now + ms, fn: repeat, interval: true }); return key; },
    clearInterval: (id) => timers.delete(id),
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        if (!next[1].interval) timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

class Element {
  constructor() {
    this.dataset = {}; this.children = new Map(); this.listeners = {}; this.textContent = ''; this.value = ''; this.childNodes = [];
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const next = force === undefined ? !classes.has(name) : !!force;
        if (next) classes.add(name); else classes.delete(name);
        return next;
      },
    };
    this.connected = true; this.attrs = {};
    const values = new Map();
    this.style = {
      setProperty: (k, v, p = '') => values.set(k, [v, p]),
      getPropertyValue: (k) => values.get(k)?.[0] || '',
      getPropertyPriority: (k) => values.get(k)?.[1] || '',
      removeProperty: (k) => values.delete(k),
    };
  }
  querySelector(sel) { if (!this.children.has(sel)) this.children.set(sel, new Element()); return this.children.get(sel); }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains(el) { return el === this || [...this.children.values()].includes(el); }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(el) { this.childNodes.push(el); return el; }
  focus(options) { (this.focusOptions ||= []).push(options); this.listeners.focus?.({}); }
  dispatchEvent() {}
  getAttribute(k) { return this.attrs[k] || null; }
  getClientRects() { return [{}]; }
  getBoundingClientRect() { return { top: 20, right: 500 }; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  remove() { this.connected = false; }
  click() { this.clicks = (this.clicks || 0) + 1; this.onclick?.(); }
}

function contentHarness(settings = {}, cached = null) {
  const timers = clock(), events = {}, messages = [], cards = [], writes = [], ports = [];
  const drawer = new Element();
  drawer.style.setProperty('position', 'absolute');
  drawer.style.setProperty('left', '30px', 'important');
  drawer.style.setProperty('top', '140px');
  drawer.style.setProperty('opacity', '0.8');
  drawer.style.setProperty('pointer-events', 'auto', 'important');
  drawer.querySelector = () => null;
  const button = new Element(); button.attrs['aria-label'] = 'Grok';
  const tweet = new Element();
  tweet.closest = () => tweet;
  tweet.querySelectorAll = (sel) => sel.includes('tweetText') ? [{ innerText: 'A sufficiently long original tweet' }] : sel.includes('grok') || sel.includes('Grok') ? [button] : [];
  tweet.querySelector = (sel) => sel.includes('/status/') ? { getAttribute: () => '/a/status/1' } : null;
  let observer, change;
  const document = {
    documentElement: {},
    body: { appendChild(el) { if (el.className === 'xdbh-card') cards.push(el); } },
    createElement: () => new Element(),
    addEventListener: (name, fn) => { events[name] = fn; },
    querySelector: () => null,
    querySelectorAll: (sel) => /drawer/i.test(sel) ? [drawer] : [],
  };
  const window = {
    innerWidth: 1200, innerHeight: 900,
    addEventListener: (name, fn) => { events['window:' + name] = fn; },
    postMessage: (d) => messages.push(d),
  };
  const chrome = {
    runtime: {
      id: 'extension',
      connect(info) {
        const port = {
          name: info && info.name, sent: [], listeners: {},
          onMessage: { addListener: (fn) => { port.listeners.message = fn; } },
          onDisconnect: { addListener: (fn) => { port.listeners.disconnect = fn; } },
          postMessage(message) { port.sent.push(message); },
          disconnect() { port.disconnected = true; port.listeners.disconnect?.(); },
          push(message) { port.listeners.message?.(message); },
        };
        ports.push(port);
        return port;
      },
    },
    storage: {
      local: { get(key, cb) { timers.setTimeout(() => cb(key === 'settings' ? { settings } : {}), 0); }, set: (v) => writes.push(v) },
      onChanged: { addListener: (fn) => { change = fn; } },
    },
  };
  const context = vm.createContext({ window, document, chrome, ...timers, console: { log() {}, warn() {} },
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} },
    location: { origin: 'https://x.com' }, URL,
    resolveTheme: (t) => t, positionCard() {}, clampCard() {}, makeDraggable() {},
    getCache: () => cached, saveCache: (url, data) => writes.push({ url, ...data }), xdbhRenderRich: (raw) => raw,
  });
  vm.runInContext(source('aiconfig.js'), context);
  vm.runInContext(source('conversation.js'), context);
  vm.runInContext(source('content.js'), context);
  return {
    ...timers, drawer, button, tweet, messages, cards, writes, ports, document,
    async hover() { await timers.advance(0); events.mouseover({ target: tweet }); await timers.advance(1200); },
    async mutate() { observer(); await timers.advance(16); },
    invalidate() { chrome.runtime.id = null; },
    mouseover(target = tweet) { events.mouseover({ target }); },
    outside() { events.click({ target: new Element() }); },
    question(value) { const input = cards.at(-1).querySelector('.xdbh-question'); input.value = value; input.listeners.input?.(); return input; },
    submit() { cards.at(-1).querySelector('.xdbh-composer').listeners.submit({ preventDefault() {} }); },
    native() { cards.at(-1).querySelector('.xdbh-native').click(); },
    drawerFallback(rich = false) {
      tweet.querySelectorAll = (sel) => sel.includes('tweetText') ? [{ innerText: 'Long article text for drawer fallback' }] : [];
      const input = new Element(); input.attrs.placeholder = 'Ask'; input.dispatchEvent = () => {};
      if (rich) {
        delete input.value;
        input.attrs.contenteditable = 'true'; input.attrs.role = 'textbox';
        window.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
        document.createRange = () => ({ selectNodeContents() {} });
        document.execCommand = (command, _, text) => { input.textContent = command === 'delete' ? '' : text; return true; };
      }
      const send = new Element(); send.attrs['aria-label'] = 'Send';
      drawer.querySelector = (selector) => rich && selector === 'textarea' ? null : input;
      drawer.querySelectorAll = () => [send];
      document.querySelector = () => null;
      document.querySelectorAll = (sel) => sel === 'textarea' ? [input] : sel === 'button,[role="button"]' ? [send] : /drawer/i.test(sel) ? [drawer] : [];
      window.HTMLTextAreaElement = class { set value(v) { this.value = v; this.textContent = v; } };
      context.Event = class {};
      return { input, send };
    },
    close() { cards.at(-1).querySelector('.xdbh-close').click(); },
    redo() { cards.at(-1).querySelector('.xdbh-redo').click(); },
    change(value) { settings = { ...settings, ...value }; change({ settings: { newValue: settings } }); },
    message(d) { events['window:message']({ source: window, data: d }); },
    arm() { return messages.filter((d) => d.__xdbh === 'arm').at(-1); },
  };
}

// 设置页：按 id 惰性造 stub 元素，够 options.js 跑完初始化与各控件回调。
function optionsHarness(options = {}) {
  const timers = clock(), elements = new Map(), writes = [], posts = [], clipboardText = [];
  const requestedOrigins = [];
  const state = {
    settings: options.settings ?? {},
    captures: options.captures ?? [],
    granted: options.granted !== false,
    testReply: options.testReply ?? { ok: true },
    lastError: null,
    onChanged: null,
  };
  const el = (id) => {
    if (!elements.has(id)) { const node = new Element(); node.id = id; elements.set(id, node); }
    return elements.get(id);
  };
  const document = { getElementById: el, createElement: () => new Element(), addEventListener() {} };
  const context = vm.createContext({
    document,
    navigator: { clipboard: { writeText: (text) => { clipboardText.push(text); return Promise.resolve(); } } },
    console: { log() {}, warn() {} },
    ...timers, URL,
    chrome: {
      storage: {
        local: {
          get(key, cb) { timers.setTimeout(() => cb(key === 'captures' ? { captures: state.captures } : { settings: state.settings }), 0); },
          set(value, cb) { writes.push(value); if (cb) timers.setTimeout(cb, 0); },
        },
        onChanged: { addListener: (fn) => { state.onChanged = fn; } },
      },
      permissions: { request: (request) => { requestedOrigins.push(request); return Promise.resolve(state.granted); } },
      runtime: {
        sendMessage(message, cb) { posts.push(message); if (cb) timers.setTimeout(() => cb(state.testReply), 0); },
        get lastError() { return state.lastError; },
      },
    },
  });
  vm.runInContext(source('aiconfig.js'), context);
  vm.runInContext(source('options.js'), context);
  const values = (id) => Array.from(el(id).childNodes, (node) => node.value);
  const labels = (id) => Array.from(el(id).childNodes, (node) => node.textContent);
  const last = () => writes.at(-1).settings;
  const expert = (id) => last().experts.find((item) => item.id === id);
  const service = (id) => last().services.find((item) => item.id === id);
  return {
    ...timers, el, writes, posts, clipboardText, requestedOrigins, state, values, labels, last, expert, service,
    async load() { await timers.advance(0); },
    pick(id, value) { el(id).value = value; el(id).onchange({ target: el(id) }); },
  };
}

// 工具栏弹窗：只造 stub 元素加一个可观察的 body，够 popup.js 跑完初始化与开关回调。
function popupHarness(options = {}) {
  const timers = clock(), elements = new Map(), writes = [];
  const state = { settings: options.settings ?? {}, opened: 0, closed: 0 };
  const el = (id) => {
    if (!elements.has(id)) { const node = new Element(); node.id = id; elements.set(id, node); }
    return elements.get(id);
  };
  const body = new Element();
  const document = { getElementById: el, body };
  const context = vm.createContext({
    document,
    console: { log() {}, warn() {} },
    ...timers,
    window: { close() { state.closed += 1; } },
    chrome: {
      storage: {
        local: {
          get(key, cb) { timers.setTimeout(() => cb({ settings: state.settings }), 0); },
          set(value, cb) { writes.push(value); if (cb) timers.setTimeout(cb, 0); },
        },
      },
      runtime: {
        getManifest: () => ({ version: '0.4.0' }),
        openOptionsPage() { state.opened += 1; },
      },
    },
  });
  vm.runInContext(source('aiconfig.js'), context);
  vm.runInContext(source('popup.js'), context);
  return {
    ...timers, el, body, writes, state,
    async load() { await timers.advance(0); },
  };
}

test('native drawer stays visible outside an active explanation', async () => {
  const h = contentHarness(); await h.advance(0); await h.mutate();
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
});

test('closing before the delayed click disarms and prevents Grok activation', async () => {
  const h = contentHarness(); await h.hover(); const reqId = h.arm().reqId;
  h.close(); await h.advance(15000);
  assert.equal(h.button.clicks || 0, 0);
  assert.ok(h.messages.some((d) => d.__xdbh === 'disarm' && d.reqId === reqId));
});

test('closing restores original inline styles and later mutations cannot hide drawer', async () => {
  const h = contentHarness(); await h.hover(); await h.advance(150);
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0');
  assert.equal(h.drawer.style.getPropertyValue('pointer-events'), 'none');
  h.close(); await h.mutate(); await h.advance(4000);
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
  assert.equal(h.drawer.style.getPropertyPriority('left'), 'important');
  assert.equal(h.drawer.style.getPropertyValue('position'), 'absolute');
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
  assert.equal(h.drawer.style.getPropertyPriority('opacity'), '');
  assert.equal(h.drawer.style.getPropertyValue('pointer-events'), 'auto');
  assert.equal(h.drawer.style.getPropertyPriority('pointer-events'), 'important');
});

test('hiding the native drawer preserves its geometry for X autofocus', async () => {
  const h = contentHarness(); await h.hover(); await h.advance(150); await h.mutate();
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0');
  assert.equal(h.drawer.style.getPropertyValue('position'), 'absolute');
  assert.equal(h.drawer.style.getPropertyPriority('position'), '');
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
  assert.equal(h.drawer.style.getPropertyPriority('left'), 'important');
  assert.equal(h.drawer.style.getPropertyValue('top'), '140px');
  assert.equal(h.drawer.style.getPropertyPriority('top'), '');
});

test('redo supersedes the earlier delayed click and ignores its response', async () => {
  const h = contentHarness(); await h.hover(); const first = h.arm(); h.redo();
  await h.advance(150);
  assert.equal(h.button.clicks, 1);
  h.message({ __xdbh: 'grok-chunk', reqId: first.reqId, text: 'obsolete' });
  const current = h.arm();
  h.message({ __xdbh: 'grok-start', reqId: current.reqId });
  h.message({ __xdbh: 'grok-chunk', reqId: current.reqId, text: 'current' });
  h.message({ __xdbh: 'grok-done', reqId: current.reqId });
  assert.equal(h.cards.at(-1).querySelector('.xdbh-text').innerHTML, 'current');
  assert.equal(h.writes.length, 1);
  await h.mutate(); assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
});

test('disable and mode changes cancel delayed actions', async () => {
  for (const value of [{ enabled: false }, { mode: 'demo' }]) {
    const h = contentHarness(); await h.hover(); h.change(value); await h.advance(15000);
    assert.equal(h.button.clicks || 0, 0);
    assert.equal(h.cards.at(-1).connected, false);
  }
});

test('capture requires enabled extension, learn mode and explicit opt-in', async () => {
  for (const [settings, expected] of [[{}, false], [{ capture: true }, false], [{ mode: 'learn' }, false], [{ mode: 'learn', capture: true }, true], [{ enabled: false, mode: 'learn', capture: true }, false]]) {
    const h = contentHarness(settings); await h.advance(0);
    assert.equal(h.messages.find((d) => d.__xdbh === 'config').capture, expected);
    h.message({ __xdbh: 'capture', payload: { reqBody: 'private' } }); await h.advance(0);
    assert.equal(h.writes.length, expected ? 1 : 0);
  }
});

test('a started but stalled response times out and restores drawer', async () => {
  const h = contentHarness(); await h.hover(); await h.advance(150);
  h.message({ __xdbh: 'grok-start', reqId: h.arm().reqId });
  await h.advance(120000);
  assert.match(h.cards.at(-1).querySelector('.xdbh-text').textContent, /超时/);
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
});

test('closing before animation frame does not access a removed card', async () => {
  const h = contentHarness(); await h.hover(); h.close(); await h.advance(16);
});

test('cached results never hide the native drawer or activate Grok', async () => {
  const h = contentHarness({}, { raw: 'cached', sources: [] }); await h.hover(); await h.mutate();
  assert.equal(h.arm(), undefined);
  assert.equal(h.cards.at(-1).querySelector('.xdbh-text').innerHTML, 'cached');
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
});

function hookHarness(fetchImpl) {
  let listener;
  const posts = [], requests = [];
  class XHR { open() {} send() {} }
  class Socket {
    constructor(url = 'wss://grok.com/ws') { this.url = url; this.sent = []; this.listeners = {}; }
    send(data) { this.sent.push(data); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    emit(type, data) { for (const fn of this.listeners[type] || []) fn({ data }); }
    receive(frame) { this.emit('message', JSON.stringify(frame)); }
  }
  const window = {
    XMLHttpRequest: XHR,
    WebSocket: Socket,
    fetch(input, init) { requests.push({ input, init }); return fetchImpl ? fetchImpl(input, init) : Promise.resolve(new Response('{"result":{"messageTag":"final","message":"answer"}}\n')); },
    addEventListener: (_, fn) => { listener = fn; },
    postMessage: (d) => posts.push(d),
  };
  vm.runInNewContext(source('inject.js'), { window, Request, URL, TextDecoder, console: { log() {} }, location: { origin: 'https://x.com' } });
  return { window, posts, requests, socket: () => new Socket(), message: (d) => listener({ source: window, data: d }) };
}
const requestBody = JSON.stringify({ conversationId: 'c', responses: [{ message: 'https://x.com/a/status/1' }], promptMetadata: { type: 'GROK_ANALYZE' } });
const arm = (h, id = 'r1') => h.message({ __xdbh: 'arm', reqId: id, prompt: 'plain', tweetText: 'original text' });
const fetchGrok = (h, headers) => h.window.fetch('https://x.com/i/api/grok/add_response', { method: 'POST', body: requestBody, headers });
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };

test('hook starts with capture disabled', async () => {
  const h = hookHarness(); await fetchGrok(h); await settle();
  assert.equal(h.posts.length, 0);
});

test('a stale disarm cannot disarm a newer request', async () => {
  const h = hookHarness(); arm(h, 'old'); arm(h, 'new');
  h.message({ __xdbh: 'disarm', reqId: 'old' }); await fetchGrok(h); await settle();
  assert.match(JSON.parse(h.requests[0].init.body).responses[0].message, /original text/);
  assert.ok(h.posts.some((d) => d.__xdbh === 'grok-done' && d.reqId === 'new'));
});

test('closing before fetch response prevents any obsolete card messages, preserves X response', async () => {
  let resolve; const h = hookHarness(() => new Promise((r) => { resolve = r; }));
  arm(h); const response = fetchGrok(h); h.message({ __xdbh: 'disarm', reqId: 'r1' });
  resolve(new Response('native response')); assert.equal(await (await response).text(), 'native response');
  await settle(); assert.equal(h.posts.length, 0);
});

test('capture disabled then re-enabled does not revive an earlier response', async () => {
  let resolve; const h = hookHarness(() => new Promise((r) => { resolve = r; }));
  h.message({ __xdbh: 'config', capture: true }); const response = fetchGrok(h);
  h.message({ __xdbh: 'config', capture: false }); h.message({ __xdbh: 'config', capture: true });
  resolve(new Response('private response')); await response; await settle(); assert.equal(h.posts.length, 0);
});

test('tuple-form headers redact credentials when capture is explicitly enabled', async () => {
  const h = hookHarness(); h.message({ __xdbh: 'config', capture: true });
  await fetchGrok(h, [['Authorization', 'secret-token'], ['Content-Type', 'application/json']]); await settle();
  assert.equal(h.posts.length, 1);
  assert.ok(!JSON.stringify(h.posts).includes('secret-token'));
  assert.equal(h.posts[0].payload.reqHeaders['Content-Type'], 'application/json');
});

test('HTTP failures report error instead of treating the body as a completed explanation', async () => {
  const h = hookHarness(() => Promise.resolve(new Response('rate limited', { status: 429 })));
  arm(h); await fetchGrok(h); await settle();
  assert.ok(h.posts.some((d) => d.__xdbh === 'grok-error' && /429/.test(d.error)));
  assert.ok(!h.posts.some((d) => d.__xdbh === 'grok-done'));
});


test('moving within the current tweet does not restart its explanation', async () => {
  const h = contentHarness(); await h.hover(); await h.advance(150);
  h.mouseover(); await h.advance(1500);
  assert.equal(h.button.clicks, 1);
  assert.equal(h.cards.length, 1);
});

test('invalidated extension teardown is idempotent even for its own messages', async () => {
  const h = contentHarness(); await h.hover(); h.invalidate();
  h.message({ __xdbh: 'grok-start', reqId: h.arm().reqId });
  const count = h.messages.length;
  for (const message of h.messages.slice()) h.message(message);
  assert.equal(h.messages.length, count);
  await h.advance(1000);
  assert.equal(h.button.clicks || 0, 0);
});

test('closing during streaming cancels only the extension reader', async () => {
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; } });
  const h = hookHarness(() => Promise.resolve(new Response(stream)));
  arm(h); const native = await fetchGrok(h);
  controller.enqueue(new TextEncoder().encode('{"result":{"messageTag":"final","message":"first"}}\n'));
  await settle();
  assert.ok(h.posts.some((d) => d.__xdbh === 'grok-chunk'));
  h.message({ __xdbh: 'disarm', reqId: 'r1' });
  const count = h.posts.length;
  controller.enqueue(new TextEncoder().encode('{"result":{"messageTag":"final","message":"late"}}\n'));
  controller.close();
  assert.match(await native.text(), /late/);
  await settle();
  assert.equal(h.posts.length, count);
});

test('disabling drawer hiding mid-request restores immediately and stays restored', async () => {
  const h = contentHarness(); await h.hover(); await h.advance(300);
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0');
  h.change({ hideDrawer: false }); await h.mutate();
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
  assert.equal(h.drawer.style.getPropertyValue('pointer-events'), 'auto');
});

test('closing a demo run stops its pending output', async () => {
  const h = contentHarness({ mode: 'demo' }); await h.hover(); h.close(); await h.advance(1000);
  assert.equal(h.cards.at(-1).querySelector('.xdbh-text').textContent, '');
});


test('closing article fallback after filling input cancels its delayed send', async () => {
  const h = contentHarness(); const { input, send } = h.drawerFallback();
  await h.hover(); await h.advance(300);
  assert.equal(input.textContent, '总结');
  h.close(); await h.advance(20000);
  assert.equal(send.clicks || 0, 0);
});

test('first-response timeout disarms the hook and restores the native drawer', async () => {
  const h = contentHarness(); await h.hover(); const reqId = h.arm().reqId;
  await h.advance(10500);
  assert.match(h.cards.at(-1).querySelector('.xdbh-text').textContent, /没等到/);
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
  assert.ok(h.messages.some((d) => d.__xdbh === 'disarm' && d.reqId === reqId));
});

function finish(h, text) {
  const reqId = h.arm().reqId;
  h.message({ __xdbh: 'grok-start', reqId });
  h.message({ __xdbh: 'grok-chunk', reqId, text });
  h.message({ __xdbh: 'grok-done', reqId });
}

test('cached explanation supports multiple followups without replacing the explanation cache', async () => {
  const h = contentHarness({}, { raw: 'original explanation', sources: [] });
  const { input, send } = h.drawerFallback(); send.onclick = () => { input.value = ''; };
  await h.hover(); h.question('Why?'); h.submit(); h.submit();
  assert.equal(h.messages.filter((m) => m.__xdbh === 'arm').length, 1);
  assert.match(h.arm().message, /original explanation/);
  await h.advance(400); assert.equal(send.clicks, 1);
  finish(h, 'Because.');
  h.question('Example?'); h.submit();
  assert.match(h.arm().message, /Why\?/); assert.match(h.arm().message, /Because\./);
  assert.match(h.arm().message, /Example\?/);
  await h.advance(400); finish(h, 'An example.');
  assert.equal(h.cards.at(-1).querySelector('.xdbh-text').innerHTML, 'original explanation');
  assert.equal(h.cards.at(-1).querySelector('.xdbh-thread').childNodes.length, 2);
  assert.equal(h.writes.length, 0);
});

test('fresh explanation unlocks composer and followup answers do not overwrite the cached summary', async () => {
  const h = contentHarness(); await h.hover(); await h.advance(150); finish(h, 'fresh explanation');
  const { input, send } = h.drawerFallback(); send.onclick = () => { input.value = ''; };
  h.question('Explain more'); h.submit(); await h.advance(400); finish(h, 'more detail');
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].raw, 'fresh explanation');
});

test('typing and chatting pin the card against outside clicks and other tweets', async () => {
  const h = contentHarness({}, { raw: 'cached', sources: [] }); await h.hover();
  h.question('draft').focus(); h.outside();
  const other = new Element(); other.closest = () => other;
  h.mouseover(other); await h.advance(2000);
  assert.equal(h.cards.length, 1); assert.equal(h.cards[0].connected, true);
  h.close(); assert.equal(h.cards[0].connected, false);
});

test('IME composition and Shift+Enter never submit a question', async () => {
  const h = contentHarness({}, { raw: 'cached', sources: [] }); await h.hover();
  const input = h.question('中文问题');
  for (const e of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
    input.listeners.keydown({ key: 'Enter', preventDefault() {}, ...e });
  }
  assert.equal(h.arm(), undefined);
  input.listeners.keydown({ key: 'Enter', preventDefault() {} }); assert.ok(h.arm().followup);
});

test('failed followup restores the question for retry and excludes failed output from context', async () => {
  const h = contentHarness({}, { raw: 'cached', sources: [] }); const { input, send } = h.drawerFallback();
  send.onclick = () => { input.value = ''; }; await h.hover(); h.question('retry me'); h.submit();
  await h.advance(400);
  h.message({ __xdbh: 'grok-chunk', reqId: h.arm().reqId, text: 'incomplete answer' });
  h.message({ __xdbh: 'grok-error', reqId: h.arm().reqId, error: 'offline' });
  assert.equal(h.cards[0].querySelector('.xdbh-question').value, 'retry me');
  assert.equal(h.cards[0].querySelector('.xdbh-question').disabled, false);
  h.submit(); assert.ok(!h.arm().message.includes('incomplete answer'));
});

test('native handoff fills contextual draft, preserves card, and never auto-sends', async () => {
  const h = contentHarness({}, { raw: 'cached explanation', sources: [] }); const { input, send } = h.drawerFallback();
  await h.hover(); h.question('native question'); h.native(); await h.advance(500);
  assert.match(input.value, /cached explanation/); assert.match(input.value, /native question/);
  assert.equal(send.clicks || 0, 0); assert.equal(h.arm(), undefined);
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
  assert.equal(h.cards[0].querySelector('.xdbh-question').value, 'native question');
});

test('native and inline followup preserve existing Grok drafts', async () => {
  for (const native of [false, true]) {
    const h = contentHarness({}, { raw: 'cached', sources: [] }); const { input, send } = h.drawerFallback();
    input.value = 'my existing draft'; await h.hover(); h.question('next question');
    if (native) h.native(); else h.submit();
    await h.advance(500);
    assert.equal(input.value, 'my existing draft'); assert.equal(send.clicks || 0, 0);
    assert.equal(h.cards[0].querySelector('.xdbh-question').disabled, false);
  }
});

test('closing a followup before send removes only the extension draft and never sends it', async () => {
  const h = contentHarness({}, { raw: 'cached', sources: [] }); const { input, send } = h.drawerFallback();
  await h.hover(); h.question('next'); h.submit(); await h.advance(130);
  assert.match(input.value, /next/); h.close(); await h.advance(500);
  assert.equal(input.value, ''); assert.equal(send.clicks || 0, 0);
});

test('native draft changes are not overwritten or sent during a pending followup', async () => {
  const h = contentHarness({}, { raw: 'cached', sources: [] }); const { input, send } = h.drawerFallback();
  await h.hover(); h.question('next'); h.submit(); await h.advance(130);
  input.value = 'edited by user'; await h.advance(500);
  assert.equal(input.value, 'edited by user'); assert.equal(send.clicks || 0, 0);
});

test('disabled native send button fails safely and retains question for retry', async () => {
  const h = contentHarness({}, { raw: 'cached', sources: [] }); const { input, send } = h.drawerFallback();
  send.disabled = true; await h.hover(); h.question('next'); h.submit(); await h.advance(2100);
  assert.equal(send.clicks || 0, 0); assert.equal(input.value, '');
  assert.equal(h.cards[0].querySelector('.xdbh-question').value, 'next');
});

test('followup hook only consumes the exact prepared message and preserves native conversation ID', async () => {
  const h = hookHarness();
  h.message({ __xdbh: 'arm', reqId: 'followup', followup: true, message: 'specific context and question' });
  await fetchGrok(h); await settle();
  assert.equal(h.requests[0].init.body, requestBody); assert.equal(h.posts.length, 0);
  const body = JSON.parse(requestBody); body.responses[0].message = 'specific context and question';
  await h.window.fetch('https://x.com/i/api/grok/add_response', { method: 'POST', body: JSON.stringify(body) }); await settle();
  const sent = JSON.parse(h.requests[1].init.body);
  assert.equal(sent.conversationId, 'c'); assert.equal(sent.promptMetadata, undefined);
  assert.equal(sent.responses[0].message, 'specific context and question');
  assert.ok(h.posts.some((m) => m.__xdbh === 'grok-done' && m.reqId === 'followup'));
});

test('oversized context is rejected rather than silently losing the original explanation', () => {
  const context = vm.createContext({}); vm.runInContext(source('conversation.js'), context);
  assert.throws(() => context.xdbhConversationPrompt({ initial: 'a'.repeat(60000) }, 'why'), /60000/);
  assert.throws(() => context.xdbhConversationPrompt({}, 'a'.repeat(2001)), /2000/);
});

test('followups retain citation sources from cached explanations and each completed answer', async () => {
  const source1 = { url: 'https://example.org/first', title: 'First source' };
  const source2 = { url: 'https://example.org/second', title: 'Second source' };
  const h = contentHarness({}, { raw: 'answer [1]', sources: [source1] });
  const { input, send } = h.drawerFallback(); send.onclick = () => { input.value = ''; };
  await h.hover(); h.question('第1个来源可信吗？'); h.submit();
  assert.match(h.arm().message, /https:\/\/example.org\/first/);
  await h.advance(400);
  h.message({ __xdbh: 'grok-start', reqId: h.arm().reqId });
  h.message({ __xdbh: 'grok-sources', reqId: h.arm().reqId, sources: [source2] });
  h.message({ __xdbh: 'grok-chunk', reqId: h.arm().reqId, text: 'second answer [1]' });
  h.message({ __xdbh: 'grok-done', reqId: h.arm().reqId });
  h.native(); await h.advance(200);
  assert.match(input.value, /https:\/\/example.org\/first/);
  assert.match(input.value, /https:\/\/example.org\/second/);
});


test('native handoff refuses a read-only input rather than reporting a prepared draft', async () => {
  const h = contentHarness({}, { raw: 'cached', sources: [] }); const { input } = h.drawerFallback();
  input.readOnly = true; await h.hover(); h.native(); await h.advance(300);
  assert.equal(input.value, '');
  assert.match(h.cards[0].querySelector('.xdbh-status').textContent, /未能/);
});

const socketRequest = (text = 'https://x.com/a/status/1', eventId = 'client-1') => ({
  session_id: 'session-1',
  event: { type: 'response.create', event_id: eventId, item: {
    type: 'message', role: 'user', content: [{ type: 'input_text', text }],
    x_grok: { client_message_id: 'native-message' },
  } },
});
const socketEvent = (event, session = 'session-1') => ({ session_id: session, event });
const socketStart = (socket, clientId = 'client-1', responseId = 'response-1') => socket.receive(socketEvent({
  type: 'response.created', client_event_id: clientId, response: { id: responseId, status: 'in_progress' },
}));
const socketChunk = (socket, text, responseId = 'response-1', channel = 'CHANNEL_ASSISTANT_RESPONSE') => socket.receive(socketEvent({
  type: 'response.chunk', response_id: responseId, chunk: { text: { text, channel } },
}));
const socketDone = (socket, status = 'completed') => socket.receive(socketEvent({
  type: 'response.done', response: { id: 'response-1', status },
}));

test('initial WebSocket explanations request quick answers without changing native sessions or followups', () => {
  const h = hookHarness(), socket = h.socket();
  const session = JSON.stringify({ session_id: 'session-1', event: { type: 'session.create', session: { model: 'auto' } } });
  arm(h); socket.send(session); socket.send(JSON.stringify(socketRequest()));
  assert.equal(socket.sent[0], session);
  assert.equal(JSON.parse(socket.sent[1]).event.steer_action, 'quick_answer');
  socketStart(socket); socketChunk(socket, 'answer'); socketDone(socket);
  h.message({ __xdbh: 'arm', reqId: 'followup', followup: true, message: 'explain deeply' });
  const followup = socketRequest('explain deeply'); followup.event.steer_action = 'think_harder';
  socket.send(JSON.stringify(followup));
  assert.equal(JSON.parse(socket.sent.at(-1)).event.steer_action, 'think_harder');
});

test('complete text explanations avoid URL fetching while incomplete content retains its source', async () => {
  for (const complete of [true, false]) {
    const h = hookHarness(), socket = h.socket();
    h.message({ __xdbh: 'arm', reqId: 'r1', prompt: 'plain', tweetText: 'original text', textComplete: complete, tweetUrl: 'https://x.com/a/status/1' });
    socket.send(JSON.stringify(socketRequest()));
    const text = JSON.parse(socket.sent[0]).event.item.content[0].text;
    assert.match(text, /original text/);
    assert.equal(text.includes('https://x.com/a/status/1'), !complete);
    if (complete) assert.match(text, /不要搜索/);
    const legacy = hookHarness();
    legacy.message({ __xdbh: 'arm', reqId: 'r1', prompt: 'plain', tweetText: 'original text', textComplete: complete });
    await fetchGrok(legacy); await settle();
    assert.equal(JSON.parse(legacy.requests[0].init.body).responses[0].message.includes('https://x.com/a/status/1'), !complete);
  }
});

test('only complete plain tweets with the default prompt take the text-only path', async () => {
  for (const scenario of ['plain', 'media', 'collapsed', 'article', 'quoted-article', 'link-card', 'custom']) {
    const h = contentHarness(scenario === 'custom' ? { prompt: 'Search and verify this claim' } : {});
    const query = h.tweet.querySelector.bind(h.tweet);
    const blocker = { media: 'tweetPhoto', collapsed: 'tweet-text-show-more-link', 'quoted-article': 'article-cover-image', 'link-card': 'card.wrapper' }[scenario];
    if (blocker) {
      h.tweet.querySelector = (sel) => sel.includes(blocker) ? new Element() : query(sel);
    }
    if (scenario === 'article') {
      const all = h.tweet.querySelectorAll;
      h.tweet.querySelectorAll = sel => sel.includes('tweetText') ? [] : all(sel);
    }
    await h.hover();
    assert.equal(h.arm().textComplete, scenario === 'plain', scenario);
  }
});

test('Grok WebSocket requests on an existing socket are rewritten and streamed to the card', () => {
  const h = hookHarness(), socket = h.socket(), original = socketRequest();
  socket.send(JSON.stringify({ event: { type: 'ping' } }));
  arm(h); socket.send(JSON.stringify(original));
  const sent = JSON.parse(socket.sent[1]);
  assert.match(sent.event.item.content[0].text, /original text/);
  assert.equal(sent.session_id, original.session_id);
  assert.equal(sent.event.event_id, original.event.event_id);
  assert.deepEqual(sent.event.item.x_grok, original.event.item.x_grok);
  socketStart(socket); socketChunk(socket, '思考中', 'response-1', 'CHANNEL_ASSISTANT_NOTETAKER_HEADER');
  socketChunk(socket, '中文'); socketChunk(socket, '回答'); socketDone(socket);
  assert.equal(h.posts.filter(m => m.__xdbh === 'grok-chunk').map(m => m.text).join(''), '中文回答');
  assert.ok(h.posts.some(m => m.__xdbh === 'grok-done' && m.reqId === 'r1'));
});

test('WebSocket responses are correlated by socket, session, client event and response ID', () => {
  const h = hookHarness(), socket = h.socket(), other = h.socket();
  arm(h); socket.send(JSON.stringify(socketRequest()));
  other.send(JSON.stringify({ event: { type: 'ping' } })); socketStart(other);
  socketStart(socket, 'unrelated'); socketChunk(socket, 'unrelated');
  socket.receive(socketEvent({ type: 'response.created', client_event_id: 'client-1', response: { id: 'response-1' } }, 'other-session'));
  assert.ok(!h.posts.some(m => m.__xdbh === 'grok-start'));
  socketStart(socket); socketChunk(socket, 'wrong response', 'old-response'); socketChunk(socket, 'correct');
  assert.deepEqual(h.posts.filter(m => m.__xdbh === 'grok-chunk').map(m => m.text), ['correct']);
});

test('WebSocket followups consume only the exact prepared draft and disarm leaves native traffic intact', () => {
  const h = hookHarness(), socket = h.socket();
  h.message({ __xdbh: 'arm', reqId: 'followup', followup: true, message: 'context and question' });
  const native = JSON.stringify(socketRequest('native question'));
  socket.send(native); assert.equal(socket.sent[0], native);
  socket.send(JSON.stringify(socketRequest('context and question'))); socketStart(socket);
  assert.ok(h.posts.some(m => m.__xdbh === 'grok-start' && m.reqId === 'followup'));
  h.message({ __xdbh: 'disarm', reqId: 'followup' }); const count = h.posts.length;
  socketChunk(socket, 'late'); socketDone(socket); socket.send(native);
  assert.equal(h.posts.length, count); assert.equal(socket.sent.at(-1), native);
});

test('new contenteditable Grok input supports followup sends and draft-only native handoff', async () => {
  for (const native of [false, true]) {
    const h = contentHarness({}, { raw: 'cached explanation', sources: [] });
    const { input, send } = h.drawerFallback(true);
    await h.hover(); h.question('new question');
    if (native) h.native(); else h.submit();
    await h.advance(500);
    assert.match(input.textContent, /cached explanation/); assert.match(input.textContent, /new question/);
    assert.equal(send.clicks || 0, native ? 0 : 1);
  }
});

test('native draft handoff and rich editor followup focus never request page scrolling', async () => {
  for (const [rich, native] of [[false, true], [true, true], [true, false]]) {
    const h = contentHarness({}, { raw: 'cached explanation', sources: [] });
    const { input } = h.drawerFallback(rich);
    await h.hover(); h.question('next question');
    if (native) h.native(); else h.submit();
    await h.advance(500);
    assert.ok(input.focusOptions.length > 0);
    assert.ok(input.focusOptions.every(options => options?.preventScroll === true));
  }
});

test('clearing a cancelled rich editor draft preserves scroll during cleanup', async () => {
  const h = contentHarness({}, { raw: 'cached explanation', sources: [] });
  const { input, send } = h.drawerFallback(true);
  await h.hover(); h.question('next question'); h.submit(); await h.advance(130);
  h.close(); await h.advance(500);
  assert.equal(input.textContent, '');
  assert.equal(send.clicks || 0, 0);
  assert.equal(input.focusOptions.length, 2);
  assert.ok(input.focusOptions.every(options => options?.preventScroll === true));
});

test('contenteditable Grok input preserves existing or edited drafts and clears only cancelled extension drafts', async () => {
  for (const scenario of ['existing', 'edited', 'cancelled']) {
    const h = contentHarness({}, { raw: 'cached', sources: [] });
    const { input, send } = h.drawerFallback(true);
    if (scenario === 'existing') input.textContent = 'my draft';
    await h.hover(); h.question('next'); h.submit(); await h.advance(130);
    if (scenario === 'edited') input.textContent = 'my draft';
    if (scenario === 'cancelled') h.close();
    await h.advance(500);
    assert.equal(input.textContent, scenario === 'cancelled' ? '' : 'my draft');
    assert.equal(send.clicks || 0, 0);
  }
});

test('unarmed and non-Grok sockets pass through without card messages; disconnects fail the active request', () => {
  const h = hookHarness(), socket = h.socket(), other = new h.window.WebSocket('wss://example.org/chat');
  const data = JSON.stringify(socketRequest()); socket.send(data);
  assert.equal(socket.sent[0], data); assert.equal(h.posts.length, 0);
  arm(h); other.send(data); assert.equal(other.sent[0], data);
  socket.send(data); socketStart(socket); socket.emit('close');
  assert.ok(h.posts.some(m => m.__xdbh === 'grok-error' && /连接中断/.test(m.error)));
});

test('WebSocket duplicate events and output_text.done do not append the answer twice', () => {
  const h = hookHarness(), socket = h.socket(); arm(h); socket.send(JSON.stringify(socketRequest())); socketStart(socket);
  const event = socketEvent({ type: 'response.chunk', event_id: 'same', response_id: 'response-1', chunk: {
    text: { text: 'answer', channel: 'CHANNEL_ASSISTANT_RESPONSE' },
  } });
  socket.receive(event); socket.receive(event);
  socket.receive(socketEvent({ type: 'response.output_text.done', response_id: 'response-1', text: 'answer' })); socketDone(socket);
  assert.equal(h.posts.filter(m => m.__xdbh === 'grok-chunk').map(m => m.text).join(''), 'answer');
});

test('WebSocket text delta and final-only variants return one answer and malformed native frames pass through', () => {
  for (const variant of ['delta', 'final-only']) {
    const h = hookHarness(), socket = h.socket(); arm(h);
    for (const frame of [null, { session_id: 'session-1', event: { type: 'response.create', event_id: 'invalid' } }]) {
      const data = JSON.stringify(frame); socket.send(data); assert.equal(socket.sent.at(-1), data);
    }
    socket.send(JSON.stringify(socketRequest())); socketStart(socket);
    if (variant === 'delta') {
      socket.receive(socketEvent({ type: 'response.output_text.delta', response_id: 'response-1', delta: 'answer' }));
    }
    socket.receive(socketEvent({ type: 'response.output_text.done', response_id: 'response-1', text: 'answer' })); socketDone(socket);
    assert.equal(h.posts.filter(m => m.__xdbh === 'grok-chunk').map(m => m.text).join(''), 'answer');
  }
});

test('WebSocket tool results supply citation sources and incomplete responses report an error', () => {
  const h = hookHarness(), socket = h.socket(); arm(h); socket.send(JSON.stringify(socketRequest())); socketStart(socket);
  socket.receive(socketEvent({ type: 'response.chunk', response_id: 'response-1', chunk: {
    tool_result: { web_search: { webpages: [{ url: 'https://example.org/source', title: 'Source' }] } },
  } }));
  socketChunk(socket, 'partial'); socketDone(socket, 'failed');
  assert.equal(h.posts.find(m => m.__xdbh === 'grok-sources')?.sources[0].url, 'https://example.org/source');
  assert.ok(h.posts.some(m => m.__xdbh === 'grok-error'));
  assert.ok(!h.posts.some(m => m.__xdbh === 'grok-done'));
});

/* ==================== 第三方 API 模式 ==================== */

// aiconfig.js 是纯函数模块，单独起一个上下文就能直接调。
function configContext() {
  const context = vm.createContext({ URL, console: { log() {} } });
  vm.runInContext(source('aiconfig.js'), context);
  return context;
}

function apiService(overrides = {}) {
  return Object.assign({
    id: 'xai',
    name: 'xAI Grok',
    apiUrl: 'https://api.x.ai/v1/chat/completions',
    apiKey: 'test-key',
    model: 'grok-3-mini',
    temperature: 0.3,
  }, overrides);
}

function streamResponse(chunks, init = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, Object.assign({ status: 200, headers: { 'content-type': 'text/event-stream' } }, init));
}

function backgroundHarness(fetchImpl) {
  const listeners = {}, requests = [];
  const chrome = {
    runtime: {
      onConnect: { addListener: (fn) => { listeners.connect = fn; } },
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
    },
  };
  const context = vm.createContext({
    chrome, importScripts() {}, console: { log() {} }, URL,
    fetch: (url, init) => { requests.push({ url, init }); return fetchImpl(url, init); },
    setTimeout, clearTimeout, AbortController, TextDecoder, TextEncoder, Response, ReadableStream,
  });
  vm.runInContext(source('aiconfig.js'), context);
  vm.runInContext(source('background.js'), context);
  return {
    requests,
    port(name = 'xdbh-api') {
      const port = {
        name, sent: [], listeners: {},
        onMessage: { addListener: (fn) => { port.listeners.message = fn; } },
        onDisconnect: { addListener: (fn) => { port.listeners.disconnect = fn; } },
        postMessage: (message) => port.sent.push(message),
        disconnect() { port.disconnected = true; port.listeners.disconnect?.(); },
        start(message) { port.listeners.message?.(message); },
      };
      listeners.connect(port);
      return port;
    },
    message(message, sendResponse) { return listeners.message(message, {}, sendResponse); },
  };
}

test('prompt templates fill known placeholders, keep unknown ones, and append raw legacy prompts', () => {
  const c = configContext();
  const vars = { text: '正文', url: 'https://x.com/a/status/1', author: '张三', handle: '@zhangsan', expert: '大白话' };
  assert.equal(c.xdbhRenderTemplate('解释:{{text}}', vars), '解释:正文');
  assert.equal(c.xdbhRenderTemplate('{{author}} {{handle}} 说了 {{text}}', vars), '张三 @zhangsan 说了 正文');
  assert.equal(c.xdbhRenderTemplate('{{nope}} {{text}}', vars), '{{nope}} 正文');
  assert.equal(c.xdbhRenderTemplate('只解释这段:', vars), '只解释这段:\n\n正文');
  // 主世界会自己追加正文，所以 Grok 模式渲染时把 {{text}} 置空。
  assert.equal(c.xdbhRenderTemplate('解释:{{text}}', { text: '' }), '解释:');
});

test('service registry keeps preset defaults, applies user edits, and reports what is missing', () => {
  const c = configContext();
  const list = c.xdbhNormalizeServices([
    { id: 'xai', apiKey: 'k1' },
    { id: 'mine', name: '自建网关', apiUrl: 'https://gw.example.com/v1/chat/completions', model: 'm', apiKey: 'k2' },
  ]);
  const xai = list.find((s) => s.id === 'xai');
  assert.equal(xai.apiUrl, 'https://api.x.ai/v1/chat/completions');
  assert.equal(xai.apiKey, 'k1');
  assert.equal(xai.model, 'grok-3-mini');
  assert.equal(list.length, 9);
  assert.equal(list.at(-1).name, '自建网关');
  assert.equal(c.xdbhServiceReady(xai), '');
  assert.equal(c.xdbhServiceReady(list.find((s) => s.id === 'openai')), '还没填 API Key');
  assert.equal(c.xdbhServiceReady({ apiUrl: 'http://localhost:11434/v1/chat/completions', model: 'llama3.1', apiKey: '' }), '');
  assert.equal(c.xdbhServiceReady({ apiUrl: 'https://a.example.com', model: '', apiKey: 'k' }), '还没填模型名');
  assert.equal(c.xdbhServiceReady({ apiUrl: '', model: 'm', apiKey: 'k' }), '还没填接口地址');
  assert.equal(c.xdbhOriginPattern('https://api.x.ai/v1/chat/completions'), 'https://api.x.ai/*');
  assert.equal(c.xdbhOriginPattern('不是一个网址'), '');
});

test('settings migration only moves a customized legacy prompt to the custom expert', () => {
  const c = configContext();
  const untouched = c.xdbhNormalizeSettings({ prompt: '用大白话、口语化的中文解释下面这条推文在讲什么,必要时补一句背景。别复述原文,直接说人话:' });
  assert.equal(untouched.activeExpertId, 'plain');
  const edited = c.xdbhNormalizeSettings({ prompt: '用东北话解释:' });
  assert.equal(edited.activeExpertId, 'custom');
  assert.equal(edited.prompt, '用东北话解释:');
  assert.equal(edited.experts.find((e) => e.id === 'custom').prompt, '用东北话解释:');
  const chosen = c.xdbhNormalizeSettings({ activeExpertId: 'tech' });
  assert.equal(chosen.prompt, c.xdbhActiveExpert(chosen).prompt);
  assert.match(chosen.prompt, /技术点/);
  assert.equal(c.xdbhActiveService(c.xdbhNormalizeSettings({ activeServiceId: 'deepseek' })).id, 'deepseek');
  assert.equal(c.xdbhActiveExpert(c.xdbhNormalizeSettings({ activeExpertId: '不存在' })).id, 'plain');
});

test('api followup messages carry the system prompt, first answer and completed turns only', () => {
  const context = vm.createContext({ console: { log() {} } });
  vm.runInContext(source('conversation.js'), context);
  const messages = context.xdbhApiMessages({
    system: 'sys', initialPrompt: 'first', initialAnswer: 'answer',
    turns: [{ state: 'done', question: 'q1', raw: 'a1' }, { state: 'pending', question: 'q2', raw: '' }],
    question: 'q3',
  });
  assert.deepEqual(Array.from(messages, (m) => m.role), ['system', 'user', 'assistant', 'user', 'assistant', 'user']);
  assert.deepEqual(Array.from(messages, (m) => m.content), ['sys', 'first', 'answer', 'q1', 'a1', 'q3']);
  assert.throws(() => context.xdbhApiMessages({ question: '   ' }), /请输入/);
  assert.throws(() => context.xdbhApiMessages({ question: 'x'.repeat(2001) }), /2000/);
  assert.throws(() => context.xdbhApiMessages({ question: 'ok', initialAnswer: 'x'.repeat(60001) }), /60000/);
});

test('background streams OpenAI-style SSE deltas, sends the bearer token, and finishes once', async () => {
  const h = backgroundHarness(() => Promise.resolve(streamResponse([
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n',
  ])));
  const port = h.port();
  port.start({ type: 'start', service: apiService(), messages: [{ role: 'user', content: 'hi' }] });
  await settle();
  assert.deepEqual(port.sent.filter((m) => m.type === 'chunk').map((m) => m.text), ['你', '好']);
  assert.equal(port.sent.filter((m) => m.type === 'done').length, 1);
  assert.equal(port.sent.some((m) => m.type === 'error'), false);
  const body = JSON.parse(h.requests[0].init.body);
  assert.equal(body.stream, true);
  assert.equal(body.model, 'grok-3-mini');
  assert.equal(body.messages[0].content, 'hi');
  assert.equal(h.requests[0].url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(h.requests[0].init.headers.Authorization, 'Bearer test-key');
});

test('background surfaces HTTP failures as readable errors and never reports done', async () => {
  const h = backgroundHarness(() => Promise.resolve(new Response(
    JSON.stringify({ error: { message: 'bad key' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )));
  const port = h.port();
  port.start({ type: 'start', service: apiService(), messages: [] });
  await settle();
  const error = port.sent.find((m) => m.type === 'error');
  assert.match(error.error, /API Key 无效/);
  assert.match(error.error, /bad key/);
  assert.equal(port.sent.some((m) => m.type === 'done'), false);
});

test('background falls back to a plain JSON answer when the gateway does not stream', async () => {
  const h = backgroundHarness(() => Promise.resolve(new Response(
    JSON.stringify({ choices: [{ message: { content: '完整回答' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )));
  const port = h.port();
  port.start({ type: 'start', service: apiService(), messages: [] });
  await settle();
  assert.equal(port.sent.find((m) => m.type === 'chunk').text, '完整回答');
  assert.equal(port.sent.filter((m) => m.type === 'done').length, 1);
});

test('background aborts the upstream request when the content script disconnects', async () => {
  let signal;
  const h = backgroundHarness((_url, init) => {
    signal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  });
  const port = h.port();
  port.start({ type: 'start', service: apiService(), messages: [] });
  await settle();
  assert.equal(signal.aborted, false);
  port.disconnect();
  assert.equal(signal.aborted, true);
  await settle();
  assert.match(port.sent.find((m) => m.type === 'error').error, /中止/);
});

test('background refuses to call an unconfigured service or a stray port name', async () => {
  const h = backgroundHarness(() => { throw new Error('must not fetch'); });
  const port = h.port();
  port.start({ type: 'start', service: { apiUrl: '', model: '', apiKey: '' }, messages: [] });
  await settle();
  assert.match(port.sent.find((m) => m.type === 'error').error, /接口地址/);
  assert.equal(h.requests.length, 0);
  assert.equal(h.port('other').sent.length, 0);
});

test('the settings-page connection test reports success and failure without touching the card', async () => {
  const ok = backgroundHarness(() => Promise.resolve(new Response(
    JSON.stringify({ choices: [{ message: { content: 'pong' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )));
  let success;
  assert.equal(ok.message({ type: 'xdbh-api-test', service: apiService() }, (r) => { success = r; }), true);
  await settle();
  assert.equal(success.ok, true);

  const bad = backgroundHarness(() => Promise.resolve(new Response('nope', { status: 500 })));
  let failure;
  bad.message({ type: 'xdbh-api-test', service: apiService() }, (r) => { failure = r; });
  await settle();
  assert.equal(failure.ok, false);
  assert.match(failure.error, /HTTP 500/);

  const unconfigured = backgroundHarness(() => { throw new Error('must not fetch'); });
  let missing;
  unconfigured.message({ type: 'xdbh-api-test', service: { apiUrl: '', model: 'm', apiKey: 'k' } }, (r) => { missing = r; });
  assert.equal(missing.ok, false);
  assert.equal(unconfigured.requests.length, 0);
});

test('api mode explains what is missing instead of firing a request', async () => {
  const h = contentHarness({ mode: 'api' });
  await h.hover();
  assert.equal(h.ports.length, 0);
  assert.match(h.cards.at(-1).querySelector('.xdbh-text').textContent, /API Key/);
});

test('api mode renders the expert template and streams the backend answer into the card', async () => {
  const h = contentHarness({ mode: 'api', activeServiceId: 'xai', services: [{ id: 'xai', apiKey: 'k' }] });
  await h.hover();
  const port = h.ports.at(-1);
  assert.equal(port.name, 'xdbh-api');
  assert.equal(port.sent[0].type, 'start');
  assert.equal(port.sent[0].service.apiUrl, 'https://api.x.ai/v1/chat/completions');
  assert.equal(port.sent[0].messages[0].role, 'system');
  assert.match(port.sent[0].messages[1].content, /A sufficiently long original tweet/);
  port.push({ type: 'start' });
  port.push({ type: 'chunk', text: '答' });
  port.push({ type: 'chunk', text: '案' });
  assert.equal(h.cards.at(-1).querySelector('.xdbh-text').innerHTML, '答案');
  port.push({ type: 'done' });
  await h.advance(0);
  assert.deepEqual(h.writes.filter((w) => w.raw).map((w) => w.raw), ['答案']);
  // 第三方模式不碰 X 自己的 Grok 抽屉
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
  assert.equal(h.button.clicks || 0, 0);
});

test('api mode reports backend errors in the card and keeps the thread clean', async () => {
  const h = contentHarness({ mode: 'api', services: [{ id: 'xai', apiKey: 'k' }] });
  await h.hover();
  h.ports.at(-1).push({ type: 'error', error: '触发限流或额度不足（HTTP 429）' });
  await h.advance(0);
  assert.match(h.cards.at(-1).querySelector('.xdbh-text').textContent, /HTTP 429/);
  assert.equal(h.writes.length, 0);
});

test('api followups send a real multi-turn message array instead of a JSON blob', async () => {
  const h = contentHarness({ mode: 'api', services: [{ id: 'xai', apiKey: 'k' }] });
  await h.hover();
  const first = h.ports.at(-1);
  first.push({ type: 'start' });
  first.push({ type: 'chunk', text: '初次解读' });
  first.push({ type: 'done' });
  await h.advance(0);
  h.question('为什么?');
  h.submit();
  await h.advance(0);
  const messages = h.ports.at(-1).sent[0].messages;
  assert.deepEqual(Array.from(messages, (m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(messages[2].content, '初次解读');
  assert.equal(messages[3].content, '为什么?');
  // 追问走后台 API，不再驱动原生抽屉
  assert.equal(h.messages.some((m) => m.__xdbh === 'arm'), false);
});

test('closing the card aborts the in-flight api request', async () => {
  const h = contentHarness({ mode: 'api', services: [{ id: 'xai', apiKey: 'k' }] });
  await h.hover();
  const port = h.ports.at(-1);
  assert.equal(port.disconnected, undefined);
  h.close();
  assert.equal(port.disconnected, true);
});

test('switching the expert inside the card re-runs with that expert and persists the choice', async () => {
  const h = contentHarness({ mode: 'api', services: [{ id: 'xai', apiKey: 'k' }] });
  await h.hover();
  const select = h.cards.at(-1).querySelector('.xdbh-expert');
  select.value = 'tech';
  select.onchange();
  await h.advance(0);
  const port = h.ports.at(-1);
  assert.match(port.sent[0].messages[1].content, /技术点/);
  assert.equal(h.writes.some((w) => w.settings && w.settings.activeExpertId === 'tech'), true);
  assert.equal(h.cards.at(-1).connected, true);
});

test('expert selection also drives the Grok prompt without duplicating the tweet text', async () => {
  const h = contentHarness({ mode: 'grok', activeExpertId: 'summary' });
  await h.hover();
  const arm = h.arm();
  assert.match(arm.prompt, /3 到 5 条短句/);
  assert.match(arm.prompt, /【原文】/);
  assert.ok(!arm.prompt.includes('{{text}}'));
  // 正文完整且该专家不要求读原帖 → 让 Grok 只解释这段文字
  assert.equal(arm.textComplete, true);
  // 「自定义」专家保留旧行为：始终带上原帖链接，允许模型自己去查
  const custom = contentHarness({ mode: 'grok', activeExpertId: 'custom' });
  await custom.hover();
  assert.equal(custom.arm().textComplete, false);
  const defaults = contentHarness();
  await defaults.hover();
  assert.equal(defaults.arm().textComplete, true);
});

test('settings page lists the built-in services and experts without asking for permissions', async () => {
  const h = optionsHarness();
  await h.load();
  assert.equal(h.el('enabled').checked, true);
  assert.equal(h.requestedOrigins.length, 0);
  assert.ok(h.values('serviceSelect').includes('xai'));
  assert.ok(h.values('serviceSelect').includes('ollama'));
  assert.ok(h.values('serviceSelect').includes('custom'));
  assert.deepEqual(h.values('expertSelect'), ['plain', 'tech', 'translate', 'summary', 'critique', 'custom']);
  assert.equal(h.el('expertSelect').value, 'plain');
  assert.match(h.el('expertPrompt').value, /大白话/);
  assert.match(h.el('promptPreview').textContent, /这里会自动填入推文正文/);
  // 学习模式的捕获开关默认关闭
  assert.equal(h.el('capture').checked, false);
});

test('choosing an expert persists it and moves the derived prompt with it', async () => {
  const h = optionsHarness();
  await h.load();
  h.pick('expertSelect', 'tech');
  await h.load();
  assert.equal(h.last().activeExpertId, 'tech');
  assert.equal(h.last().prompt, h.expert('tech').prompt);
  assert.match(h.last().prompt, /技术点/);
  assert.equal(h.el('expertPrompt').value, h.expert('tech').prompt);
  assert.ok(h.el('m-api').classList.contains('on') === false);
});

test('editing the expert prompt updates the preview and saving can restore the default', async () => {
  const h = optionsHarness();
  await h.load();
  const input = h.el('expertPrompt');
  input.value = '只讲结论,别废话:{{text}}';
  input.oninput({ target: input });
  await h.load();
  assert.equal(h.last().prompt, '只讲结论,别废话:{{text}}');
  assert.equal(h.expert('plain').prompt, '只讲结论,别废话:{{text}}');
  assert.equal(h.el('promptPreview').textContent, '只讲结论,别废话:（这里会自动填入推文正文）');
  h.el('expertReset').click();
  await h.load();
  assert.match(h.last().prompt, /大白话/);
  assert.match(h.el('promptPreview').textContent, /大白话/);
});

test('adding a service saves it, authorizes its origin and reports the connection test', async () => {
  const h = optionsHarness();
  await h.load();
  h.el('svcAdd').click();
  await h.load();
  const id = h.last().activeServiceId;
  assert.ok(!['xai', 'openai', 'custom'].includes(id));
  h.el('svcName').value = '我的中转';
  h.el('svcUrl').value = 'https://api.example.com/v1/chat/completions';
  h.el('svcKey').value = 'sk-test';
  h.el('svcModel').value = 'gpt-x';
  h.el('svcModel').oninput();
  h.el('svcSave').click();
  await h.load();
  assert.equal(h.service(id).name, '我的中转');
  assert.equal(h.service(id).apiUrl, 'https://api.example.com/v1/chat/completions');
  // origins 数组在 vm 领域里创建，跨领域 deepEqual 会挂，转成本地数组再比。
  assert.deepEqual(Array.from(h.requestedOrigins.at(-1).origins), ['https://api.example.com/*']);
  assert.equal(h.el('svcNote').className, 'note ok');
  h.el('svcTest').click();
  await h.load();
  assert.equal(h.posts.at(-1).type, 'xdbh-api-test');
  assert.equal(h.posts.at(-1).service.id, id);
  assert.equal(h.el('svcNote').className, 'note ok');
});

test('the connection test surfaces a failing gateway and refuses to test an unfinished service', async () => {
  const h = optionsHarness({ testReply: { ok: false, error: 'API Key 无效或没有权限（HTTP 401）' }, granted: false });
  await h.load();
  h.pick('serviceSelect', 'custom');
  await h.load();
  h.el('svcUrl').value = 'https://api.example.com/v1/chat/completions';
  h.el('svcUrl').oninput();
  h.el('svcModel').value = 'gpt-x';
  h.el('svcModel').oninput();
  h.el('svcTest').click();
  await h.load();
  assert.equal(h.posts.length, 0); // 没填 Key，连后台都不该打扰
  assert.match(h.el('svcNote').textContent, /API Key/);
  assert.equal(h.el('svcNote').className, 'note bad');
  h.el('svcKey').value = 'sk-test';
  h.el('svcKey').oninput();
  h.el('svcTest').click();
  await h.load();
  assert.equal(h.posts.length, 0); // 未授权域名，先提示授权
  assert.match(h.el('svcNote').textContent, /未授权/);
});

test('built-in services cannot be deleted but custom ones can', async () => {
  const h = optionsHarness();
  await h.load();
  h.pick('serviceSelect', 'ollama');
  await h.load();
  assert.equal(h.el('svcDelete').disabled, true);
  h.el('svcDelete').click();
  await h.load();
  assert.equal(h.last().services.some((item) => item.id === 'ollama'), true);
  h.el('svcAdd').click();
  await h.load();
  h.el('svcDelete').click();
  await h.load();
  assert.equal(h.el('svcDelete').disabled, true);
  assert.equal(h.last().activeServiceId, 'xai');
});

test('the settings page renders captured requests and can clear them', async () => {
  const h = optionsHarness({ captures: [{ method: 'POST', url: 'https://x.com/i/api/graphql/abc', reqBody: '{"q":"x"}', respLen: 12, ts: 1750000000000 }] });
  await h.load();
  assert.equal(h.el('caps').innerHTML, '');
  assert.equal(h.el('caps').childNodes.length, 1);
  assert.equal(h.el('clear').disabled, undefined);
  h.el('clear').click();
  await h.load();
  assert.equal(h.writes.at(-1).captures.length, 0);
});

test('the toolbar popup reports the live engine, expert and service', async () => {
  const h = popupHarness();
  await h.load();
  assert.equal(h.el('build').textContent, 'v0.4.0');
  assert.equal(h.el('enabled').checked, true);
  assert.equal(h.el('f-engine').textContent, 'Grok');
  assert.match(h.el('f-expert').textContent, /大白话/);
  assert.equal(h.el('f-service').textContent, '用不上');
  assert.match(h.el('f-status-text').textContent, /登录态/);
  assert.equal(h.el('f-dot').className, 'dot live');
  assert.equal(h.body.classList.contains('off'), false);
});

test('the popup flags an unfinished third-party service and points at the settings page', async () => {
  const h = popupHarness({ settings: { mode: 'api', activeServiceId: 'custom' } });
  await h.load();
  assert.equal(h.el('f-engine').textContent, '第三方 API');
  assert.equal(h.el('f-service').textContent, '自定义服务');
  assert.equal(h.el('f-status-text').textContent, '还没填接口地址');
  assert.equal(h.el('f-dot').className, 'dot wait');
  assert.match(h.el('hint').textContent, /设置页/);
});

test('the popup switch writes settings and the button hands off to the full page', async () => {
  const h = popupHarness();
  await h.load();
  const toggle = h.el('enabled');
  toggle.checked = false;
  toggle.listeners.change({ target: toggle });
  assert.equal(h.writes.at(-1).settings.enabled, false);
  assert.match(h.el('f-status-text').textContent, /已暂停/);
  assert.equal(h.body.classList.contains('off'), true);
  h.el('open-options').listeners.click();
  assert.equal(h.state.opened, 1);
  assert.equal(h.state.closed, 1);
});

test('the popup never sends a request and every page asset it references exists', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.options_page, 'options.html');
  for (const page of [manifest.action.default_popup, manifest.options_page]) {
    const markup = source(page);
    for (const [, ref] of markup.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue;
      assert.ok(fs.existsSync(path.join(root, ref)), `${page} 引用的 ${ref} 不存在`);
    }
  }
  const popup = source('popup.html');
  assert.doesNotMatch(popup, /\son[a-z]+="/i);
  assert.doesNotMatch(popup, /<script>[^<]/);
});
