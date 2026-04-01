(function () {

  if (!window.talkDOM) {
    console.error("talkdom-ws: load index.js before websocket.js");
    return;
  }

  var methods = talkDOM.methods;
  var connections = Object.create(null);
  var maxConnections = 16;
  var BASE_DELAY = 1000;
  var MAX_DELAY = 30000;
  var CLEANUP_INTERVAL = 5000;
  var WS = /\s+/;

  // Parse receiver attribute to extract ws: URL.
  // Returns the URL string or null if no ws: keyword found.
  function parseWsUrl(attr) {
    var tokens = attr.trim().split(WS);
    for (var i = 1; i < tokens.length; i++) {
      if (tokens[i] === "ws:" && tokens[i + 1]) return tokens[i + 1];
    }
    return null;
  }

  // Remove disconnected elements from a connection's receiver set.
  // Returns true if any receivers remain.
  function pruneReceivers(conn) {
    conn.receivers.forEach(function (el) {
      if (!el.isConnected) conn.receivers.delete(el);
    });
    return conn.receivers.size > 0;
  }

  // Fire a custom event on all connected receivers for a URL.
  function fireEvent(conn, name, detail) {
    conn.receivers.forEach(function (el) {
      if (el.isConnected) {
        el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
      }
    });
  }

  // Route a parsed JSON message to matching receiver elements.
  function routeJson(conn, msg) {
    var name = msg.receiver;
    var op = msg.op || "inner";
    var content = msg.content || "";
    var targets;
    if (name) {
      targets = document.querySelectorAll('[receiver~="' + name + '"]');
    } else {
      // Broadcast to all receivers on this connection.
      targets = Array.from(conn.receivers);
    }
    var detail = { receiver: name || "", selector: "apply:", args: [content, op] };
    for (var i = 0; i < targets.length; i++) {
      var el = targets[i];
      methods["apply:"](el, content, op);
      el.dispatchEvent(new CustomEvent("talkdom:done", { bubbles: true, detail: detail }));
    }
  }

  // Handle an incoming WebSocket message.
  function onMessage(url, event) {
    var conn = connections[url];
    if (!conn) return;
    pruneReceivers(conn);
    var data = event.data;
    if (typeof data !== "string") return; // ignore binary
    if (data.charAt(0) === "{") {
      try {
        var msg = JSON.parse(data);
        routeJson(conn, msg);
      } catch (e) {
        console.error("talkdom-ws: invalid JSON from " + url, e);
      }
    } else {
      // Raw talkDOM message syntax, dispatch through core.
      talkDOM.send(data).catch(function (err) {
        console.warn("talkdom-ws:", err);
      });
    }
  }

  function scheduleReconnect(url) {
    var conn = connections[url];
    if (!conn) return;
    if (!pruneReceivers(conn)) { cleanup(url); return; }
    var delay = Math.min(conn.backoff, MAX_DELAY);
    delay = delay * (0.75 + Math.random() * 0.5);
    conn.timer = setTimeout(function () {
      conn.backoff = Math.min(conn.backoff * 2, MAX_DELAY);
      connectWs(url);
    }, delay);
  }

  function cleanup(url) {
    var conn = connections[url];
    if (!conn) return;
    if (conn.timer) clearTimeout(conn.timer);
    if (conn.checkTimer) clearInterval(conn.checkTimer);
    if (conn.ws) {
      conn.ws.onclose = null; // prevent reconnect on intentional close
      conn.ws.close();
    }
    delete connections[url];
  }

  function connectWs(url) {
    var conn = connections[url];
    if (!conn) return;
    // Already open or connecting — skip.
    if (conn.ws && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING)) return;

    var ws = new WebSocket(url);

    ws.onopen = function () {
      conn.backoff = BASE_DELAY;
      fireEvent(conn, "talkdom:ws:open", { url: url });
    };

    ws.onmessage = function (e) {
      onMessage(url, e);
    };

    ws.onclose = function (e) {
      fireEvent(conn, "talkdom:ws:close", { url: url, code: e.code, reason: e.reason });
      scheduleReconnect(url);
    };

    ws.onerror = function () {
      fireEvent(conn, "talkdom:ws:error", { url: url });
    };

    conn.ws = ws;
  }

  // Subscribe an element to a WebSocket URL.
  function subscribe(el, url) {
    var conn = connections[url];
    if (!conn) {
      var count = Object.keys(connections).length;
      if (count >= maxConnections) {
        console.warn("talkdom-ws: max connections (" + maxConnections + ") reached, ignoring " + url);
        return;
      }
      conn = { ws: null, receivers: new Set(), backoff: BASE_DELAY, timer: null, checkTimer: null };
      connections[url] = conn;
      // Periodic cleanup check for this connection.
      conn.checkTimer = setInterval(function () {
        if (!pruneReceivers(conn)) cleanup(url);
      }, CLEANUP_INTERVAL);
    }
    conn.receivers.add(el);
    connectWs(url);
  }

  // Scan a single element for ws: keyword and subscribe.
  function initElement(el) {
    var attr = el.getAttribute("receiver");
    if (!attr) return;
    var url = parseWsUrl(attr);
    if (!url) return;
    subscribe(el, url);
  }

  // Scan all existing receiver elements.
  function initWsReceivers() {
    document.querySelectorAll("[receiver]").forEach(initElement);
  }

  // Watch for dynamically added ws: receivers.
  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.hasAttribute && node.hasAttribute("receiver")) initElement(node);
        if (node.querySelectorAll) {
          node.querySelectorAll("[receiver]").forEach(initElement);
        }
      }
    }
  }).observe(document, { childList: true, subtree: true });

  // ws:send: method — send element value over an existing WebSocket connection.
  methods["ws:send:"] = function (el, url) {
    var conn = connections[url];
    if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
      console.error("talkdom-ws: no open connection to " + url);
      return Promise.reject("not connected");
    }
    var payload = ("value" in el) ? el.value : el.textContent;
    conn.ws.send(payload);
  };

  initWsReceivers();

  talkDOM.ws = {
    connect: function (url) {
      if (!connections[url]) {
        var count = Object.keys(connections).length;
        if (count >= maxConnections) {
          console.warn("talkdom-ws: max connections (" + maxConnections + ") reached");
          return;
        }
        connections[url] = { ws: null, receivers: new Set(), backoff: BASE_DELAY, timer: null, checkTimer: null };
        connections[url].checkTimer = setInterval(function () {
          if (!pruneReceivers(connections[url])) cleanup(url);
        }, CLEANUP_INTERVAL);
      }
      connectWs(url);
    },
    disconnect: function (url) { cleanup(url); },
    send: function (url, data) {
      var conn = connections[url];
      if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) return false;
      conn.ws.send(typeof data === "string" ? data : JSON.stringify(data));
      return true;
    },
    get connections() {
      var out = Object.create(null);
      for (var url in connections) {
        out[url] = { state: connections[url].ws ? connections[url].ws.readyState : -1, receivers: connections[url].receivers.size };
      }
      return out;
    },
    get maxConnections() { return maxConnections; },
    set maxConnections(n) { maxConnections = n; },
  };

}());
