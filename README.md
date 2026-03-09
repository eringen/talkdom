# talkDOM

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

## Usage

Include the script:

```html
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

Polling stops automatically when the element is removed from the DOM.

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

## License

MIT. See [LICENSE](LICENSE).
