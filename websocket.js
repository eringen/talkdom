(function () {

  if (!window.talkDOM) {
    console.error("talkdom-ws: load index.js before websocket.js");
    return;
  }

  var methods = talkDOM.methods;
  var connections = Object.create(null);
  var subscriptions = new Map();
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
      if (!el.isConnected || parseWsUrl(el.getAttribute("receiver") || "") !== conn.url) conn.receivers.delete(el);
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

  function messageError(conn, error) {
    console.error("talkdom-ws: message failed from " + conn.url, error);
    fireEvent(conn, "talkdom:ws:error", { url: conn.url, error: error });
  }

  // Named messages and broadcasts have the same connection scope.
  function routeJson(conn, msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg) ||
        (msg.receiver !== undefined && typeof msg.receiver !== "string") ||
        (msg.op !== undefined && ["inner", "text", "append", "outer"].indexOf(msg.op) === -1) ||
        (msg.content !== undefined && msg.content !== null &&
          ["string", "number", "boolean"].indexOf(typeof msg.content) === -1)) {
      messageError(conn, new TypeError("invalid message envelope"));
      return;
    }
    var name = msg.receiver;
    var op = msg.op || "inner";
    var content = (msg.content === null || msg.content === undefined) ? "" : String(msg.content);
    var named = name ? talkDOM.receivers(name) : null;
    Array.from(conn.receivers).forEach(function (el) {
      if (!el.isConnected || (named && named.indexOf(el) === -1)) return;
      talkDOM.deliver(el, "apply:", [content, op]).catch(function (err) { messageError(conn, err); });
    });
  }

  function onMessage(url, event) {
    initWsReceivers();
    var conn = connections[url];
    if (!conn) return;
    pruneReceivers(conn);
    var data = event.data;
    if (typeof data !== "string") return;
    data = data.trimStart();
    if (data.charAt(0) === "{" || data.charAt(0) === "[") {
      var msg;
      try { msg = JSON.parse(data); }
      catch (err) { messageError(conn, err); return; }
      routeJson(conn, msg);
    } else {
      // Raw commands intentionally retain their document-wide scope.
      talkDOM.send(data).catch(function (err) { messageError(conn, err); });
    }
  }

  function scheduleReconnect(url) {
    var conn = connections[url];
    if (!conn) return;
    if (!pruneReceivers(conn) && !conn.manual) { cleanup(url); return; }
    if (conn.timer) clearTimeout(conn.timer);
    var delay = Math.min(conn.backoff, MAX_DELAY);
    delay = delay * (0.75 + Math.random() * 0.5);
    conn.timer = setTimeout(function () {
      conn.timer = null;
      if (connections[url] !== conn) return;
      if (!pruneReceivers(conn) && !conn.manual) { cleanup(url); return; }
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
      conn.ws.onopen = conn.ws.onmessage = conn.ws.onerror = conn.ws.onclose = null;
      conn.ws.close();
    }
    delete connections[url];
  }

  function connectWs(url) {
    var conn = connections[url];
    if (!conn) return;
    // Already open or connecting — skip.
    if (conn.ws && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING)) return;
    if (conn.timer) { clearTimeout(conn.timer); conn.timer = null; }

    var ws;
    try {
      var parsed = new URL(url, document.baseURI);
      if (["ws:", "wss:", "http:", "https:"].indexOf(parsed.protocol) === -1 || parsed.hash) {
        throw new TypeError("invalid WebSocket URL");
      }
      ws = new WebSocket(url);
    } catch (err) {
      fireEvent(conn, "talkdom:ws:error", { url: url, error: err });
      console.error("talkdom-ws: cannot connect to " + url, err);
      cleanup(url);
      return;
    }

    ws.onopen = function () {
      if (connections[url] !== conn || conn.ws !== ws) return;
      conn.backoff = BASE_DELAY;
      fireEvent(conn, "talkdom:ws:open", { url: url });
    };

    ws.onmessage = function (e) {
      if (connections[url] !== conn || conn.ws !== ws) return;
      onMessage(url, e);
    };

    ws.onclose = function (e) {
      if (connections[url] !== conn || conn.ws !== ws) return;
      fireEvent(conn, "talkdom:ws:close", { url: url, code: e.code, reason: e.reason });
      scheduleReconnect(url);
    };

    ws.onerror = function () {
      if (connections[url] !== conn || conn.ws !== ws) return;
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
        return false;
      }
      conn = { url: url, ws: null, receivers: new Set(), manual: false, backoff: BASE_DELAY, timer: null, checkTimer: null };
      connections[url] = conn;
      // Periodic cleanup check for this connection.
      conn.checkTimer = setInterval(function () {
        if (!pruneReceivers(conn) && !conn.manual) cleanup(url);
      }, CLEANUP_INTERVAL);
    }
    conn.receivers.add(el);
    connectWs(url);
  }

  // Reconcile URLs and removals without reopening explicitly disconnected subscriptions.
  function initWsReceivers() {
    var desired = new Map();
    document.querySelectorAll("[receiver]").forEach(function (el) {
      var url = parseWsUrl(el.getAttribute("receiver"));
      if (url) desired.set(el, url);
    });
    subscriptions.forEach(function (url, el) {
      if (desired.get(el) === url) return;
      var conn = connections[url];
      if (conn) conn.receivers.delete(el);
      subscriptions.delete(el);
    });
    Object.keys(connections).forEach(function (url) {
      var conn = connections[url];
      if (!pruneReceivers(conn) && !conn.manual && Array.from(desired.values()).indexOf(url) === -1) cleanup(url);
    });
    desired.forEach(function (url, el) {
      if (subscriptions.get(el) === url) return;
      if (subscribe(el, url) !== false) subscriptions.set(el, url);
    });
  }

  new MutationObserver(initWsReceivers).observe(document, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["receiver"]
  });

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
        connections[url] = { url: url, ws: null, receivers: new Set(), manual: true, backoff: BASE_DELAY, timer: null, checkTimer: null };
        connections[url].checkTimer = setInterval(function () {
          if (!pruneReceivers(connections[url]) && !connections[url].manual) cleanup(url);
        }, CLEANUP_INTERVAL);
      }
      connections[url].manual = true;
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
