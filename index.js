(function () {

  var WS = /\s+/;
  var config = Object.assign({ trustedOrigins: [], includeCurrentURL: true, allowServerTriggers: true, strictApply: false }, window.talkDOMConfig);

  // Parse "receiver keyword: arg keyword: arg" into structured message object.
  // Tokens ending with ":" are keywords, everything else fills args.
  function parseMessage(str) {
    var trimmed = str.trim();
    var tokens = trimmed.split(WS);
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

  // Extract the first word from the receiver attribute (the name).
  function receiverName(el) {
    return (el.getAttribute("receiver") || "").trim().split(WS)[0];
  }

  // Receiver cache: names before the first keyword are aliases, never arguments.
  var receiverCache = Object.create(null);
  var cacheValid = false;

  var receiverObserver = new MutationObserver(function () { cacheValid = false; });
  receiverObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["receiver"] });

  // Index literal names without interpolating user input into CSS selectors.
  function findReceivers(name) {
    if (receiverObserver.takeRecords().length) cacheValid = false;
    if (!cacheValid) {
      receiverCache = Object.create(null);
      document.querySelectorAll("[receiver]").forEach(function (el) {
        var tokens = el.getAttribute("receiver").trim().split(WS);
        for (var i = 0; i < tokens.length && !tokens[i].endsWith(":"); i++) {
          var key = tokens[i];
          if (!key) continue;
          var matches = receiverCache[key] || (receiverCache[key] = []);
          if (matches.indexOf(el) === -1) matches.push(el);
        }
      });
      cacheValid = true;
    }
    return receiverCache[name] || [];
  }

  // Check if a receiver allows a given apply operation (inner, text, append, outer).
  // No "accepts" attribute means everything is allowed.
  function accepts(el, op) {
    var attr = el.getAttribute("accepts");
    if (!attr) return true;
    return attr.trim().split(WS).indexOf(op) !== -1;
  }

  // Save receiver content to localStorage after apply, keyed by receiver name.
  function persist(el, op, content) {
    if (!el.hasAttribute("receiver") || !el.hasAttribute("persist")) return;
    var name = receiverName(el);
    var key = "talkDOM:" + name;
    if (op === "outer") {
      storage("setItem", key, JSON.stringify({ op: op, content: String(content) }));
    } else {
      storage("setItem", key, JSON.stringify({ op: op, content: el.innerHTML }));
    }
  }

  function storage(action, key, value) {
    try { return localStorage[action](key, value); }
    catch (err) { console.warn("talkDOM: storage " + action + " failed for " + key, err); }
  }

  // On page load, restore persisted receiver content from localStorage.
  var restored = new WeakSet();
  function restore() {
    document.querySelectorAll("[persist]").forEach(function (el) {
      if (!el.hasAttribute("receiver") || restored.has(el)) return;
      restored.add(el);
      var name = receiverName(el);
      var key = "talkDOM:" + name;
      var raw = storage("getItem", key);
      if (raw === null || raw === undefined) return;
      var state;
      try {
        state = JSON.parse(raw);
        if (!state || typeof state !== "object" || Array.isArray(state) ||
            ["inner", "text", "append", "outer"].indexOf(state.op) === -1 || typeof state.content !== "string") {
          storage("removeItem", key);
          return;
        }
        if (state.op === "outer") el.outerHTML = state.content;
        else el.innerHTML = state.content;
      } catch (err) {
        console.warn("talkDOM: cannot restore " + key, err);
        storage("removeItem", key);
      }
    });
  }

  var replacements = new WeakMap();
  var applyFailures = new WeakMap();

  // Apply content to an element using the specified operation (inner, text, append, outer).
  function apply(el, op, content) {
    applyFailures.delete(el);
    var supported = ["inner", "text", "append", "outer"].indexOf(op) !== -1;
    if (!supported || !accepts(el, op)) {
      var error = new TypeError(!supported ? "unknown apply operation: " + op : receiverName(el) + " does not accept " + op);
      applyFailures.set(el, error);
      if (config.strictApply) throw error;
      console.error(error.message);
      return;
    }
    switch (op) {
      case "inner": el.innerHTML = content; break;
      case "text": el.textContent = content; break;
      case "append": el.insertAdjacentHTML("beforeend", content); break;
      case "outer": {
        var parent = el.parentNode;
        if (!parent) { el.outerHTML = content; break; }
        var before = el.previousSibling;
        var after = el.nextSibling;
        el.outerHTML = content;
        var nodes = [];
        var node = before ? before.nextSibling : parent.firstChild;
        while (node && node !== after) { nodes.push(node); node = node.nextSibling; }
        replacements.set(el, { nodes: nodes, parent: parent });
        break;
      }
    }
    persist(el, op, content);
    return content;
  }

  var csrfMeta = null;

  function csrfToken() {
    // Cache the element reference; re-query only if not found yet or removed.
    if (!csrfMeta || !csrfMeta.isConnected) {
      csrfMeta = document.querySelector('meta[name="csrf-token"]');
    }
    return csrfMeta ? csrfMeta.getAttribute("content") : "";
  }

  // Perform a fetch with talkDOM headers. Returns a promise resolving to response text.
  // Fires server-triggered messages from X-TalkDOM-Trigger header if present.
  function request(method, url, receiver) {
    var origin = new URL(url, document.baseURI).origin;
    var trusted = origin === location.origin || config.trustedOrigins.indexOf(origin) !== -1;
    var headers = {
      "X-TalkDOM-Request": "true",
    };
    if (trusted && config.includeCurrentURL) headers["X-TalkDOM-Current-URL"] = location.href;
    if (receiver) {
      headers["X-TalkDOM-Receiver"] = receiver;
    }
    if (method !== "GET" && trusted) {
      var token = csrfToken();
      if (token) headers["X-CSRF-Token"] = token;
      else console.warn("talkDOM: no CSRF token found for " + method + " " + url);
    }
    return fetch(url, { method: method, headers: headers }).then(function (r) {
      if (!r.ok) {
        console.error("talkDOM: " + method + " " + url + " " + r.status);
        return Promise.reject(r.status);
      }
      var trigger = r.headers.get("X-TalkDOM-Trigger");
      return r.text().then(function (text) {
        if (trigger && config.allowServerTriggers) dispatchRaw(trigger);
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

  // Built-in method table. Each method receives (el, ...args) from the parsed message.
  // Extensible via talkDOM.methods at runtime.
  const methods = {
    "get:": function (el, url) { return request("GET", url, recName(el)); },
    "post:": function (el, url) { return request("POST", url, recName(el)); },
    "put:": function (el, url) { return request("PUT", url, recName(el)); },
    "delete:": function (el, url) { return request("DELETE", url, recName(el)); },
    "confirm:": function (el, message) { if (!confirm(message)) return Promise.reject("cancelled"); },
    "apply:": function (el, content, op) { return apply(el, op, content); },
    "text:": function (el, content) { return apply(el, "text", content); },
    "get:apply:": function (el, url, op) { return request("GET", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
    "post:apply:": function (el, url, op) { return request("POST", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
    "put:apply:": function (el, url, op) { return request("PUT", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
    "delete:apply:": function (el, url, op) { return request("DELETE", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
  };

  var historyRegions = [];
  var navigation = 0;
  var initialHistory = history.state;

  // Boundaries survive receiver outer swaps, including empty replacements.
  function ensureHistoryRegions() {
    document.querySelectorAll("[receiver]").forEach(function (el) {
      if (el.parentElement && el.parentElement.closest("[receiver]")) return;
      if (historyRegions.some(function (region) {
        if (!region.start.isConnected || !region.end.isConnected) return false;
        var range = document.createRange();
        range.setStartAfter(region.start);
        range.setEndBefore(region.end);
        return range.intersectsNode(el);
      })) return;
      var id = historyRegions.length;
      var start = document.createComment("talkDOM history " + id);
      var end = document.createComment("/talkDOM history " + id);
      el.before(start);
      el.after(end);
      historyRegions.push({ start: start, end: end });
    });
  }

  function historySnapshot() {
    ensureHistoryRegions();
    return historyRegions.map(function (region) {
      if (!region.start.isConnected || !region.end.isConnected) return null;
      var range = document.createRange();
      range.setStartAfter(region.start);
      range.setEndBefore(region.end);
      var box = document.createElement("div");
      box.appendChild(range.cloneContents());
      // Restoring navigation must not execute scripts from earlier responses.
      box.querySelectorAll("script").forEach(function (script) { script.remove(); });
      return box.innerHTML;
    });
  }

  function historyState() {
    var state = history.state;
    return Object.assign({}, state && typeof state === "object" ? state : {}, {
      talkDOM: { version: 1, regions: historySnapshot() }
    });
  }

  function restoreHistory(state) {
    var saved = state && state.talkDOM;
    if (!saved || saved.version !== 1 || !Array.isArray(saved.regions)) return;
    ensureHistoryRegions();
    saved.regions.forEach(function (html, i) {
      var region = historyRegions[i];
      if (typeof html !== "string" || !region || !region.start.isConnected || !region.end.isConnected) return;
      var range = document.createRange();
      range.setStartAfter(region.start);
      range.setEndBefore(region.end);
      range.deleteContents();
      range.insertNode(range.createContextualFragment(html));
    });
  }

  function navigationURL(senderEl, raw) {
    var url = senderEl.getAttribute("push-url");
    if (!url) {
      var first = parseMessage(raw.split(";")[0].split("|")[0]);
      url = first.args[0];
    }
    if (!url) return null;
    var resolved = new URL(url, document.baseURI);
    if (resolved.origin !== location.origin || !/^https?:$/.test(resolved.protocol)) {
      throw new TypeError("push-url must use the page origin");
    }
    return resolved.href;
  }

  window.addEventListener("popstate", function (e) {
    navigation++;
    restoreHistory(e.state);
  });

  // Use actual inserted nodes; text/removal events bubble from the old parent.
  function eventTarget(el, previous, parent) {
    if (el.isConnected) return el;
    var replacement = replacements.get(el);
    if (replacement && replacement !== previous) {
      for (var i = 0; i < replacement.nodes.length; i++) {
        var node = replacement.nodes[i];
        if (node.nodeType === 1 && node.isConnected) return node;
      }
      parent = replacement.parent;
    }
    return parent && parent.isConnected ? parent : document;
  }

  // Shared delivery path for messages, polling, and plugin applies.
  function deliver(el, selector, args, name, detailArgs) {
    var method = methods[selector];
    var detail = { receiver: name || receiverName(el), selector: selector, args: detailArgs || args, originalReceiver: el };
    var parent = el.parentNode;
    var previous = replacements.get(el);
    var previousFailure = applyFailures.get(el);
    function done(value) {
      var error = applyFailures.get(el);
      if (error && error !== previousFailure) detail.error = error;
      eventTarget(el, previous, parent).dispatchEvent(new CustomEvent(detail.error ? "talkdom:error" : "talkdom:done", { bubbles: true, detail: detail }));
      return value;
    }
    function failed(err) {
      detail.error = err;
      eventTarget(el, previous, parent).dispatchEvent(new CustomEvent("talkdom:error", { bubbles: true, detail: detail }));
      throw err;
    }
    var result;
    try {
      result = method(el, ...args);
      if (result && typeof result.then === "function") return Promise.resolve(result).then(done, failed);
      return done(result);
    } catch (err) { return Promise.reject(err).catch(failed); }
  }

  function send(msg, piped) {
    var els = findReceivers(msg.receiver);
    if (els.length === 0) {
      console.error(msg.receiver + " not found");
      return;
    }
    if (!methods[msg.selector]) {
      console.error(msg.receiver + " does not understand " + msg.selector);
      return;
    }
    var args = piped !== undefined ? [piped].concat(msg.args) : msg.args;
    var results = els.map(function (el) { return deliver(el, msg.selector, args, msg.receiver, msg.args); });
    return Promise.all(results).then(function (values) { return values[values.length - 1]; });
  }

  function execute(raw, piped) {
    try { return Promise.resolve(send(parseMessage(raw), piped)); }
    catch (err) { return Promise.reject(err); }
  }

  // Programmatic API: parse and execute a raw message string (supports pipes and semicolons).
  // Returns a promise that resolves when all chains complete.
  function run(raw) {
    var trimmed;
    try { trimmed = raw.trim(); }
    catch (err) { return Promise.reject(err); }
    // Fast path: no pipes or semicolons (most common case).
    if (trimmed.indexOf(";") === -1 && trimmed.indexOf("|") === -1) {
      return execute(trimmed).then(function (r) { return [r]; });
    }
    // Semicolons split into independent chains that run in parallel.
    var chains = trimmed.split(";").map(function (chain) {
      var step = chain.trim();
      if (!step) return Promise.resolve();
      // Pipes split a chain into sequential steps where each step's return
      // value is fed as the first argument to the next step.
      var steps = step.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
      if (steps.length === 1) {
        return execute(steps[0]);
      }
      // Reduce builds a promise chain: each step waits for the previous one,
      // then passes its resolved value (piped) into send().
      return steps.reduce(function (prev, step) {
        return Promise.resolve(prev).then(function (piped) {
          return execute(step, piped);
        });
      }, undefined);
    });
    // All independent chains resolve together.
    return Promise.all(chains);
  }

  // Fire-and-forget dispatch used by declarative senders and server triggers.
  function dispatchRaw(raw) {
    run(raw).catch(function (err) { console.warn("talkDOM:", err); });
  }

  // Entry point for a sender click: dispatch its message and optionally push URL.
  function dispatch(senderEl) {
    var raw = senderEl.getAttribute("sender");
    if (!senderEl.hasAttribute("push-url")) { dispatchRaw(raw); return; }
    var url;
    var current = ++navigation;
    try {
      url = navigationURL(senderEl, raw);
      history.replaceState(historyState(), "", location.href);
    } catch (err) { console.warn("talkDOM: history", err); }
    run(raw).then(function () {
      if (current !== navigation || !url) return;
      if (url === location.href) history.replaceState(historyState(), "", url);
      else history.pushState(historyState(), "", url);
    }).catch(function (err) { console.warn("talkDOM:", err); });
  }

  function parseInterval(str) {
    var match = str.match(/^(\d+)(s|ms)$/);
    if (!match) return null;
    var n = parseInt(match[1], 10);
    return match[2] === "s" ? n * 1000 : n;
  }

  // Identical declarations share a poller; each tick resolves the live group.
  var pollers = new Map();
  var maxPollers = 64;

  function pollingDeclarations() {
    var declarations = new Map();
    document.querySelectorAll("[receiver]").forEach(function (el) {
      var msg = parseMessage(el.getAttribute("receiver"));
      if (msg.keywords[msg.keywords.length - 1] !== "poll:") return;
      var interval = parseInterval(msg.args.pop());
      msg.keywords.pop();
      msg.selector = msg.keywords.join("");
      if (!interval || !Number.isSafeInteger(interval) || interval > 2147483647) return;
      var key = JSON.stringify([msg.receiver, msg.selector, msg.args, interval]);
      declarations.set(key, { msg: msg, interval: interval });
    });
    return declarations;
  }

  function reconcilePolling() {
    var declarations = pollingDeclarations();
    pollers.forEach(function (poller, key) {
      if (!declarations.has(key)) {
        clearInterval(poller.id);
        pollers.delete(key);
      }
    });
    declarations.forEach(function (declaration, key) {
      if (pollers.has(key)) return;
      if (pollers.size >= maxPollers) {
        console.warn("talkDOM: max pollers (" + maxPollers + ") reached");
        return;
      }
      var poller = { pending: false, id: null };
      poller.id = setInterval(function () {
        // Account for same-turn removal/configuration changes before delivery.
        reconcilePolling();
        if (pollers.get(key) !== poller || poller.pending) return;
        var msg = declaration.msg;
        if (!methods[msg.selector]) return;
        poller.pending = true;
        var results = findReceivers(msg.receiver).map(function (target) {
          return Promise.resolve(deliver(target, msg.selector, msg.args, msg.receiver)).catch(function (err) {
            console.warn("talkDOM: poll failed", err);
          });
        });
        Promise.all(results).then(function () { poller.pending = false; });
      }, declaration.interval);
      pollers.set(key, poller);
    });
  }

  new MutationObserver(reconcilePolling).observe(document, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["receiver"]
  });

  // Global click handler: delegate to any element with a sender attribute.
  document.addEventListener("click", function (e) {
    const sender = e.target.closest("[sender]");
    if (sender) {
      e.preventDefault();
      dispatch(sender);
    }
  });

  restore();
  restoreHistory(history.state);
  reconcilePolling();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () {
    restore();
    if (navigation === 0) restoreHistory(initialHistory);
    reconcilePolling();
  }, { once: true });

  window.talkDOM = {
    config: config,
    methods: methods,
    send: run,
    deliver: function (el, selector, args) {
      try { return Promise.resolve(deliver(el, selector, args)); }
      catch (err) { return Promise.reject(err); }
    },
    receivers: function (name) { return findReceivers(name).slice(); },
    get maxPollers() { return maxPollers; },
    set maxPollers(n) {
      if (!Number.isInteger(n) || n < 0) throw new TypeError("maxPollers must be a nonnegative integer");
      maxPollers = n;
      reconcilePolling();
    },
  };

}());
