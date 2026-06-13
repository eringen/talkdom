const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setup, response } = require("./helpers.cjs");

test("README programmatic HTTP and literal text examples update the DOM", async t => {
  const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
  const { w } = setup(t, '<div receiver="content"></div><div receiver="toast"></div>');
  const urls = [];
  w.fetch = url => { urls.push(url); return Promise.resolve(response("<b>loaded</b>")); };
  const message = readme.match(/talkDOM\.send\("(content get:[^"]+)"\)/)[1];
  await w.talkDOM.send(message);
  assert.deepEqual(urls, ["/api/data"]);
  assert.equal(w.document.querySelector('[receiver="content"]').innerHTML, "<b>loaded</b>");
  const trigger = readme.match(/X-TalkDOM-Trigger: (toast [^\n]+)/)[1];
  await w.talkDOM.send(trigger);
  assert.equal(w.document.querySelector('[receiver="toast"]').textContent, "Saved");
});
