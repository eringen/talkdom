const test = require("node:test");
const assert = require("node:assert/strict");
const { sockets } = require("./sockets.cjs");

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
