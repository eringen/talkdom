# talkDOM

[talkdom.org](https://talkdom.org)

Smalltalk _inspired_ message passing for the DOM. Declarative HTTP interactions via HTML attributes. No build step, no dependencies. As a big admirer of [htmx](https://htmx.org), it was a major muse when starting this project. ALL HAIL THE HORSEY!

## How it works

Receivers are named DOM elements. Senders dispatch keyword messages to receivers.
which is currently in use @ [eringen.com](https://eringen.com)

```html
<div receiver="content"></div>
<button sender="content get: /partial apply: inner">Load</button>
```

The sender attribute is parsed as a Smalltalk keyword message:

```
content get: /partial apply: inner
^^^^^^^                             receiver name
        ^^^^                        keyword 1
             ^^^^^^^^               arg 1
                      ^^^^^^        keyword 2
                             ^^^^^  arg 2

selector: "get:apply:"
args:     ["/partial", "inner"]
```

## Features

- `get:`, `post:`, `put:`, `delete:` selectors (return response for piping)
- `get:apply:`, `post:apply:`, `put:apply:`, `delete:apply:` shorthand selectors
- `apply:` consumes piped content
- `text:` applies a literal argument as text
- Apply operations: `inner`, `text`, `append`, `outer`
- Pipes (`|`) chain return values between messages
- Independent messages (`;`) fire separately
- An element can be both sender and receiver
- Receivers declare allowed operations via `accepts`
- Polling with `poll:` keyword
- Persistent state via `persist` attribute
- URL persistence via `push-url` attribute
- Server-triggered messages via `X-TalkDOM-Trigger` response header
- Lifecycle events (`talkdom:done`, `talkdom:error`) on receiver elements
- Programmatic API via `talkDOM.send` (returns a promise)
- Extensible methods via `talkDOM.methods`
- Configurable max pollers via `talkDOM.maxPollers`

## Usage

```html
<!-- jsDelivr -->
<script src="https://cdn.jsdelivr.net/npm/talkdom/dist/talkdom.min.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/talkdom/dist/talkdom.min.js"></script>

<!-- local -->
<script src="index.js"></script>
```

## Multiple targets

A sender can address multiple receivers with `;`:

```html
<button sender="content get: /page apply: inner; log get: /page apply: text">Load</button>
```

Multiple elements can share the same receiver name. All matching elements receive the message:

Names are literal strings, not CSS selectors. Additional names before the first keyword act as aliases (`receiver="alert notice"`); method keywords and arguments never become receiver names. Tabs and newlines also separate names. `talkDOM.receivers(name)` returns a fresh array of current matches.

```html
<div receiver="alert" class="top-banner"></div>
<div receiver="alert" class="bottom-banner"></div>
<button sender="alert get: /notice apply: inner">Notify both</button>
```

## Pipes

Combined selectors such as `get:apply:` are method-table names. In messages, interleave keywords and arguments: `content get: /partial apply: inner`. Receiver names are literal names, so `content` addresses `receiver="content"`; a leading `#` is not an ID selector.

`|` chains the return value of one message into the next as the first argument.

```html
<!-- fetch then apply -->
<button sender="content get: /partial | content apply: inner">Load</button>

<!-- pipe to a different receiver -->
<button sender="content get: /partial | sidebar apply: append">Load to sidebar</button>
```

## Accepts

Receivers declare what operations they allow.

```html
<div receiver="content" accepts="inner text"></div>
```

## Polling

Receivers poll by adding `poll:` as the last keyword with an interval (`s` or `ms`) as its argument. The method keywords before `poll:` run on each tick.

```html
<div receiver="feed get: /updates apply: inner poll: 10s"></div>
```

Polling follows inserted, removed, and edited receiver declarations, including outer replacements. Identical declarations share one timer and deliver to the current receiver group. Different commands or intervals remain separate pollers. Pending ticks never overlap within a poller; successes and failures emit the normal lifecycle events, and failures are caught so the next tick can recover. A maximum of 64 concurrent pollers is enforced by default. Adjust via:

```js
talkDOM.maxPollers = 128;
```

## Persist

Receivers with `persist` save their content to `localStorage` after each apply and restore it on page load.

Invalid saved entries are discarded individually. Unavailable storage produces a warning and does not prevent the library or other receivers from initializing.

Persistence is best effort: a quota or storage write failure warns without undoing a successful DOM update, rejecting its promise, or replacing its `talkdom:done` event with an error.

An outer swap saves the replacement markup under the original receiver's key, including multiple roots or a changed receiver name. Keep `receiver` and `persist` on the replacement if later updates should also be saved.

```html
<div receiver="sidebar" persist></div>
```

## Push URL

Senders with `push-url` update the browser URL via `history.pushState`. The message replays on back/forward navigation.

```html
<button sender="content get: /about apply: inner" push-url="/about">About</button>
```

If `push-url` has no value, the first message's first arg is used as the URL.

## Server trigger

The server can trigger client-side messages by setting the `X-TalkDOM-Trigger` response header. The value uses the same message syntax.

```
X-TalkDOM-Trigger: toast text: Saved
```

Multiple triggers separated by `;`:

```
X-TalkDOM-Trigger: toast text: Saved; counter get: /count apply: text
```

Works with pipes, extended methods, and everything else — it dispatches through the same path as sender clicks.

For CORS, expose the header: `Access-Control-Expose-Headers: X-TalkDOM-Trigger`.

## Request headers

Fetches send the following headers. Sensitive headers are limited to same-origin destinations by default; relative URLs are resolved against the document's base URL.

| Header | Value |
|---|---|
| `X-TalkDOM-Request` | `"true"` |
| `X-TalkDOM-Current-URL` | `location.href`, same-origin only by default |
| `X-TalkDOM-Receiver` | receiver name (if element has one) |
| `X-CSRF-Token` | from `<meta name="csrf-token">` (non-GET, same-origin only by default) |

For an existing cross-origin integration that needs these headers, explicitly trust its exact origin (scheme, host, and port). Set startup configuration before loading core, or change `talkDOM.config` afterward:

```html
<script>
  window.talkDOMConfig = {
    trustedOrigins: ["https://api.example.com"],
    includeCurrentURL: true,
    allowServerTriggers: true
  };
</script>
<script src="index.js"></script>
```

There are no wildcard origins. Set `includeCurrentURL: false` to omit the full page URL, including its query and fragment, even for trusted requests. Server-trigger commands remain enabled for readable responses, including cross-origin responses, to preserve existing integrations; treat these servers as trusted command sources or set `allowServerTriggers: false`.

## Self-replacing elements

```html
<button receiver="btn" sender="btn get: /next-step.html apply: outer">Click me</button>
```

## Lifecycle events

Every operation dispatches a `CustomEvent` on the receiver element after completion. Events bubble, so you can listen at any ancestor or `document`.

| Event | When | Detail |
|---|---|---|
| `talkdom:done` | Method completed successfully | `{ receiver, selector, args }` |
| `talkdom:error` | Method rejected (HTTP error, network failure, confirm cancel) | `{ receiver, selector, args, error }` |

```js
// per-element
document.getElementById("content").addEventListener("talkdom:done", function (e) {
  console.log(e.detail.selector, "finished");
});

// global
document.addEventListener("talkdom:error", function (e) {
  alert("Failed: " + e.detail.error);
});
```

For `apply: outer`, the event fires on the replacement element (looked up by receiver name) so it still bubbles.

## Programmatic API

`talkDOM.send` accepts the same message syntax as the `sender` attribute and returns a promise.

When several elements share a receiver name, successful delivery waits for all of them. A pipe receives the last matching element's value, in document order. Any receiver failure rejects the returned promise promptly and stops that pipe; work already started on other receivers continues and still emits its own lifecycle events.

Custom methods may return a value, return a promise, or throw. Thrown errors reject delivery and emit `talkdom:error` just like rejected promises. Synchronous methods still update the DOM immediately when sent directly.

Invalid input also returns a rejected promise. Independent semicolon chains still start if another chain fails. Declarative senders and server triggers catch rejections and log them; programmatic callers should await or catch the returned promise.

```js
// single operation
talkDOM.send("content get: /api/data apply: inner").then(function () {
  console.log("done");
});

// pipes
await talkDOM.send("content get: /api/data | output apply: inner");

// parallel chains
await talkDOM.send("a get: /x apply: inner ; b get: /y apply: inner");

// errors propagate
talkDOM.send("content get: /bad-url apply: inner").catch(function (err) {
  console.error("failed", err);
});
```

## Extending

```js
talkDOM.methods["toggle:"] = function (el, cls) {
  el.classList.toggle(cls);
};
```

```js
talkDOM.methods["show:"] = function (el, message) {
  el.textContent = message;
  el.style.display = "block";
};
```

## WebSocket plugin

The optional `websocket.js` plugin adds server-push via WebSocket as an alternative to polling. Load it after the core library:

```html
<script src="https://cdn.jsdelivr.net/npm/talkdom/dist/talkdom.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/talkdom/dist/talkdom-ws.min.js"></script>
```

### Receiving

Add `ws:` as the last keyword on a receiver with a WebSocket URL as its argument. The server pushes content — no client-side method keywords needed.

```html
<div receiver="feed ws: ws://localhost:3000/updates"></div>
```

The server sends JSON messages to control what gets applied:

```json
{"receiver": "feed", "content": "<p>New post</p>", "op": "append"}
```

| Field | Required | Description |
|---|---|---|
| `receiver` | no | Target receiver name |
| `content` | no | HTML or text content |
| `op` | no | `inner` (default), `text`, `append`, `outer` |

Omitting `receiver` broadcasts to all receivers on that connection.

The server can also send raw talkDOM message syntax instead of JSON:

```
feed text: Updated!
```

This dispatches through the same path as sender clicks and server triggers.

### Sending

The socket must be open before sending. The `ws:` receiver declaration below establishes it; enable the Send button after `talkdom:ws:open` in a production form.

The plugin registers a `ws:send:` method. The receiver element's value (for inputs/textareas/selects) or text content is sent over the WebSocket connection.

```html
<input receiver="chatbox ws: ws://localhost:3000/chat" type="text">
<button sender="chatbox ws:send: ws://localhost:3000/chat">Send</button>
```

### Shared connections

Multiple receivers pointing to the same URL share a single WebSocket connection. The server routes messages by the `receiver` field in JSON.

```html
<div receiver="messages ws: ws://localhost:3000/live"></div>
<div receiver="presence ws: ws://localhost:3000/live"></div>
```

### Reconnection

Connections automatically reconnect with exponential backoff (1s initial, 30s max, ±25% jitter). Backoff resets on successful connection. Reconnection stops when all receivers for a URL are removed from the DOM.

### Lifecycle events

| Event | Detail |
|---|---|
| `talkdom:ws:open` | `{ url }` |
| `talkdom:ws:close` | `{ url, code, reason }` |
| `talkdom:ws:error` | `{ url }` |

Events fire on all receiver elements subscribed to the URL and bubble.

```js
document.addEventListener("talkdom:ws:open", function (e) {
  console.log("connected to", e.detail.url);
});
```

Incoming messages also fire the standard `talkdom:done` event on the target receiver after applying content.

### Programmatic API

```js
talkDOM.ws.connect("ws://localhost:3000/live");
talkDOM.ws.send("ws://localhost:3000/live", { action: "subscribe", channel: "news" });
talkDOM.ws.send("ws://localhost:3000/live", "plain string");
talkDOM.ws.disconnect("ws://localhost:3000/live");

talkDOM.ws.connections;      // { "ws://...": { state: 1, receivers: 2 } }
talkDOM.ws.maxConnections;   // default 16
talkDOM.ws.maxConnections = 32;
```

`talkDOM.ws.send` returns `true` if sent, `false` if the connection is not open.

`connect()` keeps a connection open even without DOM receivers. Calling it on a shared declarative connection also gives it manual ownership, so removing the final DOM receiver will not close it. Repeated calls are idempotent. `disconnect()` explicitly closes the whole connection, including any shared subscribers, preserving its existing behavior.

Manual connections use the same reconnect backoff as declarative ones. Explicit disconnect cancels pending retries; callbacks from an old socket cannot reconnect or deliver messages to a replacement connection.

## Security

talkDOM does **not** sanitize HTML. Content from `get:apply:`, `post:apply:`, server triggers, and piped `apply:` is inserted via `innerHTML` / `insertAdjacentHTML` / `outerHTML` as-is. You are responsible for ensuring that server responses do not contain untrusted markup.

The `persist` attribute stores receiver content in `localStorage` in plain text. Do not use it for sensitive data.

CSRF tokens are read from `<meta name="csrf-token">` and sent automatically on non-GET requests. Make sure this tag is present if your server requires CSRF protection.

## Browser compatibility

talkDOM works in all modern browsers. No polyfills needed.

| Browser | Minimum version |
|---------|-----------------|
| Chrome  | 51+             |
| Firefox | 49+             |
| Safari  | 10+             |
| Edge    | 79+ (Chromium)  |

IE is not supported.

## Performance

Receiver lookups are cached and invalidated automatically via `MutationObserver`. Repeated dispatches to the same receiver name within a stable DOM hit the cache.

Pending mutations are checked before lookup, so a synchronous insertion, replacement, or receiver rename is visible to the very next send without waiting for an observer callback.

Polling is capped at 64 concurrent pollers by default (configurable via `talkDOM.maxPollers`). Pollers clean up when their last matching declaration disappears. Methods and group members are looked up on each tick. The limit accepts nonnegative integers; increasing it starts waiting declarations.

The CSRF meta tag element is cached after the first lookup and only re-queried if removed from the DOM.

Whitespace regex patterns are precompiled and shared across the library. Internal helpers share receiver parsing and lifecycle delivery.

For most pages, talkDOM adds negligible overhead. After relevant DOM mutations, the next lookup rebuilds the name index with one receiver scan; later lookups share that index.

## License

MIT. See [LICENSE](LICENSE).

### Plugin delivery

`talkDOM.deliver(element, selector, args)` runs a method on one element and returns a promise with the same lifecycle handling as `send()`. After an outer swap, events target the first inserted element; text-only or empty replacements use the original parent (or document if detached). `event.detail.originalReceiver` identifies the original element.
