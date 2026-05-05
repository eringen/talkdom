const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const core = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const plugin = fs.readFileSync(path.join(__dirname, "../websocket.js"), "utf8");

function setup(t, html = '<div receiver="a"></div>', before = () => {}) {
  const dom = new JSDOM(html, {
    url: "https://example.test/page?view=1#private",
    runScripts: "outside-only",
    virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  const warnings = [];
  w.console.warn = (...args) => warnings.push(args);
  before(w);
  w.eval(core);
  return { w, warnings, loadPlugin: () => w.eval(plugin) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (body = "ok", trigger = null) => ({
  ok: true,
  headers: { get: () => trigger },
  text: () => Promise.resolve(body),
});

module.exports = { setup, deferred, flush, response };
