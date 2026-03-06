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

    return { receiver: receiver, selector: keywords.join(""), args: args, body: body };
  }

  function findReceiver(name) {
    return document.querySelector('[receiver="' + name + '"]');
  }

  function accepts(el, op) {
    var attr = el.getAttribute("accepts");
    if (!attr) return true;
    return attr.split(/\s+/).indexOf(op) !== -1;
  }

  function persist(el, op) {
    var name = el.getAttribute("receiver");
    if (!name || !el.hasAttribute("persist")) return;
    var key = "talkDOM:" + name;
    if (op === "outer") {
      localStorage.setItem(key, JSON.stringify({ op: op, content: el.outerHTML }));
    } else {
      localStorage.setItem(key, JSON.stringify({ op: op, content: el.innerHTML }));
    }
  }

  function restore() {
    document.querySelectorAll("[persist]").forEach(function (el) {
      var name = el.getAttribute("receiver");
      if (!name) return;
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
      console.error(el.getAttribute("receiver") + " does not accept " + op);
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

  function request(method, url) {
    return fetch(url, { method: method }).then(function (r) { return r.text(); });
  }

  const methods = {
    "get:": function (el, url) { return request("GET", url); },
    "post:": function (el, url) { return request("POST", url); },
    "put:": function (el, url) { return request("PUT", url); },
    "delete:": function (el, url) { return request("DELETE", url); },
    "apply:": function (el, content, op) { apply(el, op, content); },
    "get:apply:": function (el, url, op) { return request("GET", url).then(function (t) { apply(el, op, t); }); },
    "post:apply:": function (el, url, op) { return request("POST", url).then(function (t) { apply(el, op, t); }); },
    "put:apply:": function (el, url, op) { return request("PUT", url).then(function (t) { apply(el, op, t); }); },
    "delete:apply:": function (el, url, op) { return request("DELETE", url).then(function (t) { apply(el, op, t); }); },
  };

  var routeState = {};
  var routePaused = false;

  function updateRoute() {
    if (routePaused) return;
    var pairs = [];
    for (var name in routeState) {
      pairs.push(name + "=" + encodeURIComponent(routeState[name]));
    }
    var hash = pairs.length ? "#" + pairs.join("&") : " ";
    if (location.hash !== hash) {
      history.pushState(Object.assign({}, routeState), "", hash.trim() || location.pathname);
    }
  }

  function restoreRoute() {
    var hash = location.hash.slice(1);
    if (!hash) return;
    routePaused = true;
    hash.split("&").forEach(function (pair) {
      var idx = pair.indexOf("=");
      if (idx === -1) return;
      var name = pair.substring(0, idx);
      var body = decodeURIComponent(pair.substring(idx + 1));
      routeState[name] = body;
      send(parseMessage(name + " " + body));
    });
    routePaused = false;
  }

  window.addEventListener("popstate", function (e) {
    routePaused = true;
    routeState = e.state || {};
    for (var name in routeState) {
      send(parseMessage(name + " " + routeState[name]));
    }
    routePaused = false;
  });

  function send(msg, piped) {
    var el = findReceiver(msg.receiver);
    if (!el) {
      console.error(msg.receiver + " not found");
      return;
    }
    var method = methods[msg.selector];
    if (!method) {
      console.error(msg.receiver + " does not understand " + msg.selector);
      return;
    }
    var args = piped !== undefined ? [piped].concat(msg.args) : msg.args;
    var result = method(el, ...args);
    if (el.hasAttribute("route") && msg.body) {
      Promise.resolve(result).then(function () {
        routeState[msg.receiver] = msg.body;
        updateRoute();
      });
    }
    return result;
  }

  function dispatch(senderEl) {
    var raw = senderEl.getAttribute("sender");
    raw.split(";").forEach(function (chain) {
      var trimmed = chain.trim();
      if (!trimmed) return;
      var steps = trimmed.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
      if (steps.length === 1) {
        send(parseMessage(steps[0]));
        return;
      }
      steps.reduce(function (prev, step) {
        var msg = parseMessage(step);
        return Promise.resolve(prev).then(function (piped) {
          return send(msg, piped);
        });
      }, undefined);
    });
  }

  function parseInterval(str) {
    var match = str.match(/^(\d+)(s|ms)$/);
    if (!match) return null;
    var n = parseInt(match[1], 10);
    return match[2] === "s" ? n * 1000 : n;
  }

  function startPolling(el) {
    var raw = el.getAttribute("poll");
    if (!raw) return;
    var msg = parseMessage(raw);
    if (!msg) return;
    var everyIdx = msg.args.length - 1;
    var interval = parseInterval(msg.args[everyIdx]);
    if (!interval) {
      console.error("poll: invalid interval");
      return;
    }
    var selector = msg.selector.replace("every:", "");
    var args = msg.args.slice(0, everyIdx);
    setInterval(function () {
      var target = findReceiver(msg.receiver);
      if (!target) return;
      var method = methods[selector];
      if (!method) {
        console.error(msg.receiver + " does not understand " + selector);
        return;
      }
      method(target, ...args);
    }, interval);
  }

  document.addEventListener("click", function (e) {
    const sender = e.target.closest("[sender]");
    if (sender) dispatch(sender);
  });

  restore();
  restoreRoute();
  document.querySelectorAll("[poll]").forEach(startPolling);

  window.talkDOM = { methods: methods };

}());
