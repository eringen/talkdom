const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, response } = require("./helpers.cjs");

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
