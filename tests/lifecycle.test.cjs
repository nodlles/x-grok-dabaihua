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
    this.dataset = {}; this.children = new Map(); this.listeners = {}; this.textContent = '';
    this.classList = { add() {} }; this.connected = true; this.attrs = {};
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
  getAttribute(k) { return this.attrs[k] || null; }
  getBoundingClientRect() { return { top: 20, right: 500 }; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  remove() { this.connected = false; }
  click() { this.clicks = (this.clicks || 0) + 1; this.onclick?.(); }
}

function contentHarness(settings = {}, cached = null) {
  const timers = clock(), events = {}, messages = [], cards = [], writes = [];
  const drawer = new Element();
  drawer.style.setProperty('position', 'absolute');
  drawer.style.setProperty('left', '30px', 'important');
  drawer.style.setProperty('opacity', '0.8');
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
    runtime: { id: 'extension' },
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
  vm.runInContext(source('content.js'), context);
  return {
    ...timers, drawer, button, tweet, messages, cards, writes, document,
    async hover() { await timers.advance(0); events.mouseover({ target: tweet }); await timers.advance(1200); },
    async mutate() { observer(); await timers.advance(16); },
    invalidate() { chrome.runtime.id = null; },
    mouseover() { events.mouseover({ target: tweet }); },
    drawerFallback() {
      tweet.querySelectorAll = (sel) => sel.includes('tweetText') ? [{ innerText: 'Long article text for drawer fallback' }] : [];
      const input = new Element(); input.attrs.placeholder = 'Ask'; input.focus = () => {}; input.dispatchEvent = () => {};
      const send = new Element(); send.attrs['aria-label'] = 'Send';
      document.querySelector = () => null;
      document.querySelectorAll = (sel) => sel === 'textarea' ? [input] : sel === 'button,[role="button"]' ? [send] : /drawer/i.test(sel) ? [drawer] : [];
      window.HTMLTextAreaElement = class { set value(v) { this.textContent = v; } };
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

test('native drawer stays visible outside an active explanation', async () => {
  const h = contentHarness(); await h.advance(0); await h.mutate();
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
});

test('closing before the delayed click disarms and prevents Grok activation', async () => {
  const h = contentHarness(); await h.hover(); const reqId = h.arm().reqId;
  h.close(); await h.advance(15000);
  assert.equal(h.button.clicks || 0, 0);
  assert.ok(h.messages.some((d) => d.__xdbh === 'disarm' && d.reqId === reqId));
});

test('closing restores original inline styles and later mutations cannot hide drawer', async () => {
  const h = contentHarness(); await h.hover(); await h.advance(150);
  assert.equal(h.drawer.style.getPropertyValue('left'), '-99999px');
  h.close(); await h.mutate(); await h.advance(4000);
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
  assert.equal(h.drawer.style.getPropertyPriority('left'), 'important');
  assert.equal(h.drawer.style.getPropertyValue('position'), 'absolute');
  assert.equal(h.drawer.style.getPropertyValue('opacity'), '0.8');
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
  await h.mutate(); assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
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
  assert.match(h.cards.at(-1).querySelector('.xdbh-status').textContent, /超时/);
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
});

test('closing before animation frame does not access a removed card', async () => {
  const h = contentHarness(); await h.hover(); h.close(); await h.advance(16);
});

test('cached results never hide the native drawer or activate Grok', async () => {
  const h = contentHarness({}, { raw: 'cached', sources: [] }); await h.hover(); await h.mutate();
  assert.equal(h.arm(), undefined);
  assert.equal(h.cards.at(-1).querySelector('.xdbh-text').innerHTML, 'cached');
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
});

function hookHarness(fetchImpl) {
  let listener;
  const posts = [], requests = [];
  class XHR { open() {} send() {} }
  const window = {
    XMLHttpRequest: XHR,
    fetch(input, init) { requests.push({ input, init }); return fetchImpl ? fetchImpl(input, init) : Promise.resolve(new Response('{"result":{"messageTag":"final","message":"answer"}}\n')); },
    addEventListener: (_, fn) => { listener = fn; },
    postMessage: (d) => posts.push(d),
  };
  vm.runInNewContext(source('inject.js'), { window, Request, URL, TextDecoder, console: { log() {} }, location: { origin: 'https://x.com' } });
  return { window, posts, requests, message: (d) => listener({ source: window, data: d }) };
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
  h.change({ hideDrawer: false }); await h.mutate();
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
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
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
  assert.ok(h.messages.some((d) => d.__xdbh === 'disarm' && d.reqId === reqId));
});
