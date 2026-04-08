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
- `post-form:`, `put-form:`, `delete-form:` with form serialization
- `post-json:`, `put-json:` with JSON body
- `loading:` class toggle during async operations
- Dynamic polling via `MutationObserver` for late-added elements

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

```html
<div receiver="alert" class="top-banner"></div>
<div receiver="alert" class="bottom-banner"></div>
<button sender="alert get: /notice apply: inner">Notify both</button>
```

## Pipes

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
<div receiver="feed get:apply: /updates inner poll: 10s"></div>
```

Polling stops automatically when the element is removed from the DOM. Elements added dynamically (e.g., via fragment injection or Alpine `x-if`) are picked up automatically by a `MutationObserver` — no manual setup needed.

A maximum of 64 concurrent pollers is enforced by default. Adjust via:

```js
talkDOM.maxPollers = 128;
```

## Persist

Receivers with `persist` save their content to `localStorage` after each apply and restore it on page load.

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
X-TalkDOM-Trigger: toast apply: Saved inner
```

Multiple triggers separated by `;`:

```
X-TalkDOM-Trigger: toast apply: Saved inner; counter get: /count apply: text
```

Works with pipes, extended methods, and everything else — it dispatches through the same path as sender clicks.

For CORS, expose the header: `Access-Control-Expose-Headers: X-TalkDOM-Trigger`.

## Request headers

Every fetch sends:

| Header | Value |
|---|---|
| `X-TalkDOM-Request` | `"true"` |
| `X-TalkDOM-Current-URL` | `location.href` |
| `X-TalkDOM-Receiver` | receiver name (if element has one) |
| `X-CSRF-Token` | from `<meta name="csrf-token">` (non-GET only) |

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

```js
// single operation
talkDOM.send("#content get:apply: /api/data inner").then(function () {
  console.log("done");
});

// pipes
await talkDOM.send("#content get: /api/data | #output apply: inner");

// parallel chains
await talkDOM.send("#a get:apply: /x inner ; #b get:apply: /y inner");

// errors propagate
talkDOM.send("#content get:apply: /bad-url inner").catch(function (err) {
  console.error("failed", err);
});
```

## Form body

`post-form:`, `put-form:`, and `delete-form:` serialize a form's inputs as `application/x-www-form-urlencoded` and send them with the request. The `form:` keyword specifies the CSS selector for the form element.

```html
<form id="my-form">
  <input name="name" value="test">
  <input name="email" value="user@example.com">
</form>
<div receiver="result"></div>
<button sender="result post-form: /api/submit apply: inner form: #my-form">Submit</button>
```

## JSON body

`post-json:` and `put-json:` send a JSON payload with the request. The `json:` keyword specifies the JSON string (parsed at runtime).

```html
<div receiver="result"></div>
<button sender="result post-json: /api/data apply: inner json: {&quot;name&quot;:&quot;test&quot;}">Send</button>
```

## Loading state

The `loading:` keyword toggles a CSS class on the receiver while an async operation is in progress. The class is removed on both success and error.

```html
<style>
.is-loading { opacity: 0.5; pointer-events: none; }
</style>
<div receiver="content"></div>
<button sender="content get: /api/data apply: inner loading: is-loading">Load</button>
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
| `receiver` | yes | Target receiver name |
| `content` | no | HTML or text content |
| `op` | no | `inner` (default), `text`, `append`, `outer` |

Omitting `receiver` broadcasts to all receivers on that connection.

The server can also send raw talkDOM message syntax instead of JSON:

```
feed apply: Updated! text
```

This dispatches through the same path as sender clicks and server triggers.

### Sending

The plugin registers a `ws:send:` method. The receiver element's value (for inputs/textareas/selects) or text content is sent over the WebSocket connection.

```html
<input receiver="chatbox" type="text">
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

Polling is capped at 64 concurrent pollers by default (configurable via `talkDOM.maxPollers`). Pollers clean up automatically when their element is removed from the DOM. Method lookups are cached at poll setup time.

The CSRF meta tag element is cached after the first lookup and only re-queried if removed from the DOM.

Whitespace regex patterns are precompiled and shared across the library. Internal helpers like `receiverName` and `resolveTarget` avoid unnecessary allocations.

For most pages, talkDOM adds negligible overhead. On pages with thousands of receivers, keep in mind that `querySelectorAll` runs once per unique receiver name per DOM mutation cycle.

## License

MIT. See [LICENSE](LICENSE).
