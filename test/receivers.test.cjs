const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers.cjs");

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
