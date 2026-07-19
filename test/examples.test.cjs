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

test('main demo keeps one action receiver across repeated steps', async t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { flush } = require('./helpers.cjs');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const { w } = setup(t, html);
  let requests = 0;
  w.fetch = url => {
    requests++;
    return Promise.resolve(response(fs.readFileSync(path.join(__dirname, '..', url), 'utf8')));
  };
  for (let i = 0; i < 6; i++) {
    const before = requests;
    w.talkDOM.receivers('actions')[0].click();
    await flush();
    assert.equal(w.talkDOM.receivers('actions').length, 1);
    assert.equal(requests - before, i % 2 === 0 ? 2 : 3);
    assert.equal(w.talkDOM.receivers('bottom')[0].children.length, i + 1);
  }
});
