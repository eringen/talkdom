(function () {

  function parseMessage(str) {
    var trimmed = str.trim();
    var tokens = trimmed.split(/\s+/);
    var receiver = tokens[0];
    var body = trimmed.substring(receiver.length).trim();
    var rest = tokens.slice(1);
    var keywords = [];
    var args = [];
    var currentArg = [];

    for (var i = 0; i < rest.length; i++) {
      var token = rest[i];
      if (token.endsWith(":")) {
        if (keywords.length > 0 && currentArg.length > 0) {
          args.push(currentArg.join(" "));
          currentArg = [];
        } else if (keywords.length > 0) {
          args.push("");
        }
        keywords.push(token);
      } else {
        currentArg.push(token);
      }
    }
    if (keywords.length > 0) {
      args.push(currentArg.join(" "));
    }

    return { receiver: receiver, selector: keywords.join(""), keywords: keywords, args: args, body: body };
  }

  function receiverName(el) {
    return el.getAttribute("receiver").trim().split(/\s+/)[0];
  }

  function findReceivers(name) {
    return document.querySelectorAll('[receiver~="' + name + '"]');
  }

  function accepts(el, op) {
    var attr = el.getAttribute("accepts");
    if (!attr) return true;
    return attr.split(/\s+/).indexOf(op) !== -1;
  }

  function persist(el, op) {
    if (!el.hasAttribute("receiver") || !el.hasAttribute("persist")) return;
    var name = receiverName(el);
    var key = "talkDOM:" + name;
    if (op === "outer") {
      localStorage.setItem(key, JSON.stringify({ op: op, content: el.outerHTML }));
    } else {
      localStorage.setItem(key, JSON.stringify({ op: op, content: el.innerHTML }));
    }
  }

  function restore() {
    document.querySelectorAll("[persist]").forEach(function (el) {
      if (!el.hasAttribute("receiver")) return;
      var name = receiverName(el);
      var raw = localStorage.getItem("talkDOM:" + name);
      if (!raw) return;
      var state = JSON.parse(raw);
      if (state.op === "outer") {
        el.outerHTML = state.content;
      } else {
        el.innerHTML = state.content;
      }
    });
  }

  function apply(el, op, content) {
    if (!accepts(el, op)) {
      console.error(receiverName(el) + " does not accept " + op);
      return;
    }
    switch (op) {
      case "inner": el.innerHTML = content; break;
      case "text": el.textContent = content; break;
      case "append": el.innerHTML += content; break;
      case "outer": el.outerHTML = content; break;
    }
    persist(el, op);
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : "";
  }

  function request(method, url, receiver) {
    var headers = {
      "X-TalkDOM-Request": "true",
      "X-TalkDOM-Current-URL": location.href,
    };
    if (receiver) {
      headers["X-TalkDOM-Receiver"] = receiver;
    }
    if (method !== "GET") {
      var token = csrfToken();
      if (token) headers["X-CSRF-Token"] = token;
    }
    return fetch(url, { method: method, headers: headers }).then(function (r) {
      if (!r.ok) {
        console.error("talkDOM: " + method + " " + url + " " + r.status);
        return Promise.reject(r.status);
      }
      var trigger = r.headers.get("X-TalkDOM-Trigger");
      return r.text().then(function (text) {
        if (trigger) dispatchRaw(trigger);
        return text;
      });
    }, function (err) {
      console.error("talkDOM: " + method + " " + url + " failed", err);
      return Promise.reject(err);
    });
  }

  function recName(el) {
    return el.hasAttribute("receiver") ? receiverName(el) : "";
  }

  const methods = {
    "get:": function (el, url) { return request("GET", url, recName(el)); },
    "post:": function (el, url) { return request("POST", url, recName(el)); },
    "put:": function (el, url) { return request("PUT", url, recName(el)); },
    "delete:": function (el, url) { return request("DELETE", url, recName(el)); },
    "confirm:": function (el, message) { if (!confirm(message)) return Promise.reject(); },
    "apply:": function (el, content, op) { apply(el, op, content); },
    "get:apply:": function (el, url, op) { return request("GET", url, recName(el)).then(function (t) { apply(el, op, t); }); },
    "post:apply:": function (el, url, op) { return request("POST", url, recName(el)).then(function (t) { apply(el, op, t); }); },
    "put:apply:": function (el, url, op) { return request("PUT", url, recName(el)).then(function (t) { apply(el, op, t); }); },
    "delete:apply:": function (el, url, op) { return request("DELETE", url, recName(el)).then(function (t) { apply(el, op, t); }); },
  };

  var pushing = false;

  function pushUrl(senderEl, raw) {
    if (!senderEl.hasAttribute("push-url")) return;
    var url = senderEl.getAttribute("push-url");
    if (!url) {
      var firstMsg = parseMessage(raw.split(";")[0].split("|")[0].trim());
      url = firstMsg.args[0] || "";
    }
    if (url && (location.pathname + location.search) !== url) {
      history.pushState({ sender: raw }, "", url);
    }
  }

  function replayState(state) {
    if (!state || !state.sender) return;
    pushing = true;
    dispatchRaw(state.sender);
    pushing = false;
  }

  window.addEventListener("popstate", function (e) {
    replayState(e.state);
  });

  function send(msg, piped) {
    var els = findReceivers(msg.receiver);
    if (els.length === 0) {
      console.error(msg.receiver + " not found");
      return;
    }
    var method = methods[msg.selector];
    if (!method) {
      console.error(msg.receiver + " does not understand " + msg.selector);
      return;
    }
    var args = piped !== undefined ? [piped].concat(msg.args) : msg.args;
    var detail = { receiver: msg.receiver, selector: msg.selector, args: msg.args };
    var result;
    els.forEach(function (el) {
      result = method(el, ...args);
      if (result && typeof result.then === "function") {
        result.then(function () {
          var target = el.isConnected ? el : findReceivers(msg.receiver)[0];
          if (target) target.dispatchEvent(new CustomEvent("talkdom:done", { bubbles: true, detail: detail }));
        }, function (err) {
          detail.error = err;
          var target = el.isConnected ? el : findReceivers(msg.receiver)[0];
          if (target) target.dispatchEvent(new CustomEvent("talkdom:error", { bubbles: true, detail: detail }));
        });
      } else {
        var target = el.isConnected ? el : findReceivers(msg.receiver)[0];
        if (target) target.dispatchEvent(new CustomEvent("talkdom:done", { bubbles: true, detail: detail }));
      }
    });
    return result;
  }

  function run(raw) {
    var chains = raw.split(";").map(function (chain) {
      var trimmed = chain.trim();
      if (!trimmed) return Promise.resolve();
      var steps = trimmed.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
      if (steps.length === 1) {
        return Promise.resolve(send(parseMessage(steps[0])));
      }
      return steps.reduce(function (prev, step) {
        var msg = parseMessage(step);
        return Promise.resolve(prev).then(function (piped) {
          return send(msg, piped);
        });
      }, undefined);
    });
    return Promise.all(chains);
  }

  function dispatchRaw(raw) {
    run(raw).catch(function () {});
  }

  function dispatch(senderEl) {
    var raw = senderEl.getAttribute("sender");
    dispatchRaw(raw);
    if (!pushing) pushUrl(senderEl, raw);
  }

  function parseInterval(str) {
    var match = str.match(/^(\d+)(s|ms)$/);
    if (!match) return null;
    var n = parseInt(match[1], 10);
    return match[2] === "s" ? n * 1000 : n;
  }

  function startPolling(el) {
    var attr = el.getAttribute("receiver");
    var msg = parseMessage(attr);
    if (msg.keywords[msg.keywords.length - 1] !== "poll:") return;
    var interval = parseInterval(msg.args[msg.args.length - 1]);
    if (!interval) {
      console.error("poll: invalid interval for " + msg.receiver);
      return;
    }
    var selector = msg.keywords.slice(0, -1).join("");
    var args = msg.args.slice(0, -1);
    var name = msg.receiver;
    var id = setInterval(function () {
      if (!el.isConnected) { clearInterval(id); return; }
      var targets = findReceivers(name);
      if (targets.length === 0) return;
      var method = methods[selector];
      if (!method) {
        console.error(name + " does not understand " + selector);
        return;
      }
      targets.forEach(function (target) { method(target, ...args); });
    }, interval);
  }

  document.addEventListener("click", function (e) {
    const sender = e.target.closest("[sender]");
    if (sender) {
      e.preventDefault();
      dispatch(sender);
    }
  });

  restore();
  replayState(history.state);
  document.querySelectorAll("[receiver]").forEach(startPolling);

  window.talkDOM = { methods: methods, send: run };

}());
