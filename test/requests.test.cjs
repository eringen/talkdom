const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, response } = require("./helpers.cjs");

test("trusted origins can opt into headers without trusting lookalike hosts", async t => {
  const { w } = setup(t, '<meta name="csrf-token" content="secret"><div receiver="a"></div>', w => {
    w.talkDOMConfig = { trustedOrigins: ["https://api.test"] };
  });
  let headers;
  w.fetch = (url, options) => { headers = options.headers; return Promise.resolve(response()); };
  await w.talkDOM.send("a post: https://api.test/action");
  assert.equal(headers["X-CSRF-Token"], "secret");
  assert.equal(headers["X-TalkDOM-Current-URL"], w.location.href);
  await w.talkDOM.send("a post: https://api.test.evil.test/action");
  assert.equal(headers["X-CSRF-Token"], undefined);
  w.talkDOM.config.includeCurrentURL = false;
  await w.talkDOM.send("a get: /action");
  assert.equal(headers["X-TalkDOM-Current-URL"], undefined);
  assert.equal(headers["X-CSRF-Token"], undefined);
});

test("server triggers can be disabled explicitly", async t => {
  const { w } = setup(t);
  w.talkDOM.config.allowServerTriggers = false;
  w.talkDOM.methods["trigger:"] = () => assert.fail("trigger must be disabled");
  w.fetch = () => Promise.resolve(response("ok", "a trigger:"));
  await w.talkDOM.send("a get: /action");
});

for (const [url, trusted] of [["/action", true], ["https://example.test/action", true], ["//other.test/action", false], ["https://other.test/action", false], ["http://example.test/action", false], ["https://example.test:444/action", false]]) {
  test(`request headers respect the origin of ${url}`, async t => {
    const { w } = setup(t, '<meta name="csrf-token" content="secret"><div receiver="a"></div>');
    let headers;
    w.fetch = (url, options) => { headers = options.headers; return Promise.resolve(response()); };
    await w.talkDOM.send("a post: " + url);
    assert.equal(headers["X-CSRF-Token"], trusted ? "secret" : undefined);
    assert.equal(headers["X-TalkDOM-Current-URL"], trusted ? w.location.href : undefined);
    assert.equal(headers["X-TalkDOM-Request"], "true");
    assert.equal(headers["X-TalkDOM-Receiver"], "a");
  });
}

test("relative destinations follow the document base URL", async t => {
  const { w } = setup(t, '<base href="https://other.test/"><meta name="csrf-token" content="secret"><div receiver="a"></div>');
  let headers;
  w.fetch = (url, options) => { headers = options.headers; return Promise.resolve(response()); };
  await w.talkDOM.send("a post: action");
  assert.equal(headers["X-CSRF-Token"], undefined);
  assert.equal(headers["X-TalkDOM-Current-URL"], undefined);
});
