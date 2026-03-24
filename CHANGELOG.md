# Changelog

All notable changes to talkDOM are documented in this file.

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
