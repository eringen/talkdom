const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers.cjs");

test("outer persistence restores the replacement using the original key", async t => {
  const { w } = setup(t, '<div receiver="a" persist>old</div>');
  const replacement = '<p receiver="renamed">new</p><span>extra</span>';
  w.talkDOM.methods["value:"] = () => replacement;
  await w.talkDOM.send("a value: | a apply: outer");
  const stored = w.localStorage.getItem("talkDOM:a");
  assert.equal(JSON.parse(stored).content, replacement);
  const restored = setup(t, '<div receiver="a" persist>old</div>', w => w.localStorage.setItem("talkDOM:a", stored));
  assert.equal(restored.w.document.body.innerHTML, replacement);
});

test("quota failures preserve successful DOM updates and lifecycle events", async t => {
  const { w, warnings } = setup(t, '<div receiver="a" persist></div>', w => {
    Object.defineProperty(w, "localStorage", {value:{
      getItem() { return null; },
      setItem() { throw new Error("quota exceeded"); },
    }});
  });
  const events = [];
  w.document.addEventListener("talkdom:done", e => events.push(e.detail.selector));
  w.document.addEventListener("talkdom:error", () => assert.fail("DOM update should succeed"));
  w.talkDOM.methods["echo:"] = (el, value) => value;
  await w.talkDOM.send("a echo: saved | a apply: text");
  assert.equal(w.document.body.textContent, "saved");
  assert.deepEqual(events, ["echo:", "apply:"]);
  assert.equal(warnings.length, 1);
});

for (const bad of ["{", "null", "[]", "0", '"text"', "{}", '{"op":"bogus","content":"bad"}', '{"op":"text","content":2}', ""]) {
  test(`invalid storage ${JSON.stringify(bad)} does not stop restoration`, t => {
    const { w } = setup(t, '<div receiver="bad" persist>old</div><div receiver="good" persist></div>', w => {
      w.localStorage.setItem("talkDOM:bad", bad);
      w.localStorage.setItem("talkDOM:good", JSON.stringify({op:"inner", content:"saved"}));
    });
    assert.equal(typeof w.talkDOM.send, "function");
    assert.equal(w.document.querySelector('[receiver="bad"]').textContent, "old");
    assert.equal(w.document.querySelector('[receiver="good"]').textContent, "saved");
    assert.equal(w.localStorage.getItem("talkDOM:bad"), null);
  });
}

test("denied storage and failed removal do not abort initialization", t => {
  for (const mode of ["getter", "getItem", "removeItem"]) {
    const { w, warnings } = setup(t, '<div receiver="a" persist>old</div>', w => {
      if (mode === "getter") Object.defineProperty(w, "localStorage", {get() {throw new Error("denied");}});
      else Object.defineProperty(w, "localStorage", {value:{
        getItem() { if (mode === "getItem") throw new Error("denied"); return "null"; },
        removeItem() { throw new Error("denied"); },
      }});
    });
    assert.equal(typeof w.talkDOM.send, "function");
    assert.equal(w.document.body.textContent, "old");
    assert.equal(warnings.length, 1);
  }
});
