const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, deferred, flush } = require("./helpers.cjs");

for (const firstToFinish of [0, 1]) {
  test(`delivery waits for both receivers when receiver ${firstToFinish} finishes first`, async t => {
    const { w } = setup(t, '<div receiver="a"></div><div receiver="a"></div>');
    const pending = [deferred(), deferred()];
    let calls = 0, complete = false;
    w.talkDOM.methods["work:"] = () => pending[calls++].promise;
    const result = w.talkDOM.send("a work:").then(value => { complete = true; return value; });
    assert.equal(calls, 2);
    pending[firstToFinish].resolve(firstToFinish);
    await flush();
    assert.equal(complete, false);
    pending[1 - firstToFinish].resolve(1 - firstToFinish);
    assert.deepEqual(Array.from(await result), [1]);
  });
}

test("pipes wait for the whole receiver group and keep the last receiver's value", async t => {
  const { w } = setup(t, '<div receiver="a"></div><div receiver="a"></div><div receiver="b"></div>');
  const first = deferred();
  let calls = 0, piped;
  w.talkDOM.methods["work:"] = () => calls++ === 0 ? first.promise : "last";
  w.talkDOM.methods["collect:"] = (el, value) => { piped = value; };
  const result = w.talkDOM.send("a work: | b collect:");
  await flush();
  assert.equal(piped, undefined);
  first.resolve("first");
  await result;
  assert.equal(piped, "last");
});

test("throwing methods reject without skipping other receivers or chains", async t => {
  const { w } = setup(t, '<div receiver="a" id="first"></div><div receiver="a" id="last"></div>');
  const failure = new Error("boom");
  const visited = [], errors = [];
  w.document.addEventListener("talkdom:error", e => errors.push(e.detail.error));
  w.talkDOM.methods["work:"] = el => {
    visited.push(el.id);
    if (el.id === "first") throw failure;
    el.textContent = "sync";
  };
  w.talkDOM.methods["other:"] = el => visited.push("other:" + el.id);
  const result = w.talkDOM.send("a work: ; a other:");
  assert.equal(w.document.getElementById("last").textContent, "sync");
  await assert.rejects(result, error => error === failure);
  assert.deepEqual(visited, ["first", "last", "other:first", "other:last"]);
  assert.deepEqual(errors, [failure]);
});

test("an earlier receiver failure rejects promptly and stops its pipe", async t => {
  const { w } = setup(t, '<div receiver="a" id="first"></div><div receiver="a" id="last"></div>');
  const pending = deferred();
  const failure = new Error("first failed");
  const events = [];
  let piped = false;
  w.document.addEventListener("talkdom:error", e => events.push([e.target.id, e.detail.error]));
  w.document.addEventListener("talkdom:done", e => events.push([e.target.id, "done"]));
  w.talkDOM.methods["work:"] = el => el.id === "first" ? Promise.reject(failure) : pending.promise;
  w.talkDOM.methods["after:"] = () => { piped = true; };
  await assert.rejects(w.talkDOM.send("a work: | a after:"), error => error === failure);
  assert.equal(piped, false);
  assert.deepEqual(events, [["first", failure]]);
  pending.resolve("finished");
  await flush();
  assert.deepEqual(events, [["first", failure], ["last", "done"]]);
});
