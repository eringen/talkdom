# Changelog

All notable changes to talkDOM are documented in this file.

## Unreleased

### Added
- A `text:` message for literal text updates without a pipe.
- Explicit trusted origins and controls for current-page headers and server commands.

### Fixed
- Validate apply operations, tokenize accepts consistently, and offer strict rejection without changing legacy promise behavior.
- Push history only after successful navigation and restore snapshots without replaying mutations.
- Scope WebSocket JSON updates to current subscribers and reconcile edited subscriptions.
- Validate socket URLs and JSON envelopes; preserve zero/false content and report apply failures.
- Reconcile dynamic polling groups, avoid overlapping ticks, and report poll lifecycle events.
- Restore and discover receivers when a head-loaded script reaches DOM ready.
- Track actual outer replacements for lifecycle events and share delivery with plugins.
- Look up literal receiver names safely while preserving aliases before keywords.
- Refresh cached receivers before same-turn sends after DOM changes.
- Persist replacement markup after outer swaps instead of the detached original.
- Correct HTTP, polling, raw-message, and WebSocket setup examples.
- Reconnect manually owned sockets and cancel stale retries on disconnect.
- Keep manually opened WebSockets alive when no DOM receivers remain.
- Limit automatic CSRF tokens and current-page headers to same-origin destinations.
- Keep successful DOM updates working when persistence writes fail.
- Recover from unavailable storage and invalid saved state during startup.
- Return promise rejections for invalid input and isolate command startup failures.
- Handle thrown custom-method errors without skipping other receivers or independent chains.
- Wait for all matching receivers before continuing a pipe and propagate failures from every receiver.

## [0.4.0] - 2026-04-01

### Added
- WebSocket plugin (`websocket.js`) as an optional add-on for server-push via WebSocket
- `ws:` terminal keyword on receivers to declare a WebSocket connection (`receiver="feed ws: ws://host/path"`)
- Server-driven content updates via JSON messages (`{"receiver", "content", "op"}`)
- Raw talkDOM message syntax support over WebSocket (same dispatch path as server triggers)
- `ws:send:` method for sending element value/content over an existing WebSocket connection
- Shared connections per URL — multiple receivers on the same URL share one WebSocket
- Automatic reconnection with exponential backoff (1s–30s), jitter, and DOM-aware cleanup
- Lifecycle events: `talkdom:ws:open`, `talkdom:ws:close`, `talkdom:ws:error`
- Programmatic API: `talkDOM.ws.connect()`, `talkDOM.ws.disconnect()`, `talkDOM.ws.send()`
- Configurable `talkDOM.ws.maxConnections` (default 16)
- `MutationObserver` for dynamically added `ws:` receivers
- Minified build: `dist/talkdom-ws.min.js`

## [0.3.1] - 2026-03-25

### Changed
- CSRF meta tag element is now cached; DOM query only runs on first lookup or if the element is removed
- `pushUrl` extracts the fallback URL via string ops instead of a redundant `parseMessage` call
- `receiverName` uses `indexOf`/`substring` instead of regex split to avoid array allocation
- Whitespace regex precompiled as a shared `WS` constant across `parseMessage` and `accepts`
- `resolveTarget` hoisted out of `send()` forEach loop to eliminate per-receiver closure allocation
- Polling method lookup cached at setup time; re-queried only if initially missing
- `accepts()` uses string boundary matching instead of array split + indexOf
- `run()` fast-paths single messages without pipes or semicolons to skip intermediate allocations
- `receiverCache` uses `Object.create(null)` to avoid prototype chain lookups

## [0.1.5] - 2026-03-24

### Added
- Receiver cache using `MutationObserver` for faster lookups on repeated dispatches
- Poller limit (`maxPollers`, default 64) to prevent unbounded intervals
- Configurable `talkDOM.maxPollers` getter/setter
- 11 new tests: parsing edge cases, polling cleanup, concurrent operations (58 -> 69 total)
- Inline comments for complex logic in `send()` and `run()`

### Fixed
- ESLint warning for unused catch parameter in `restore()`

## [0.1.3] - 2026-03-22

### Fixed
- CSRF token warning now returns early from compound methods
- `dispatchRaw` logs errors instead of silently swallowing rejections

### Changed
- `apply:` now returns content, enabling piped shorthand methods

## [0.1.2] - 2026-03-21

### Changed
- Build tooling updates (terser, eslint, jsdom)
- Test runner improvements

## [0.1.1] - 2026-03-20

### Added
- Project website at talkdom.org

## [0.1.0] - 2026-03-19

### Added
- Smalltalk-inspired keyword message syntax (`receiver keyword: arg`)
- HTTP methods: `get:`, `post:`, `put:`, `delete:`
- Shorthand selectors: `get:apply:`, `post:apply:`, `put:apply:`, `delete:apply:`
- Apply operations: `inner`, `text`, `append`, `outer`
- Pipe chains (`|`) threading return values between messages
- Independent chains (`;`) running in parallel
- `accepts` attribute for receiver access control
- Polling via `poll:` keyword with auto-cleanup on element removal
- Persistent state via `persist` attribute and localStorage
- URL persistence via `push-url` attribute with history replay
- Server-triggered messages via `X-TalkDOM-Trigger` response header
- CSRF token handling from `<meta name="csrf-token">`
- Request headers: `X-TalkDOM-Request`, `X-TalkDOM-Current-URL`, `X-TalkDOM-Receiver`
- Lifecycle events: `talkdom:done`, `talkdom:error`
- `confirm:` method with pipe rejection on cancel
- Programmatic API: `talkDOM.send()` returning promises
- Extensible methods via `talkDOM.methods`
- Delegated click handling for sender elements
- Browser test suite (58 tests)
- Minified build via terser with source maps
