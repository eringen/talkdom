const test = require("node:test");
const assert = require("node:assert/strict");
const { sockets } = require("./sockets.cjs");

test("manual sockets reconnect with backoff and disconnect cancels retries", t => {
  const { w, instances, advance, timers } = sockets(t);
  w.talkDOM.ws.connect("wss://api.test");
  instances[0].open();
  instances[0].close();
  advance(999);
  assert.equal(instances.length, 1);
  advance(1);
  assert.equal(instances.length, 2);
  instances[1].close();
  advance(1999);
  assert.equal(instances.length, 2);
  advance(1);
  assert.equal(instances.length, 3);
  instances[2].open();
  instances[2].close();
  w.talkDOM.ws.disconnect("wss://api.test");
  advance(60000);
  assert.equal(instances.length, 3);
  assert.equal(timers.size, 0);
});

test("stale socket callbacks cannot affect a replacement connection", t => {
  const { w, instances, advance } = sockets(t);
  w.talkDOM.ws.connect("wss://api.test");
  const oldClose = instances[0].onclose;
  w.talkDOM.ws.disconnect("wss://api.test");
  w.talkDOM.ws.connect("wss://api.test");
  instances[1].open();
  oldClose({code:1006, reason:"late"});
  advance(30000);
  assert.equal(instances.length, 2);
  assert.equal(instances[1].readyState, 1);
});

test("manual sockets survive cleanup until explicitly disconnected", t => {
  const { w, instances, advance, timers } = sockets(t);
  w.talkDOM.ws.connect("wss://api.test");
  instances[0].open();
  advance(15000);
  assert.equal(w.talkDOM.ws.send("wss://api.test", "hello"), true);
  assert.deepEqual(instances[0].sent, ["hello"]);
  w.talkDOM.ws.disconnect("wss://api.test");
  assert.equal(instances[0].readyState, 3);
  assert.equal(timers.size, 0);
});

for (const manual of [false, true]) {
  test(`last DOM subscriber removal respects manual ownership: ${manual}`, t => {
    const { w, instances, advance } = sockets(t, '<div receiver="a ws: wss://api.test"></div>');
    if (manual) w.talkDOM.ws.connect("wss://api.test");
    instances[0].open();
    w.document.querySelector("[receiver]").remove();
    advance(5000);
    assert.equal(instances[0].readyState, manual ? 1 : 3);
    assert.equal(Object.keys(w.talkDOM.ws.connections).length, manual ? 1 : 0);
  });
}

const { flush } = require('./helpers.cjs');

test('named JSON stays within its socket and raw commands retain global routing', async t => {
  const { w, instances } = sockets(t, '<div id="a" receiver="a shared ws: wss://a.test"></div><div id="b" receiver="b shared ws: wss://b.test"></div><div id="plain" receiver="shared"></div>');
  instances[0].message(JSON.stringify({receiver:'shared', content:'A'}));
  assert.equal(w.document.getElementById('a').textContent, 'A');
  assert.equal(w.document.getElementById('b').textContent, '');
  assert.equal(w.document.getElementById('plain').textContent, '');
  instances[0].message('shared text: global'); await flush();
  assert.equal(w.document.getElementById('b').textContent, 'global');
});

test('subscriptions follow edited URLs, removed attributes and moves', async t => {
  const { w, instances } = sockets(t, '<div receiver="a ws: wss://a.test"></div><section></section>');
  const el = w.talkDOM.receivers('a')[0];
  w.document.querySelector('section').appendChild(el);
  await flush(); assert.equal(instances.length, 1);
  el.setAttribute('receiver', 'a ws: wss://b.test');
  instances[0].message('{"content":"stale"}');
  assert.equal(el.textContent, '');
  await flush(); assert.equal(instances.length, 2); assert.equal(instances[0].readyState, 3);
  instances[1].message('{"content":"fresh"}'); assert.equal(el.textContent, 'fresh');
  el.removeAttribute('receiver'); await flush();
  assert.equal(instances[1].readyState, 3);
  assert.equal(Object.keys(w.talkDOM.ws.connections).length, 0);
});

test('explicit disconnect remains closed after unrelated DOM changes', async t => {
  const { w, instances } = sockets(t, '<div receiver="a ws: wss://a.test"></div>');
  w.talkDOM.ws.disconnect('wss://a.test');
  w.document.body.appendChild(w.document.createElement('p'));
  await flush(); assert.equal(instances.length, 1);
});

test('invalid socket declarations do not prevent later subscriptions', t => {
  const { w, instances } = sockets(t, '<div receiver="bad ws: file:///bad"></div><div receiver="a ws: wss://a.test"></div>');
  assert.equal(instances.length, 1);
  assert.deepEqual(Object.keys(w.talkDOM.ws.connections), ['wss://a.test']);
});

test('constructor failures release their connection slot', async t => {
  const { w } = sockets(t);
  w.WebSocket = class { constructor() { throw new Error('blocked'); } };
  w.document.body.innerHTML = '<div receiver="a ws: wss://a.test"></div>';
  await flush(); assert.equal(Object.keys(w.talkDOM.ws.connections).length, 0);
});

for (const content of [0, false, '', null]) {
  test(`JSON preserves supported falsy content: ${content}`, t => {
    const { w, instances } = sockets(t, '<div receiver="a ws: wss://a.test">old</div>');
    instances[0].message(' \n' + JSON.stringify({content, op:'text'}));
    assert.equal(w.talkDOM.receivers('a')[0].textContent, content === null ? '' : String(content));
  });
}

test('malformed envelopes emit socket errors without mutating content', t => {
  const { w, instances } = sockets(t, '<div receiver="a ws: wss://a.test">old</div>');
  let errors = 0;
  w.document.addEventListener('talkdom:ws:error', () => errors++);
  for (const data of ['{', '[]', '{"receiver":2}', '{"op":"bad"}', '{"content":{}}']) instances[0].message(data);
  assert.equal(errors, 5);
  assert.equal(w.talkDOM.receivers('a')[0].textContent, 'old');
});

test('socket outer swaps bubble lifecycle events from the replacement', async t => {
  const { w, instances } = sockets(t, '<div receiver="a ws: wss://a.test">old</div>');
  const events = [];
  w.document.addEventListener('talkdom:done', e => events.push(e));
  instances[0].message(JSON.stringify({op:'outer', content:'<p receiver="a ws: wss://a.test">new</p>'}));
  await flush();
  assert.equal(events.length, 1); assert.equal(events[0].target.tagName, 'P');
  assert.equal(instances.length, 1, 'outer replacements reuse the existing connection');
  w.talkDOM.methods['apply:'] = () => { throw new Error('apply failed'); };
  let errors = 0;
  w.document.addEventListener('talkdom:error', () => errors++);
  instances.at(-1).message('{"content":"bad"}'); await flush();
  assert.equal(errors, 1);
});
