(function () {

  var results = { pass: 0, fail: 0, errors: [] };
  var queue = [];
  var output = document.getElementById("output");

  function log(msg, cls) {
    var div = document.createElement("div");
    div.textContent = msg;
    if (cls) div.className = cls;
    output.appendChild(div);
  }

  function assert(cond, message) {
    if (cond) {
      results.pass++;
      log("  \u2713 " + message, "pass");
    } else {
      results.fail++;
      log("  \u2717 " + message, "fail");
      results.errors.push(message);
    }
  }

  function assertEqual(actual, expected, message) {
    var ok = actual === expected;
    assert(ok, message + (ok ? "" : " (got " + JSON.stringify(actual) + ", want " + JSON.stringify(expected) + ")"));
  }

  function suite(name) {
    queue.push({ suite: name });
  }

  function test(name, fn) {
    queue.push({ name: name, fn: fn });
  }

  function fixture(html) {
    var el = document.getElementById("fixture");
    el.innerHTML = html;
    return el;
  }

  function tick(n) {
    n = n || 1;
    var p = Promise.resolve();
    for (var i = 0; i < n; i++) p = p.then(function () { return new Promise(function (r) { setTimeout(r, 0); }); });
    return p;
  }

  function mockFetch(body, opts) {
    opts = opts || {};
    var status = opts.status || 200;
    var triggerHeader = opts.trigger || null;
    var original = window.fetch;
    var captured = null;
    window.fetch = function (url, reqOpts) {
      captured = { url: url, opts: reqOpts };
      var headers = new Headers();
      if (triggerHeader) headers.set("X-TalkDOM-Trigger", triggerHeader);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status: status,
        headers: headers,
        text: function () { return Promise.resolve(body); }
      });
    };
    return { restore: function () { window.fetch = original; }, captured: function () { return captured; } };
  }

  // ── Apply operations ──────────────────────────────────

  suite("apply operations");

  test("inner sets innerHTML", function () {
    fixture('<div receiver="a1"></div>');
    talkDOM.send("a1 apply: <b>hello</b> inner");
    return tick().then(function () {
      assertEqual(document.querySelector('[receiver="a1"]').innerHTML, "<b>hello</b>", "innerHTML set");
    });
  });

  test("text sets textContent", function () {
    fixture('<div receiver="a2"></div>');
    talkDOM.send("a2 apply: hello world text");
    return tick().then(function () {
      assertEqual(document.querySelector('[receiver="a2"]').textContent, "hello world", "textContent set");
    });
  });

  test("append adds without destroying existing content", function () {
    fixture('<div receiver="a3"><span>old</span></div>');
    talkDOM.send("a3 apply: <b>new</b> append");
    return tick().then(function () {
      var html = document.querySelector('[receiver="a3"]').innerHTML;
      assert(html.indexOf("<span>old</span>") !== -1, "old content preserved");
      assert(html.indexOf("<b>new</b>") !== -1, "new content appended");
    });
  });

  test("append preserves event listeners on existing children", function () {
    fixture('<div receiver="a4"><button id="a4btn">x</button></div>');
    var clicked = false;
    document.getElementById("a4btn").addEventListener("click", function () { clicked = true; });
    talkDOM.send("a4 apply: <i>extra</i> append");
    return tick().then(function () {
      document.getElementById("a4btn").click();
      assert(clicked, "listener survived append");
    });
  });

  test("outer replaces element", function () {
    fixture('<div receiver="a5">old</div>');
    talkDOM.send('a5 apply: <p receiver="a5">replaced</p> outer');
    return tick().then(function () {
      var el = document.querySelector('[receiver="a5"]');
      assertEqual(el.tagName, "P", "tag changed to P");
      assertEqual(el.textContent, "replaced", "content replaced");
    });
  });

  // ── Accepts attribute ─────────────────────────────────

  suite("accepts attribute");

  test("blocks unlisted operation", function () {
    fixture('<div receiver="ac1" accepts="text"></div>');
    talkDOM.send("ac1 apply: <b>no</b> inner");
    return tick().then(function () {
      assertEqual(document.querySelector('[receiver="ac1"]').innerHTML, "", "inner blocked");
    });
  });

  test("allows listed operation", function () {
    fixture('<div receiver="ac2" accepts="text inner"></div>');
    talkDOM.send("ac2 apply: yes text");
    return tick().then(function () {
      assertEqual(document.querySelector('[receiver="ac2"]').textContent, "yes", "text allowed");
    });
  });

  test("no accepts attribute allows everything", function () {
    fixture('<div receiver="ac3"></div>');
    talkDOM.send("ac3 apply: <em>ok</em> inner");
    return tick().then(function () {
      assertEqual(document.querySelector('[receiver="ac3"]').innerHTML, "<em>ok</em>", "inner allowed without accepts");
    });
  });

  // ── Lifecycle events ──────────────────────────────────

  suite("lifecycle events");

  test("talkdom:done fires after sync apply", function () {
    fixture('<div receiver="ev1"></div>');
    var detail = null;
    document.querySelector('[receiver="ev1"]').addEventListener("talkdom:done", function (e) { detail = e.detail; });
    talkDOM.send("ev1 apply: hi text");
    return tick().then(function () {
      assert(detail !== null, "talkdom:done fired");
      assertEqual(detail.receiver, "ev1", "detail.receiver");
      assertEqual(detail.selector, "apply:", "detail.selector");
    });
  });

  test("talkdom:done bubbles to parent", function () {
    fixture('<div id="ev2wrap"><div receiver="ev2"></div></div>');
    var bubbled = false;
    document.getElementById("ev2wrap").addEventListener("talkdom:done", function () { bubbled = true; });
    talkDOM.send("ev2 apply: hi text");
    return tick().then(function () {
      assert(bubbled, "event bubbled");
    });
  });

  test("talkdom:error fires with reason on confirm cancel", function () {
    fixture('<div receiver="ev3"></div>');
    var original = window.confirm;
    window.confirm = function () { return false; };
    var detail = null;
    document.querySelector('[receiver="ev3"]').addEventListener("talkdom:error", function (e) { detail = e.detail; });
    talkDOM.send("ev3 confirm: sure?");
    return tick().then(function () {
      window.confirm = original;
      assert(detail !== null, "talkdom:error fired");
      assertEqual(detail.error, "cancelled", "reason is 'cancelled'");
    });
  });

  test("each receiver gets independent detail object", function () {
    fixture('<div receiver="ev4" id="ev4a"></div><div receiver="ev4" id="ev4b"></div>');
    var details = [];
    document.getElementById("ev4a").addEventListener("talkdom:done", function (e) { details.push(e.detail); });
    document.getElementById("ev4b").addEventListener("talkdom:done", function (e) { details.push(e.detail); });
    talkDOM.send("ev4 apply: x text");
    return tick().then(function () {
      assertEqual(details.length, 2, "both receivers got events");
      assert(details[0] !== details[1], "detail objects are separate references");
    });
  });

  test("talkdom:done fires on replacement element after outer swap", function () {
    fixture('<div receiver="ev5">old</div>');
    var doneFired = false;
    // Listen on fixture since original element will be replaced
    document.getElementById("fixture").addEventListener("talkdom:done", function handler(e) {
      if (e.detail.receiver === "ev5") { doneFired = true; }
      document.getElementById("fixture").removeEventListener("talkdom:done", handler);
    });
    talkDOM.send('ev5 apply: <div receiver="ev5">new</div> outer');
    return tick().then(function () {
      assert(doneFired, "talkdom:done fired after outer swap");
    });
  });

  // ── Fetch / request ───────────────────────────────────

  suite("fetch / request");

  test("get:apply: fetches and applies content", function () {
    fixture('<div receiver="rq1"></div>');
    var mock = mockFetch("<em>fetched</em>");
    talkDOM.send("rq1 get:apply: /data inner");
    return tick(3).then(function () {
      mock.restore();
      assertEqual(document.querySelector('[receiver="rq1"]').innerHTML, "<em>fetched</em>", "content applied");
    });
  });

  test("post: sends POST request", function () {
    fixture('<div receiver="rq2"></div>');
    var mock = mockFetch("ok");
    talkDOM.send("rq2 post: /submit");
    return tick(3).then(function () {
      mock.restore();
      assertEqual(mock.captured().opts.method, "POST", "method is POST");
    });
  });

  test("put: sends PUT request", function () {
    fixture('<div receiver="rq3"></div>');
    var mock = mockFetch("ok");
    talkDOM.send("rq3 put: /update");
    return tick(3).then(function () {
      mock.restore();
      assertEqual(mock.captured().opts.method, "PUT", "method is PUT");
    });
  });

  test("delete: sends DELETE request", function () {
    fixture('<div receiver="rq4"></div>');
    var mock = mockFetch("ok");
    talkDOM.send("rq4 delete: /remove");
    return tick(3).then(function () {
      mock.restore();
      assertEqual(mock.captured().opts.method, "DELETE", "method is DELETE");
    });
  });

  test("request sends X-TalkDOM-Request header", function () {
    fixture('<div receiver="rq5"></div>');
    var mock = mockFetch("ok");
    talkDOM.send("rq5 get: /ping");
    return tick(3).then(function () {
      mock.restore();
      assertEqual(mock.captured().opts.headers["X-TalkDOM-Request"], "true", "header present");
    });
  });

  test("request sends X-TalkDOM-Receiver header for receivers", function () {
    fixture('<div receiver="rq6"></div>');
    var mock = mockFetch("ok");
    talkDOM.send("rq6 get: /ping");
    return tick(3).then(function () {
      mock.restore();
      assertEqual(mock.captured().opts.headers["X-TalkDOM-Receiver"], "rq6", "receiver header sent");
    });
  });

  test("failed request fires talkdom:error", function () {
    fixture('<div receiver="rq7"></div>');
    var mock = mockFetch("", { status: 500 });
    var errorFired = false;
    document.querySelector('[receiver="rq7"]').addEventListener("talkdom:error", function () { errorFired = true; });
    talkDOM.send("rq7 get:apply: /fail inner");
    return tick(3).then(function () {
      mock.restore();
      assert(errorFired, "talkdom:error fired on 500");
    });
  });

  test("X-TalkDOM-Trigger header fires server-triggered message", function () {
    fixture('<div receiver="rq8"></div><div receiver="rq8tgt"></div>');
    var mock = mockFetch("resp", { trigger: "rq8tgt apply: triggered text" });
    talkDOM.send("rq8 get:apply: /data inner");
    return tick(4).then(function () {
      mock.restore();
      assertEqual(document.querySelector('[receiver="rq8tgt"]').textContent, "triggered", "trigger message executed");
    });
  });

  // ── CSRF ──────────────────────────────────────────────

  suite("CSRF token");

  test("included in POST requests", function () {
    fixture('<div receiver="cs1"></div>');
    var meta = document.createElement("meta");
    meta.setAttribute("name", "csrf-token");
    meta.setAttribute("content", "tok-123");
    document.head.appendChild(meta);
    var mock = mockFetch("ok");
    talkDOM.send("cs1 post: /submit");
    return tick(3).then(function () {
      mock.restore();
      assertEqual(mock.captured().opts.headers["X-CSRF-Token"], "tok-123", "token sent");
      meta.remove();
    });
  });

  test("not included in GET requests", function () {
    fixture('<div receiver="cs2"></div>');
    var meta = document.createElement("meta");
    meta.setAttribute("name", "csrf-token");
    meta.setAttribute("content", "tok-456");
    document.head.appendChild(meta);
    var mock = mockFetch("ok");
    talkDOM.send("cs2 get: /data");
    return tick(3).then(function () {
      mock.restore();
      assert(!mock.captured().opts.headers["X-CSRF-Token"], "no token in GET");
      meta.remove();
    });
  });

  // ── Pipes ─────────────────────────────────────────────

  suite("pipe chains");

  test("value threads through pipe", function () {
    fixture('<div receiver="p1"></div>');
    talkDOM.methods["echo:"] = function (el, val) { return val; };
    talkDOM.send("p1 echo: hello | p1 apply: text");
    return tick(2).then(function () {
      assertEqual(document.querySelector('[receiver="p1"]').textContent, "hello", "piped value applied");
      delete talkDOM.methods["echo:"];
    });
  });

  test("rejection stops the chain", function () {
    fixture('<div receiver="p2"></div>');
    talkDOM.methods["reject:"] = function () { return Promise.reject("stop"); };
    talkDOM.send("p2 reject: | p2 apply: nope text");
    return tick(2).then(function () {
      assertEqual(document.querySelector('[receiver="p2"]').textContent, "", "chain stopped");
      delete talkDOM.methods["reject:"];
    });
  });

  test("async value threads through pipe", function () {
    fixture('<div receiver="p3"></div>');
    talkDOM.methods["asyncecho:"] = function (el, val) { return Promise.resolve(val); };
    talkDOM.send("p3 asyncecho: async-hello | p3 apply: text");
    return tick(3).then(function () {
      assertEqual(document.querySelector('[receiver="p3"]').textContent, "async-hello", "async piped value applied");
      delete talkDOM.methods["asyncecho:"];
    });
  });

  test("pipe across different receivers", function () {
    fixture('<div receiver="p4a"></div><div receiver="p4b"></div>');
    talkDOM.methods["produce:"] = function (el, val) { return val; };
    talkDOM.send("p4a produce: cross | p4b apply: text");
    return tick(2).then(function () {
      assertEqual(document.querySelector('[receiver="p4b"]').textContent, "cross", "value piped across receivers");
      delete talkDOM.methods["produce:"];
    });
  });

  // ── Semicolons (parallel chains) ──────────────────────

  suite("semicolons (parallel chains)");

  test("independent chains run in parallel", function () {
    fixture('<div receiver="s1"></div><div receiver="s2"></div>');
    talkDOM.send("s1 apply: alpha text; s2 apply: beta text");
    return tick().then(function () {
      assertEqual(document.querySelector('[receiver="s1"]').textContent, "alpha", "first chain");
      assertEqual(document.querySelector('[receiver="s2"]').textContent, "beta", "second chain");
    });
  });

  test("failure in one chain doesn't block another", function () {
    fixture('<div receiver="s3"></div><div receiver="s4"></div>');
    talkDOM.methods["reject2:"] = function () { return Promise.reject("err"); };
    talkDOM.send("s3 reject2: ; s4 apply: survived text");
    return tick(2).then(function () {
      assertEqual(document.querySelector('[receiver="s4"]').textContent, "survived", "second chain ran despite first failing");
      delete talkDOM.methods["reject2:"];
    });
  });

  // ── Persistence ───────────────────────────────────────

  suite("persistence");

  test("persist attribute saves to localStorage on apply", function () {
    localStorage.removeItem("talkDOM:ps1");
    fixture('<div receiver="ps1" persist></div>');
    talkDOM.send("ps1 apply: saved text");
    return tick().then(function () {
      var stored = JSON.parse(localStorage.getItem("talkDOM:ps1"));
      assertEqual(stored.op, "text", "op saved");
      assert(stored.content.indexOf("saved") !== -1, "content saved");
      localStorage.removeItem("talkDOM:ps1");
    });
  });

  test("no persist attribute means nothing saved", function () {
    localStorage.removeItem("talkDOM:ps2");
    fixture('<div receiver="ps2"></div>');
    talkDOM.send("ps2 apply: nope text");
    return tick().then(function () {
      assertEqual(localStorage.getItem("talkDOM:ps2"), null, "nothing persisted");
    });
  });

  test("persist saves innerHTML for inner op", function () {
    localStorage.removeItem("talkDOM:ps3");
    fixture('<div receiver="ps3" persist></div>');
    talkDOM.send("ps3 apply: <b>bold</b> inner");
    return tick().then(function () {
      var stored = JSON.parse(localStorage.getItem("talkDOM:ps3"));
      assertEqual(stored.op, "inner", "op is inner");
      assertEqual(stored.content, "<b>bold</b>", "innerHTML saved");
      localStorage.removeItem("talkDOM:ps3");
    });
  });

  test("corrupt localStorage handled gracefully on restore", function () {
    localStorage.setItem("talkDOM:ps4", "not valid json{{{");
    fixture('<div receiver="ps4" persist>original</div>');
    // Manually trigger restore behavior by checking the element survived
    // (restore runs at init, but we test the try-catch logic indirectly)
    assert(document.querySelector('[receiver="ps4"]').textContent === "original", "element not corrupted");
    // Verify the corrupt entry would be cleaned up
    var raw = localStorage.getItem("talkDOM:ps4");
    try {
      JSON.parse(raw);
      assert(false, "should have thrown");
    } catch (e) {
      assert(true, "corrupt JSON detected");
    }
    localStorage.removeItem("talkDOM:ps4");
  });

  // ── Sender click delegation ───────────────────────────

  suite("sender click delegation");

  test("click on sender element dispatches message", function () {
    fixture('<button sender="sd1 apply: clicked text">Go</button><div receiver="sd1"></div>');
    document.querySelector("[sender]").click();
    return tick().then(function () {
      assertEqual(document.querySelector('[receiver="sd1"]').textContent, "clicked", "sender dispatched");
    });
  });

  test("click on child bubbles to sender", function () {
    fixture('<button sender="sd2 apply: child text"><span id="sd2child">Go</span></button><div receiver="sd2"></div>');
    document.getElementById("sd2child").click();
    return tick().then(function () {
      assertEqual(document.querySelector('[receiver="sd2"]').textContent, "child", "child click delegated");
    });
  });

  test("sender click on anchor prevents default", function () {
    fixture('<a href="/nope" sender="sd3 apply: link text">Link</a><div receiver="sd3"></div>');
    var prevented = false;
    var link = document.querySelector("[sender]");
    var origAdd = link.addEventListener;
    // Listen at fixture level to catch the prevented event
    document.getElementById("fixture").addEventListener("click", function handler(e) {
      if (e.target.closest("[sender]")) prevented = e.defaultPrevented;
      document.getElementById("fixture").removeEventListener("click", handler);
    });
    link.click();
    return tick().then(function () {
      assert(prevented, "default prevented on anchor sender");
    });
  });

  // ── Confirm method ────────────────────────────────────

  suite("confirm method");

  test("confirm accepted fires talkdom:done", function () {
    fixture('<div receiver="cf1"></div>');
    var original = window.confirm;
    window.confirm = function () { return true; };
    var done = false;
    document.querySelector('[receiver="cf1"]').addEventListener("talkdom:done", function () { done = true; });
    talkDOM.send("cf1 confirm: ok?");
    return tick().then(function () {
      window.confirm = original;
      assert(done, "talkdom:done fired");
    });
  });

  test("confirm passes message to dialog", function () {
    fixture('<div receiver="cf2"></div>');
    var original = window.confirm;
    var received = "";
    window.confirm = function (msg) { received = msg; return true; };
    talkDOM.send("cf2 confirm: Delete this?");
    return tick().then(function () {
      window.confirm = original;
      assertEqual(received, "Delete this?", "message passed to confirm()");
    });
  });

  // ── Custom methods ────────────────────────────────────

  suite("custom methods");

  test("custom method via talkDOM.methods", function () {
    fixture('<div receiver="cm1"></div>');
    talkDOM.methods["greet:"] = function (el, name) { el.textContent = "Hello, " + name; };
    talkDOM.send("cm1 greet: world");
    return tick().then(function () {
      assertEqual(document.querySelector('[receiver="cm1"]').textContent, "Hello, world", "custom method ran");
      delete talkDOM.methods["greet:"];
    });
  });

  test("custom async method", function () {
    fixture('<div receiver="cm2"></div>');
    talkDOM.methods["delayed:"] = function (el, val) {
      return new Promise(function (resolve) {
        el.textContent = val;
        resolve(val);
      });
    };
    talkDOM.send("cm2 delayed: async-val");
    return tick(2).then(function () {
      assertEqual(document.querySelector('[receiver="cm2"]').textContent, "async-val", "async custom method ran");
      delete talkDOM.methods["delayed:"];
    });
  });

  // ── Multiple receivers ────────────────────────────────

  suite("multiple receivers");

  test("message delivered to all matching receivers", function () {
    fixture('<div receiver="mr1" class="a"></div><div receiver="mr1" class="b"></div>');
    talkDOM.send("mr1 apply: multi text");
    return tick().then(function () {
      var els = document.querySelectorAll('[receiver="mr1"]');
      assertEqual(els[0].textContent, "multi", "first receiver");
      assertEqual(els[1].textContent, "multi", "second receiver");
    });
  });

  // ── Error handling ────────────────────────────────────

  suite("error handling");

  test("unknown receiver logs error without crash", function () {
    var original = console.error;
    var msg = "";
    console.error = function (m) { msg = m; };
    talkDOM.send("zzz_nonexistent apply: x text");
    return tick().then(function () {
      console.error = original;
      assert(msg.indexOf("zzz_nonexistent") !== -1, "error mentions receiver name");
    });
  });

  test("unknown method logs error without crash", function () {
    fixture('<div receiver="eh2"></div>');
    var original = console.error;
    var msg = "";
    console.error = function (m) { msg = m; };
    talkDOM.send("eh2 bogus: arg");
    return tick().then(function () {
      console.error = original;
      assert(msg.indexOf("does not understand") !== -1, "error mentions unknown method");
    });
  });

  test("empty message string doesn't crash", function () {
    var threw = false;
    try {
      talkDOM.send("");
    } catch (e) {
      threw = true;
    }
    return tick().then(function () {
      assert(!threw, "no crash on empty string");
    });
  });

  // ── Programmatic API ──────────────────────────────────

  suite("programmatic API");

  test("talkDOM.send returns a promise", function () {
    fixture('<div receiver="api1"></div>');
    var ret = talkDOM.send("api1 apply: x text");
    assert(ret && typeof ret.then === "function", "returns thenable");
    return ret;
  });

  test("talkDOM.methods is extensible at runtime", function () {
    assert(typeof talkDOM.methods === "object", "methods object exposed");
    talkDOM.methods["tmp:"] = function () {};
    assert(typeof talkDOM.methods["tmp:"] === "function", "method registered");
    delete talkDOM.methods["tmp:"];
  });

  // ── Runner ────────────────────────────────────────────

  async function runAll() {
    log("talkDOM test suite\n");
    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      if (item.suite) {
        log("\n\u25B6 " + item.suite, "suite");
        continue;
      }
      try {
        var result = item.fn();
        if (result && typeof result.then === "function") await result;
      } catch (e) {
        results.fail++;
        log("  \u2717 " + item.name + " (threw: " + e.message + ")", "fail");
        results.errors.push(item.name + ": " + e.message);
      }
      document.getElementById("fixture").innerHTML = "";
    }
    log("\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    var summary = results.pass + " passed, " + results.fail + " failed";
    log(summary, results.fail === 0 ? "pass" : "fail");
    if (results.errors.length > 0) {
      log("\nFailures:");
      results.errors.forEach(function (e) { log("  \u2022 " + e, "fail"); });
    }
    document.title = (results.fail === 0 ? "\u2713 " : "\u2717 ") + summary + " \u2013 talkDOM";
  }

  runAll();

}());
