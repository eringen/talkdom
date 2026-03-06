# talkDOM (WIP)

Smalltalk _inspired_ message passing for the DOM. Declarative HTTP interactions via HTML attributes. No build step, no dependencies, 60 lines.

## How it works

Receivers are named DOM elements. Senders dispatch keyword messages to receivers.

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
- Polling with `poll` attribute
- Extensible methods via `talkDOM.methods`

## Usage

Include the script:

```html
<script src="index.js"></script>
```

## Multiple targets

```html
<button sender="content get: /page apply: inner; log get: /page apply: text">Load</button>
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

Receivers can poll on an interval.

```html
<div receiver="feed" poll="feed get: /updates apply: inner every: 10s"></div>
```

## Self-replacing elements

```html
<button receiver="btn" sender="btn get: /next-step.html apply: outer">Click me</button>
```

## Extending

```js
talkDOM.methods["toggle:"] = function (el, cls) {
  el.classList.toggle(cls);
};
```
