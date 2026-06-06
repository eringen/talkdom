const { setup } = require("./helpers.cjs");

function sockets(t, html = "") {
  const timers = new Map(), instances = [];
  let now = 0, nextId = 0;
  const env = setup(t, html, w => {
    const schedule = (fn, delay, interval) => {
      const id = ++nextId;
      timers.set(id, { fn, at: now + delay, interval });
      return id;
    };
    w.setTimeout = (fn, delay) => schedule(fn, delay, 0);
    w.setInterval = (fn, delay) => schedule(fn, delay, delay);
    w.clearTimeout = w.clearInterval = id => timers.delete(id);
    w.Math.random = () => 0.5;
    w.WebSocket = class {
      static CONNECTING = 0;
      static OPEN = 1;
      constructor(url) { this.url = url; this.readyState = 0; this.sent = []; instances.push(this); }
      open() { this.readyState = 1; if (this.onopen) this.onopen(); }
      close() { this.readyState = 3; if (this.onclose) this.onclose({code:1000, reason:"closed"}); }
      send(value) { this.sent.push(value); }
      message(data) { if (this.onmessage) this.onmessage({data}); }
    };
  });
  env.loadPlugin();
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const entry = [...timers].sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      const [id, timer] = entry;
      now = timer.at;
      if (timer.interval) timer.at += timer.interval;
      else timers.delete(id);
      timer.fn();
    }
    now = end;
  }
  return { ...env, timers, instances, advance };
}

module.exports = { sockets };
