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
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(el) { this.childNodes.push(el); return el; }
  focus() { this.listeners.focus?.({}); }
  dispatchEvent() {}
  getAttribute(k) { return this.attrs[k] || null; }
  getClientRects() { return [{}]; }
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
  vm.runInContext(source('conversation.js'), context);
  vm.runInContext(source('content.js'), context);
  return {
    ...timers, drawer, button, tweet, messages, cards, writes, document,
    async hover() { await timers.advance(0); events.mouseover({ target: tweet }); await timers.advance(1200); },
    async mutate() { observer(); await timers.advance(16); },
    invalidate() { chrome.runtime.id = null; },
    mouseover(target = tweet) { events.mouseover({ target }); },
    outside() { events.click({ target: new Element() }); },
    question(value) { const input = cards.at(-1).querySelector('.xdbh-question'); input.value = value; input.listeners.input?.(); return input; },
    submit() { cards.at(-1).querySelector('.xdbh-composer').listeners.submit({ preventDefault() {} }); },
    native() { cards.at(-1).querySelector('.xdbh-native').click(); },
    drawerFallback() {
      tweet.querySelectorAll = (sel) => sel.includes('tweetText') ? [{ innerText: 'Long article text for drawer fallback' }] : [];
      const input = new Element(); input.attrs.placeholder = 'Ask'; input.focus = () => {}; input.dispatchEvent = () => {};
      const send = new Element(); send.attrs['aria-label'] = 'Send';
      drawer.querySelector = () => input;
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
  assert.match(h.cards.at(-1).querySelector('.xdbh-text').textContent, /超时/);
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
  assert.equal(h.drawer.style.getPropertyValue('left'), '30px');
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
