const WS = /\s+/;
const STORAGE_PREFIX = "talkDOM:";

// Parse "receiver keyword: arg keyword: arg" into structured message object.
// Tokens ending with ":" are keywords, everything else fills args.
function parseMessage(str) {
  const trimmed = str.trim();
  const tokens = trimmed.split(WS);
  const receiver = tokens[0];
  const body = trimmed.substring(receiver.length).trim();
  const rest = tokens.slice(1);
  const keywords = [];
  const args = [];
  let currentArg = [];

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
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

  return { receiver, selector: keywords.join(""), keywords, args, body };
}

// Extract the first word from the receiver attribute (the name).
function receiverName(el) {
  const attr = el.getAttribute("receiver").trim();
  const sp = attr.indexOf(" ");
  return sp === -1 ? attr : attr.substring(0, sp);
}

// Receiver cache: maps name -> NodeList, invalidated by DOM mutations.
const receiverCache = Object.create(null);
let cacheValid = false;

new MutationObserver(() => { cacheValid = false; })
  .observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["receiver"] });

// Find all elements whose receiver attribute contains the given name.
function findReceivers(name) {
  if (!cacheValid) {
    Object.keys(receiverCache).forEach(key => delete receiverCache[key]);
    cacheValid = true;
  }
  if (receiverCache[name]) return receiverCache[name];
  const result = document.querySelectorAll('[receiver~="' + name + '"]');
  receiverCache[name] = result;
  return result;
}

// Check if a receiver allows a given apply operation (inner, text, append, outer).
// No "accepts" attribute means everything is allowed.
function accepts(el, op) {
  const attr = el.getAttribute("accepts");
  if (!attr) return true;
  return (" " + attr + " ").includes(" " + op + " ");
}

// Save receiver content to localStorage after apply, keyed by receiver name.
function persist(el, op) {
  if (!el.hasAttribute("receiver") || !el.hasAttribute("persist")) return;
  const name = receiverName(el);
  const key = STORAGE_PREFIX + name;
  const content = op === "outer" ? el.outerHTML : el.innerHTML;
  localStorage.setItem(key, JSON.stringify({ op, content }));
}

// On page load, restore persisted receiver content from localStorage.
function restore() {
  document.querySelectorAll("[persist]").forEach((el) => {
    if (!el.hasAttribute("receiver")) return;
    const name = receiverName(el);
    const raw = localStorage.getItem(STORAGE_PREFIX + name);
    if (!raw) return;
    let state;
    try { state = JSON.parse(raw); } catch {
      localStorage.removeItem(STORAGE_PREFIX + name);
      return;
    }
    if (state.op === "outer") {
      el.outerHTML = state.content;
    } else {
      el.innerHTML = state.content;
    }
  });
}

// Apply content to an element using the specified operation (inner, text, append, outer).
function apply(el, op, content) {
  if (!accepts(el, op)) {
    console.error(receiverName(el) + " does not accept " + op);
    return;
  }
  switch (op) {
    case "inner": el.innerHTML = content; break;
    case "text": el.textContent = content; break;
    case "append": el.insertAdjacentHTML("beforeend", content); break;
    case "outer": el.outerHTML = content; break;
  }
  persist(el, op);
  return content;
}

let csrfMeta = null;

function csrfToken() {
  if (!csrfMeta || !csrfMeta.isConnected) {
    csrfMeta = document.querySelector('meta[name="csrf-token"]');
  }
  return csrfMeta ? csrfMeta.getAttribute("content") : "";
}

// Perform a fetch with talkDOM headers. Returns a promise resolving to response text.
// Fires server-triggered messages from X-TalkDOM-Trigger header if present.
function request(method, url, receiver, body) {
  const headers = {
    "X-TalkDOM-Request": "true",
    "X-TalkDOM-Current-URL": location.href,
  };
  if (receiver) {
    headers["X-TalkDOM-Receiver"] = receiver;
  }
  if (method !== "GET") {
    const token = csrfToken();
    if (token) headers["X-CSRF-Token"] = token;
    else console.warn("talkDOM: no CSRF token found for " + method + " " + url);
  }
  return fetch(url, { method, headers, body }).then((r) => {
    if (!r.ok) {
      console.error("talkDOM: " + method + " " + url + " " + r.status);
      return Promise.reject(r.status);
    }
    const trigger = r.headers.get("X-TalkDOM-Trigger");
    return r.text().then((text) => {
      if (trigger) dispatchRaw(trigger);
      return text;
    });
  });
}

function serializeForm(form) {
  return new URLSearchParams(new FormData(form)).toString();
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
  "get:apply:": function (el, url, op) { return request("GET", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
  "post:apply:": function (el, url, op) { return request("POST", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
  "put:apply:": function (el, url, op) { return request("PUT", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
  "delete:apply:": function (el, url, op) { return request("DELETE", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
  "post-form:apply:form:": function (el, url, op, formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) { console.error("post-form: form not found: " + formSelector); return; }
    const body = serializeForm(form);
    return request("POST", url, recName(el), body).then(function (t) { return apply(el, op, t); });
  },
  "put-form:apply:form:": function (el, url, op, formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) { console.error("put-form: form not found: " + formSelector); return; }
    const body = serializeForm(form);
    return request("PUT", url, recName(el), body).then(function (t) { return apply(el, op, t); });
  },
  "delete-form:apply:form:": function (el, url, op, formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) { console.error("delete-form: form not found: " + formSelector); return; }
    const body = serializeForm(form);
    return request("DELETE", url, recName(el), body).then(function (t) { return apply(el, op, t); });
  },
  "post-json:apply:json:": function (el, url, op, jsonStr) {
    let data;
    try { data = JSON.parse(jsonStr); } catch { data = {}; }
    return request("POST", url, recName(el), JSON.stringify(data)).then(function (t) { return apply(el, op, t); });
  },
  "put-json:apply:json:": function (el, url, op, jsonStr) {
    let data;
    try { data = JSON.parse(jsonStr); } catch { data = {}; }
    return request("PUT", url, recName(el), JSON.stringify(data)).then(function (t) { return apply(el, op, t); });
  },
};

let pushing = false;

// Push URL to browser history. Uses push-url attr value, or falls back to first message arg.
function pushUrl(senderEl, raw) {
  if (!senderEl.hasAttribute("push-url")) return;
  let url = senderEl.getAttribute("push-url");
  if (!url) {
    const msg = parseMessage(raw.split(";")[0].split("|")[0].trim());
    if (msg.args.length > 0) {
      url = msg.args[0].split(/\s/)[0] || "";
    }
  }
  if (url && (location.pathname + location.search) !== url) {
    history.pushState({ sender: raw }, "", url);
  }
}

// Re-dispatch a sender message from history state (back/forward navigation).
function replayState(state) {
  if (!state || !state.sender) return;
  pushing = true;
  dispatchRaw(state.sender);
  pushing = false;
}

window.addEventListener("popstate", function (e) {
  replayState(e.state);
});

// After an outer swap `el` is gone. Walk from the snapshotted sibling or
// parent to find the element that took its place; fall back to a fresh
// receiver query if the DOM was restructured.
function resolveTarget(el, next, parent, name) {
  if (el.isConnected) return el;
  const candidate = next && next.isConnected ? next.previousElementSibling
    : parent && parent.isConnected ? parent.lastElementChild : null;
  return candidate || findReceivers(name)[0];
}

// Deliver a parsed message to all matching receivers. Fires talkdom:done or talkdom:error
// lifecycle events on the receiver element (or its replacement if outer-swapped).
function send(msg, piped) {
  const els = findReceivers(msg.receiver);
  if (els.length === 0) {
    console.error(msg.receiver + " not found");
    return;
  }
  let loadingClass = null;
  let keywords = msg.keywords;
  let args = msg.args;
  const loadingIdx = keywords.indexOf("loading:");
  if (loadingIdx !== -1) {
    loadingClass = args[loadingIdx];
    keywords = keywords.filter(function (_, i) { return i !== loadingIdx; });
    args = args.filter(function (_, i) { return i !== loadingIdx; });
  }
  const selector = keywords.join("");
  const method = methods[selector];
  if (!method) {
    console.error(msg.receiver + " does not understand " + selector);
    return;
  }
  const finalArgs = piped !== undefined ? [piped].concat(args) : args;
  let result;
  els.forEach(function (el) {
    const detail = { receiver: msg.receiver, selector: selector, args: msg.args };
    const parent = el.parentNode;
    const next = el.nextElementSibling;
    if (loadingClass) el.classList.add(loadingClass);
    result = method(el, ...finalArgs);
    if (result && typeof result.then === "function") {
      result.then(function () {
        if (loadingClass) el.classList.remove(loadingClass);
        const target = resolveTarget(el, next, parent, msg.receiver);
        if (target) target.dispatchEvent(new CustomEvent("talkdom:done", { bubbles: true, detail }));
      }, function (err) {
        if (loadingClass) el.classList.remove(loadingClass);
        detail.error = err;
        const target = resolveTarget(el, next, parent, msg.receiver);
        if (target) target.dispatchEvent(new CustomEvent("talkdom:error", { bubbles: true, detail }));
      });
    } else {
      if (loadingClass) el.classList.remove(loadingClass);
      const target = resolveTarget(el, next, parent, msg.receiver);
      if (target) target.dispatchEvent(new CustomEvent("talkdom:done", { bubbles: true, detail }));
    }
  });
  return result;
}

// Programmatic API: parse and execute a raw message string (supports pipes and semicolons).
// Returns a promise that resolves when all chains complete.
function run(raw) {
  const trimmed = raw.trim();
  if (trimmed.indexOf(";") === -1 && trimmed.indexOf("|") === -1) {
    return Promise.resolve(send(parseMessage(trimmed))).then(function (r) { return [r]; });
  }
  const chains = trimmed.split(";").map(function (chain) {
    const step = chain.trim();
    if (!step) return Promise.resolve();
    const steps = step.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
    if (steps.length === 1) {
      return Promise.resolve(send(parseMessage(steps[0])));
    }
    return steps.reduce(function (prev, step) {
      const msg = parseMessage(step);
      return Promise.resolve(prev).then(function (piped) {
        return send(msg, piped);
      });
    }, undefined);
  });
  return Promise.all(chains);
}

// Fire-and-forget dispatch used by declarative senders and server triggers.
function dispatchRaw(raw) {
  run(raw).catch(function (err) { console.warn("talkDOM:", err); });
}

// Entry point for a sender click: dispatch its message and optionally push URL.
function dispatch(senderEl) {
  const raw = senderEl.getAttribute("sender");
  dispatchRaw(raw);
  if (!pushing) pushUrl(senderEl, raw);
}

function parseInterval(str) {
  const match = str.match(/^(\d+)(s|ms)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return match[2] === "s" ? n * 1000 : n;
}

// Set up a repeating interval for receivers with a poll: keyword.
let activePollers = 0;
let maxPollers = 64;

function startPolling(el) {
  const attr = el.getAttribute("receiver");
  const msg = parseMessage(attr);
  if (msg.keywords[msg.keywords.length - 1] !== "poll:") return;
  if (activePollers >= maxPollers) {
    console.warn("talkDOM: max pollers (" + maxPollers + ") reached, ignoring " + msg.receiver);
    return;
  }
  const interval = parseInterval(msg.args[msg.args.length - 1]);
  if (!interval) {
    console.error("poll: invalid interval for " + msg.receiver);
    return;
  }
  const selector = msg.keywords.slice(0, -1).join("");
  const args = msg.args.slice(0, -1);
  const name = msg.receiver;
  let cachedTargets = findReceivers(name);
  let method = methods[selector];
  activePollers++;
  const id = setInterval(function () {
    if (!el.isConnected) { clearInterval(id); activePollers--; return; }
    if (cachedTargets.length === 0 || !cachedTargets[0].isConnected) {
      cachedTargets = findReceivers(name);
    }
    if (cachedTargets.length === 0) return;
    if (!method) method = methods[selector];
    if (!method) {
      console.error(name + " does not understand " + selector);
      return;
    }
    cachedTargets.forEach(function (target) { method(target, ...args); });
  }, interval);
}

// Global click handler: delegate to any element with a sender attribute.
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

new MutationObserver(function (mutations) {
  for (let i = 0; i < mutations.length; i++) {
    const added = mutations[i].addedNodes;
    for (let j = 0; j < added.length; j++) {
      const node = added[j];
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.hasAttribute && node.hasAttribute("receiver")) {
          startPolling(node);
        }
        const children = node.querySelectorAll ? node.querySelectorAll("[receiver]") : [];
        for (let k = 0; k < children.length; k++) {
          startPolling(children[k]);
        }
      }
    }
  };
}).observe(document, { childList: true, subtree: true });

const talkDOM = {
  methods,
  send: run,
  get maxPollers() { return maxPollers; },
  set maxPollers(n) { maxPollers = n; },
};

window.talkDOM = talkDOM;

export { parseMessage, receiverName, findReceivers, accepts, persist, restore, apply, request, methods, run, dispatchRaw, talkDOM };
