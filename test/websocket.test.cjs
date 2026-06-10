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
