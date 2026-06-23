const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers.cjs");

test("receiver aliases exclude keyword arguments and support literal punctuation", async t => {
  const { w } = setup(t, '<div receiver="feed alias get: /data apply: inner">old</div><div id="literal"></div>');
  await w.talkDOM.send("inner text: wrong");
  assert.equal(w.document.querySelector("[receiver]").textContent, "old");
  await w.talkDOM.send("alias text: works");
  assert.equal(w.document.querySelector("[receiver]").textContent, "works");
  w.document.getElementById("literal").setAttribute("receiver", 'a"\\b');
  await w.talkDOM.send('a"\\b text: literal');
  assert.equal(w.document.getElementById("literal").textContent, "literal");
  const copy = w.talkDOM.receivers("feed");
  copy.length = 0;
  assert.equal(w.talkDOM.receivers("feed").length, 1);
});

test("receiver names use the same whitespace rules in storage and headers", async t => {
  const { w } = setup(t, '<div receiver="a\talias" persist></div>');
  await w.talkDOM.send("a text: saved");
  assert.equal(JSON.parse(w.localStorage.getItem("talkDOM:a")).content, "saved");
});

test("receiver lookup notices synchronous replacement, insertion and renaming", async t => {
  const { w } = setup(t);
  const sends = [w.talkDOM.send("a text: first")];
  w.document.body.innerHTML = '<p receiver="a">new</p>';
  sends.push(w.talkDOM.send("a text: replacement"));
  assert.equal(w.document.body.textContent, "replacement");
  sends.push(w.talkDOM.send("b text: absent"));
  const first = w.document.querySelector("[receiver]");
  first.setAttribute("receiver", "b");
  sends.push(w.talkDOM.send("b text: renamed"));
  assert.equal(first.textContent, "renamed");
  w.document.body.insertAdjacentHTML("beforeend", '<div receiver="b"></div>');
  sends.push(w.talkDOM.send("b text: both"));
  assert.equal(w.document.body.textContent, "bothboth");
  first.remove();
  sends.push(w.talkDOM.send("b text: remaining"));
  assert.equal(first.textContent, "both");
  assert.equal(w.document.body.textContent, "remaining");
  await Promise.all(sends);
});
