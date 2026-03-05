# jstalk (WIP)

Smalltalk-inspired message passing for the DOM. Declarative HTTP interactions via HTML attributes. No build step, no dependencies, 60 lines.

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

- `get:apply:`, `post:apply:`, `put:apply:`, `delete:apply:` selectors
- Apply operations: `inner`, `text`, `append`, `outer`
- Multiple messages per sender, separated by `;`
- An element can be both sender and receiver
- Extensible methods via `jstalk.methods`
- LSP with diagnostics, completions, and hover (VS Code + Neovim)

## Usage

Include the script:

```html
<script src="index.js"></script>
```

## Multiple targets

```html
<button sender="content get: /page apply: inner; log get: /page apply: text">Load</button>
```

## Self-replacing elements

```html
<button receiver="btn" sender="btn get: /next-step.html apply: outer">Click me</button>
```

## Extending

```js
jstalk.methods["toggle:"] = function (el, cls) {
  el.classList.toggle(cls);
};
```
