import { methods, talkDOM } from "./index.js";

const WS = /\s+/;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;
const CLEANUP_INTERVAL = 5000;
const MAX_CONNECTIONS = 16;

const connections = Object.create(null);

// Parse receiver attribute to extract ws: URL.
function parseWsUrl(attr) {
  const tokens = attr.trim().split(WS);
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === "ws:" && tokens[i + 1]) return tokens[i + 1];
  }
  return null;
}

// Remove disconnected elements from a connection's receiver set.
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
      el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
    }
  });
}

// Route a parsed JSON message to matching receiver elements.
function routeJson(conn, msg) {
  const name = msg.receiver;
  const op = msg.op || "inner";
  const content = msg.content || "";
  const targets = name
    ? document.querySelectorAll('[receiver~="' + name + '"]')
    : Array.from(conn.receivers);

  const detail = { receiver: name || "", selector: "apply:", args: [content, op] };
  for (let i = 0; i < targets.length; i++) {
    const el = targets[i];
    methods["apply:"](el, content, op);
    el.dispatchEvent(new CustomEvent("talkdom:done", { bubbles: true, detail }));
  }
}

// Handle an incoming WebSocket message.
function onMessage(url, event) {
  const conn = connections[url];
  if (!conn) return;
  pruneReceivers(conn);
  const data = event.data;
  if (typeof data !== "string") return;
  if (data.charAt(0) === "{") {
    try {
      const msg = JSON.parse(data);
      routeJson(conn, msg);
    } catch (e) {
      console.error("talkdom-ws: invalid JSON from " + url, e);
    }
  } else {
    talkDOM.send(data).catch(function (err) {
      console.warn("talkdom-ws:", err);
    });
  }
}

function scheduleReconnect(url) {
  const conn = connections[url];
  if (!conn) return;
  if (!pruneReceivers(conn)) { cleanup(url); return; }
  let delay = Math.min(conn.backoff, MAX_DELAY);
  delay = delay * (0.75 + Math.random() * 0.5);
  conn.timer = setTimeout(function () {
    conn.backoff = Math.min(conn.backoff * 2, MAX_DELAY);
    connectWs(url);
  }, delay);
}

function cleanup(url) {
  const conn = connections[url];
  if (!conn) return;
  if (conn.timer) clearTimeout(conn.timer);
  if (conn.checkTimer) clearInterval(conn.checkTimer);
  if (conn.ws) {
    conn.ws.onclose = null;
    conn.ws.close();
  }
  delete connections[url];
}

function connectWs(url) {
  const conn = connections[url];
  if (!conn) return;
  if (conn.ws && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING)) return;

  const ws = new WebSocket(url);

  ws.onopen = function () {
    conn.backoff = BASE_DELAY;
    fireEvent(conn, "talkdom:ws:open", { url });
  };

  ws.onmessage = function (e) {
    onMessage(url, e);
  };

  ws.onclose = function (e) {
    fireEvent(conn, "talkdom:ws:close", { url, code: e.code, reason: e.reason });
    scheduleReconnect(url);
  };

  ws.onerror = function () {
    fireEvent(conn, "talkdom:ws:error", { url });
  };

  conn.ws = ws;
}

// Subscribe an element to a WebSocket URL.
function subscribe(el, url) {
  let conn = connections[url];
  if (!conn) {
    const count = Object.keys(connections).length;
    if (count >= MAX_CONNECTIONS) {
      console.warn("talkdom-ws: max connections (" + MAX_CONNECTIONS + ") reached, ignoring " + url);
      return;
    }
    conn = { ws: null, receivers: new Set(), backoff: BASE_DELAY, timer: null, checkTimer: null };
    connections[url] = conn;
    conn.checkTimer = setInterval(function () {
      if (!pruneReceivers(conn)) cleanup(url);
    }, CLEANUP_INTERVAL);
  }
  conn.receivers.add(el);
  connectWs(url);
}

// Scan a single element for ws: keyword and subscribe.
function initElement(el) {
  const attr = el.getAttribute("receiver");
  if (!attr) return;
  const url = parseWsUrl(attr);
  if (!url) return;
  subscribe(el, url);
}

// Scan all existing receiver elements.
function initWsReceivers() {
  document.querySelectorAll("[receiver]").forEach(initElement);
}

// Watch for dynamically added ws: receivers.
new MutationObserver(function (mutations) {
  for (let i = 0; i < mutations.length; i++) {
    const added = mutations[i].addedNodes;
    for (let j = 0; j < added.length; j++) {
      const node = added[j];
      if (node.nodeType !== 1) continue;
      if (node.hasAttribute && node.hasAttribute("receiver")) initElement(node);
      if (node.querySelectorAll) {
        node.querySelectorAll("[receiver]").forEach(initElement);
      }
    }
  }
}).observe(document, { childList: true, subtree: true });

// ws:send: method
methods["ws:send:"] = function (el, url) {
  const conn = connections[url];
  if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
    console.error("talkdom-ws: no open connection to " + url);
    return Promise.reject("not connected");
  }
  const payload = ("value" in el) ? el.value : el.textContent;
  conn.ws.send(payload);
};

initWsReceivers();

const ws = {
  connect: function (url) {
    if (!connections[url]) {
      const count = Object.keys(connections).length;
      if (count >= MAX_CONNECTIONS) {
        console.warn("talkdom-ws: max connections (" + MAX_CONNECTIONS + ") reached");
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
    const conn = connections[url];
    if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) return false;
    conn.ws.send(typeof data === "string" ? data : JSON.stringify(data));
    return true;
  },
  get connections() {
    const out = Object.create(null);
    for (const url in connections) {
      out[url] = {
        state: connections[url].ws ? connections[url].ws.readyState : -1,
        receivers: connections[url].receivers.size,
      };
    }
    return out;
  },
  get maxConnections() { return MAX_CONNECTIONS; },
};

export { ws };
