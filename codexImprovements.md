# talkDOM bug fixes and improvements

Reviewed on 2026-09-12 against commit `8159b86` (package version `0.4.0`).

## Scope and verification

Reviewed both runtime files (`index.js`, `websocket.js`), the complete test suite and runner, package/build/lint configuration, lockfile dependency requirements, README, changelog, all HTML examples, and the existing `improvements.md`. Inspected the local ignored `dist/` directory because it is included in published packages. This report is the only project change made during the review.

Verification results:

| Check | Result |
| --- | --- |
| Default environment: Node `16.20.2` | Tests fail loading an ESM dependency of jsdom; lint fails because `structuredClone` is unavailable. |
| Installed Node `24.15.0`: existing test runner | **69 assertions passed, 0 failed.** This is an assertion count, not 69 independently meaningful test cases. |
| ESLint explicitly run on both runtime files under Node 24 | Passed. The normal lint script only checks core. |
| Targeted checks using fresh jsdom environments, controlled timers, mocked fetch, and a fake WebSocket | **23 failure scenarios reproduced**, grouped into findings below. |
| Build in a temporary project copy using installed dependencies | Passed. Original local build artifacts were preserved. |
| Existing tests against the freshly minified core bundle | **69 assertions passed, 0 failed.** |
| Package dry run after building that temporary copy | Confirmed that old ESM artifacts survive the build and enter the package. Nothing was published. |

The additional reproduction harness was run from a temporary file; it is not a committed test suite. Each finding includes reproduction guidance and proposed regression coverage. No dependency vulnerability audit, live server test, or real-browser compatibility matrix was run. Browser networking, actual reconnect timing, and Back/Forward integration need follow-up browser tests; the corresponding local checks exercised the library's handlers and request options directly.

**Priority:** P1 = fix before the next release because of security exposure, initialization failure, or broken completion/connection guarantees. P2 = correctness, documentation, and release-quality fixes. P3 = optional improvements after correctness work.

## P1: fix before the next release

### 1. Wait for every matching receiver and propagate every failure

**Location:** `index.js:219–254`, especially the reassignment of `result` inside `els.forEach`.

`send()` starts a method for every matching element but returns only the last element's result. With two receivers sharing a name, the last can finish while the first is still pending. `await talkDOM.send(...)` then reports completion too early, and a rejection from the first receiver never reaches the caller. Pipes can advance while earlier receivers are still working.

**Reproduced:** The first receiver returned a deferred promise, the second returned a resolved promise, and `send()` resolved with the second result before the first was rejected.

**Fix:** Collect all receiver results and await their completion. Specify how multiple return values feed a pipe; for backward compatibility, one option is to wait for all receivers but continue piping the last result. Emit each receiver's lifecycle event independently and reject the public promise when a receiver fails.

**Regression coverage:** Two receivers with opposite completion orders; a rejection from the first receiver; a downstream pipe that must not start early. Define whether rejection waits for other already-started work to settle.

### 2. Convert synchronous failures into the promised error contract

**Location:** `index.js:239`, `index.js:259–290`.

`Promise.resolve(send(...))` evaluates `send()` before creating a promise. A throwing extension, invalid receiver selector, or storage exception can escape synchronously. The receiver gets no `talkdom:error`. In the semicolon path, a throw also aborts `.map()` before later independent chains start. `dispatchRaw()` cannot catch an exception thrown before `.catch()` is attached.

**Reproduced:** Register a `boom:` method that throws and an `other:` method that records execution. `talkDOM.send('a boom: ; a other:')` throws immediately, emits no error event, and never runs `other:`.

**Fix:** Catch synchronous method and parsing failures, return rejected promises consistently, and isolate the startup of independent chains. Preserve synchronous DOM updates if that behavior is part of the API rather than changing timing accidentally.

**Regression coverage:** Direct calls, declarative clicks, raw server messages, malformed receiver names, throwing custom methods, and independent chains.

### 3. Make persistence failures recoverable during initialization

**Location:** `index.js:69–95`, `index.js:355–364`.

Storage access itself is outside the `try` block. A denied `localStorage` read aborts initialization before `window.talkDOM` is exposed and before polling starts. The JSON parser also accepts invalid state shapes: a stored JSON `null` crashes at `state.op`. Write failures can interrupt an otherwise completed DOM update and its lifecycle handling.

**Reproduced:** Seed `talkDOM:a` with the string `null` before evaluating core with a persistent `a` receiver; initialization throws. A throwing `localStorage` getter also aborts initialization.

**Fix:** Guard storage reads, writes, and removals. Validate that restored state is a non-null object with a supported operation and string content. Handle a bad entry independently so other receivers and the public API still initialize. Choose and document whether persistence failures emit a separate warning/event or reject an operation whose DOM update already succeeded.

**Regression coverage:** Invalid JSON, `null`, wrong shapes, unavailable storage, quota failures, and one corrupt entry followed by a valid entry. Seed storage before library initialization.

### 4. Restrict automatic sensitive request headers by origin

**Location:** `index.js:126–139`.

Every request receives the full current page URL, and every non-GET request receives the page's CSRF token, regardless of destination origin. A cross-origin destination that permits the CORS request can receive these values. This exposes application-specific credentials and potentially sensitive query/hash data beyond the page's own origin.

**Reproduced:** A mocked POST to `https://other.test/action` included the originating page's `X-CSRF-Token` and `X-TalkDOM-Current-URL`. This confirms header construction; a real cross-origin transfer additionally depends on browser CORS behavior and the destination server.

**Fix:** Resolve destinations against the document base URL, compare their origin with the page origin, and default sensitive headers to same-origin requests. Allow explicit configuration for trusted cross-origin services. Consider excluding URL fragments and making full URL disclosure configurable. Document whether cross-origin responses may execute `X-TalkDOM-Trigger` commands.

**Regression coverage:** Relative and same-origin absolute URLs, different origins, protocol-relative URLs, changed document base URLs, and explicitly trusted origins.

### 5. Keep explicitly opened WebSocket connections alive

**Location:** `websocket.js:86–95`, `websocket.js:201–214`.

`talkDOM.ws.connect(url)` creates a connection with an empty receiver set. Its five-second cleanup timer closes it because no DOM receiver exists. An unexpected close also skips reconnection for the same reason. The documented programmatic connection API therefore cannot maintain a connection on its own.

**Reproduced:** Call `talkDOM.ws.connect(url)` without a declarative receiver and run its first cleanup callback. The socket closes and disappears from `talkDOM.ws.connections`.

**Fix:** Track explicit connection ownership separately from DOM subscriptions. Keep manually opened connections alive and eligible for reconnect until `disconnect()` releases them. Define behavior when both manual ownership and DOM subscribers exist.

**Regression coverage:** A manual connection with no elements, automatic reconnect, mixed ownership, removal of the final DOM subscriber, and explicit disconnect.

## P2: correctness and release-quality fixes

### 6. Repair message examples that the parser cannot execute

**Location:** `index.js:7–35`, `index.js:166–171`; `README.md:104`, `README.md:136–142`, `README.md:195–206`, `README.md:260–271`.

Several documented examples are nonfunctional:

- `a get:apply: /data inner` produces one argument, `/data inner`, rather than separate URL and operation arguments. The request targets the wrong URL and `apply` receives an undefined operation. The polling example has this exact problem.
- `toast apply: Saved inner` supplies one argument, `Saved inner`, while `apply:` expects content from a pipe plus an operation argument. It leaves the receiver unchanged. The raw WebSocket example fails the same way.
- Programmatic examples address `#content`, but receiver lookup treats that as a literal receiver name, not an element ID or CSS selector. They do not address the earlier `receiver="content"` example.
- The WebSocket sending example does not establish the connection that `ws:send:` requires.

**Reproduced:** The compact HTTP example requested `/data inner` and left old content intact. The raw `apply:` example also left old content intact.

**Fix:** Choose and document one argument grammar. Working current syntax is `content get: /api/data apply: inner`, with polling written as `feed get: /updates apply: inner poll: 10s`. Clarify that `get:apply:` is the combined method-table selector even when keywords and arguments are interleaved. For direct literal content, add an explicit supported method or demonstrate a registered custom method; do not present a nonexistent literal-content method as built in. Establish and wait for a WebSocket connection in the send example. Mark JSON `receiver` as optional in the field table, consistently with broadcasting.

**Regression coverage:** Execute README snippets against matching HTML fixtures, asserting actual URL, content, and operation—not just that an error event occurred.

### 7. Persist the replacement produced by an outer swap

**Location:** `index.js:74–75`, `index.js:108–110`.

After assigning `el.outerHTML`, `el` still references the detached original element. `persist(el, 'outer')` serializes that original markup, so reload restores the old element rather than the replacement.

**Reproduced:** Replacing a persistent `<div>` containing `old` with a `<p>` containing `new` stores the original `<div>` in localStorage.

**Fix:** Retain the persistence key before replacement and save the inserted content or actual replacement nodes afterward. Define behavior for multiple replacement roots, removal of the receiver attribute, and receiver renaming.

**Regression coverage:** An outer swap followed by fresh initialization and restoration, including changed tags and receiver attributes.

### 8. Make receiver caching correct within the same JavaScript turn

**Location:** `index.js:45–58`.

Cache invalidation only happens when the mutation observer callback runs. A synchronous DOM replacement or receiver attribute change followed immediately by another send uses the old cached NodeList. Updates can go to detached or renamed elements instead of the current receivers. Cached empty results can also hide newly inserted receivers.

**Reproduced:** Send once to cache `a`, synchronously replace the body with a new `a`, then send again without awaiting. The new element is untouched.

**Fix:** Keep the observer reference and account for pending mutation records before reading the cache, or use another invalidation strategy that covers immediate external DOM mutations. Checking only whether cached nodes remain connected is insufficient for renamed receivers and newly added matches.

**Regression coverage:** Same-turn replacement, insertion after a cached miss, receiver renaming, removal, and insertion of additional matching elements.

### 9. Match receiver names consistently and safely

**Location:** `index.js:39–42`, `index.js:56`; `websocket.js:51`.

The CSS selector `[receiver~="name"]` matches any whitespace-separated token in the attribute, including method arguments and operations. A message to `inner` can therefore address `receiver="feed get: /x apply: inner poll: 1s"`. Names are also interpolated without escaping: a quote in a message's receiver name can throw a selector exception. Meanwhile `receiverName()` splits only at a literal space, unlike the whitespace-aware message parser.

**Reproduced:** Sending a custom method to `inner` modified the `feed` receiver above. A receiver name containing a double quote threw synchronously.

**Fix:** Define the first whitespace-separated token as the receiver identity, consistently across lookup, request headers, storage, and WebSockets. Use an index keyed by parsed names or safely escape selectors and filter by parsed identity. If multiple aliases are intended, specify their grammar separately from receiver configuration.

**Regression coverage:** Names colliding with `inner` or polling arguments, quotes/backslashes, and receiver attributes using tabs/newlines.

### 10. Initialize and maintain pollers as the DOM changes

**Location:** `index.js:312–357`.

Polling is initialized only in the one startup scan. Receivers inserted by fetched fragments never start polling. An outer swap removes the element that owns the timer, so its replacement does not continue polling. Each poller also retains a private target list that is refreshed only if its first element disconnects; additional receivers are missed and removed non-first receivers remain targets. Multiple polling declarations with the same name each poll the entire group, multiplying work.

**Reproduced:** Inserting a new polling receiver creates no timer. Adding another receiver with the existing poller's name does not add a request on the next tick.

**Fix:** Maintain an idempotent poller registry that reacts to added/removed elements and receiver attribute changes. Decide whether ownership is per element or per name and avoid accidental duplicate group polling. Reconcile targets on relevant mutations. Use a DOM-ready initialization path so loading core before page content does not silently skip restore and polling.

**Regression coverage:** Dynamic insertion, outer replacement, edited polling configuration, newly added and removed group members, cleanup, duplicate names, and loading the script in the document head.

### 11. Route polling through shared error and lifecycle handling

**Location:** `index.js:331–342`.

Poll callbacks invoke methods directly instead of using the normal delivery path. Rejected requests become unhandled rejections, successful operations emit no `talkdom:done`, and failures emit no `talkdom:error`. `setInterval` also starts another operation regardless of whether the previous one is still pending.

**Reproduced:** A successful poll emitted no completion event. A rejected fetch produced a process-level unhandled rejection and no receiver error event.

**Fix:** Extract a shared per-element delivery helper for clicks, public sends, polling, and WebSocket applies. Catch every poll result. Prevent overlapping ticks per poller, or make overlap an explicit policy. A completion-scheduled timeout is one possible implementation.

**Regression coverage:** Successful and failed polling, thrown custom methods, requests slower than the interval, removal during a request, and recovery on the next tick.

### 12. Make history changes follow successful navigation

**Location:** `index.js:177–205`, `index.js:294–297`.

The click handler pushes history immediately after starting dispatch, even when confirmation is cancelled or the request fails. The initial history entry is never seeded, so returning to a null-state entry leaves the later view rendered at the original URL. History states also store arbitrary sender commands; replaying a sender containing POST, DELETE, or append operations can repeat side effects.

**Reproduced:** A cancelled confirmation still changed the pathname. After rendering an About view, invoking the popstate handler with the original null state left About content visible at the home URL. The side-effect replay risk follows from dispatching the stored command unchanged; it was not tested against a live mutation endpoint.

**Fix:** Await successful navigation before pushing a validated, normalized URL. Store a safe restoration description or content snapshot for the initial and subsequent entries. Separate navigational replay from mutation commands. Define behavior when independent chains only partially succeed.

**Regression coverage:** Cancellation, HTTP failure, initial Back, Forward, reload, relative/absolute URL equivalence, and mutation commands that must not repeat. Validate actual traversal in a browser as well as handler tests.

### 13. Scope named WebSocket JSON messages to the connection's subscribers

**Location:** `websocket.js:45–55`.

Broadcast JSON uses `conn.receivers`, but named JSON queries the whole document. A message from connection A can update a receiver subscribed exclusively to connection B, or an unrelated ordinary receiver. This makes connection routing inconsistent and creates unintended authority when different endpoints have different trust levels.

**Reproduced:** A socket subscribed by `a` sent `{ "receiver": "b", "content": "wrong connection" }`, and the receiver attached to another URL changed.

**Fix:** Filter the current connection's connected subscribers by parsed receiver name. If global JSON routing is intentional, expose and document it explicitly. Raw message syntax already dispatches globally by design; clarify that trust boundary separately rather than claiming connection scoping protects raw commands.

**Regression coverage:** Two URLs, identical and different receiver names, ordinary non-subscribers, broadcasts, and explicitly supported global messages.

### 14. Reconcile WebSocket subscriptions when receiver attributes change

**Location:** `websocket.js:28–32`, `websocket.js:159–186`.

The observer only watches added nodes, and pruning checks only `isConnected`. Changing `receiver="a ws: wss://a.test"` to use another URL leaves the element subscribed to the old connection. Removing the `ws:` clause or the whole receiver attribute has the same stale-subscription problem.

**Reproduced:** Editing a connected element's WebSocket URL created no new socket and left one subscriber on the old URL.

**Fix:** Observe receiver attribute changes and track each element's current subscription. Unsubscribe before resubscribing; remove empty automatic connections; avoid duplicate registration when nodes move. Validate socket URLs and recover if the WebSocket constructor throws so one bad declaration does not abort initialization of subsequent receivers.

**Regression coverage:** URL changes, removal of `ws:`, removal of the attribute, node moves, invalid URLs, and unrelated receivers that must still initialize.

### 15. Track actual replacement targets for lifecycle events

**Location:** `index.js:210–214`, `index.js:237–251`; `websocket.js:57–60`.

Core guesses the replacement from neighboring elements. If a receiver is replaced by text or removed, the guess can select an unrelated sibling. WebSocket JSON bypasses this recovery entirely and always dispatches on the old element after an outer swap, so its completion event no longer bubbles to the document.

**Reproduced:** A text-only replacement dispatched core's completion event on an unrelated `<aside>`. A WebSocket outer replacement updated content but emitted no document-level completion event.

**Fix:** Have the DOM-apply operation track the actual inserted nodes and share its result with lifecycle delivery. Define a stable parent/document fallback for removal or text-only replacements, with the original receiver recorded in event detail. Define an explicit policy for multi-root replacement.

**Regression coverage:** Single-root, multi-root, text-only and empty replacements, adjacent unrelated elements, duplicate receiver names, and both HTTP and WebSocket updates.

### 16. Validate WebSocket payloads before routing

**Location:** `websocket.js:45–82`.

JSON is recognized only if the very first character is `{`. A valid object preceded by whitespace is sent to the raw command parser and can throw a selector exception. `msg.content || ''` silently replaces valid numeric zero or boolean false with empty text. The broad JSON `try/catch` also labels DOM/application exceptions as invalid JSON, hiding their actual cause.

**Reproduced:** `content: 0` rendered empty content, and a space before a valid JSON object took the raw path and threw.

**Fix:** Trim leading whitespace for format detection, validate the message envelope, and define accepted content types. Preserve supported falsy values or explicitly reject unsupported types instead of silently erasing them. Separate JSON parsing errors from validation and application failures, using consistent error events.

**Regression coverage:** Leading whitespace, zero, false, missing content, malformed JSON, wrong field types, invalid operations, and throwing apply methods.

### 17. Validate apply operations and tokenize accepts correctly

**Location:** `index.js:63–66`, `index.js:99–111`.

`accepts` uses literal space boundaries, so `accepts="text\ninner"` rejects `text`. Unknown or undefined operations fall through the switch, return content, and may persist a state despite performing no update. Denied operations log an error but the delivery path still reports `talkdom:done`; piped work can continue after a failed apply.

**Reproduced:** A newline-separated accepts list rejected a listed operation. The malformed README examples also demonstrated silent success when the operation was undefined.

**Fix:** Split accepts tokens with the same whitespace grammar used elsewhere. Validate the operation against the supported set before mutation or persistence. Define denied/invalid operations as explicit failures, and propagate them consistently through public promises and lifecycle events. Clarify whether an empty accepts attribute means allow-all or allow-none.

**Regression coverage:** Tabs/newlines, each supported operation, unknown/undefined operations, denied applies, and downstream pipes after a denied operation.

### 18. Make builds and package contents reproducible

**Location:** `package.json:8–17`; local ignored `dist/`.

The build overwrites only two minified bundles and maps without cleaning obsolete output. The package includes all of `dist/`. This checkout contains `talkdom.esm.js` and `talkdom-ws.esm.js`, with maps, which the current build never generates. A temporary-copy build followed by a package dry run still included all four old ESM files. A release can therefore contain artifacts dependent on a developer's previous working state.

The fresh minified core bundle also had no `sourceMappingURL` comment. Its generated map named `index.js`, contained no embedded source, and lived under `dist/`, where that relative source is absent.

**Fix:** Generate release output into a clean staging directory or remove only known generated outputs before building. Use an explicit artifact allowlist. Configure source-map references and valid source paths or embedded source content. Inspect the package manifest in a release check. Consider a `prepack` build if `npm pack` is intended to produce a usable package from a clean checkout; `prepublishOnly` currently protects publication only.

**Regression coverage:** Build from clean and previously populated output directories and compare package contents; verify source-map linkage; run a smoke test against the packed core and plugin artifacts.

### 19. Replace tests that pass without exercising their named behavior

**Location:** `test-runner.js:3–10`; `test.js:206–215`, `test.js:441–452`, `test.js:672–703`; `package.json:16`.

The green suite currently misses substantial behavior:

- The runner never loads `websocket.js`; none of the plugin is covered.
- All unhandled promise rejections are silently swallowed, including unexpected failures.
- The polling cleanup test never starts a poller and ends with `assert(true)`.
- The poller-limit test only checks the getter/setter; it never reaches the limit check.
- The corrupt-storage test does not call restore. It checks that a separate `JSON.parse` throws.
- The outer-swap event test removes its listener on the first event, which is the preceding `echo:` operation, so it can pass without verifying the outer apply event.
- There are no history tests. The rapid-send tests use immediately resolved values and do not exercise out-of-order HTTP responses.
- The standard lint script excludes the plugin despite an existing plugin ESLint configuration; test and runner files also lack configured lint coverage.

**Fix:** Seed initial DOM/storage before loading each isolated library instance. Use deterministic timers for poll/reconnect tests and a fake socket for plugin tests. Await or explicitly assert expected rejections, and fail on unexpected ones. Filter lifecycle assertions by selector and verify the replacement target. Include both runtime files in the normal lint command, then configure appropriate environments for the test files.

**Regression coverage:** Promote the failure scenarios in this report into focused tests as their corresponding fixes are implemented. Add a small real-browser integration suite for navigation, native click/submit behavior, and network/socket integration.

### 20. Prevent the main demo from accumulating active action receivers

**Location:** `index.html:13`; `step1.html:1`; `step2.html:1`.

The demo both outer-swaps `actions` and appends the same button fragment to `bottom`. The appended fragment also declares `receiver="actions"`. Each iteration adds another active action receiver, and every later message to `actions` performs a request for every accumulated button.

**Reproduced:** The first click issued two requests and left two action receivers. The second click issued four requests: one for content, two action swaps, and one append. Continued clicks increase the action group further.

**Fix:** Give the active control a dedicated receiver and append a display-only history fragment without that receiver, or deliberately demonstrate grouped delivery with a bounded number of elements. Clarify the intended demo behavior.

**Regression coverage:** Click through multiple cycles and assert bounded receiver and request counts, as well as the expected visible step.

## Further improvements

These are proposed enhancements or follow-up hardening work, not claims of additional independently reproduced bugs.

### A. Declare a supported development runtime (P2)

`package.json` has no engines declaration and the repository has no runtime-version file or contributor setup instructions. Installed jsdom and ESLint both declare Node `^20.19.0 || ^22.13.0 || >=24`, while the shell defaults to Node 16. Add a project runtime pin and document install/test/build commands. Enforce the chosen runtime in CI, while distinguishing development-tool requirements from browser runtime compatibility.

### B. Add request concurrency and cancellation policies (P2)

`request()` has no cancellation, timeout, or stale-response policy (`index.js:126–152`). Slow earlier requests can overwrite newer results; detached receivers can still receive async updates. Define selectable behavior such as latest-result-wins, serial execution, or dropping duplicate pending requests. Tie cancellation to receiver disposal where appropriate, and test reversed response order. Avoid making concurrent side-effecting requests silently disappear without an explicit API policy.

### C. Support form payloads and event choices (P3)

POST/PUT currently send headers and a method but no body, and declarative handling listens only to clicks (`index.js:139`, `index.js:346–352`). Add explicit FormData/JSON body support and configurable submit/change/input triggers if forms are in scope. Preserve validation and normal modified-link behavior, and provide loading, disabled, and accessible status hooks. Keep click interception for ordinary senders intentional rather than treating every prevented default as a bug.

### D. Specify escaping and offer a structured message API (P3)

Semicolons and pipes always split messages, and whitespace tokens ending in `:` become keywords. Quoting is not implemented, so literal delimiters in text, URLs, or HTML entities can be misinterpreted. Ordinary multi-word arguments already work because their tokens are rejoined. Document reserved syntax, add an escaping grammar if needed, and consider a structured API such as an explicit receiver/selector/args object to avoid building command strings from dynamic data.

### E. Add explicit initialization, configuration, and disposal (P3)

Expose an idempotent initializer and disposal path for observers, listeners, pollers, and sockets. Provide configuration before startup rather than only exposing `maxPollers` after the initial poll scan. Validate finite nonnegative limits and supported timer intervals. This would make dynamic pages, hot reload, isolated tests, and constrained deployments easier to support.

### F. Clarify security and persistence boundaries (P3)

The README already documents unsanitized HTML and plain-text storage. Extend that explanation to WebSocket content and to raw server commands, which can invoke registered methods. If applications need it, offer a sanitizer/Trusted Types integration hook while retaining a dependency-free default. Consider configurable storage namespaces, schema versions, expiry, and clear/reset operations; the current `talkDOM:<name>` key shares content between pages on the same origin that reuse a receiver name. Decide whether restored markup must still satisfy a receiver's current accepts policy.

### G. Tighten distribution and compatibility documentation (P3)

Document classic-script globals versus module consumption: the current `main` points to an IIFE that requires a DOM and does not export an API. Add explicit package exports and generated ESM builds only if module consumption is intended. Add type declarations or JSDoc for methods, events, return values, and plugin APIs. Verify the README browser minimums against actual APIs and browser tests before presenting them as guaranteed support. No browser-minimum verification was performed in this review.

## Suggested implementation order

1. Repair the test harness and add meaningful failing tests for each fix being undertaken; include the WebSocket plugin in checks.
2. Fix promise/error behavior, recoverable persistence initialization, sensitive request headers, and manual socket ownership.
3. Reuse a per-element delivery/apply path for consistent lifecycle handling across core, polling, and WebSockets.
4. Repair receiver lookup, dynamic polling/subscriptions, outer persistence, and history behavior.
5. Correct and execute documentation examples; fix the demo; make release artifacts deterministic.
6. Select optional improvements based on intended usage, especially forms, request concurrency, module support, and structured messages.

## Notes on the existing improvements.md

The earlier file was preserved. Several of its suggestions need correction or different priority:

- Mixed `var`/`const` declarations are a style choice, not a critical bug.
- HTML insertion is an explicitly documented trust decision; the concrete cross-origin header exposure above is a separate issue.
- Multi-word arguments are rejoined correctly. The parser problem concerns compact argument binding, reserved delimiters, and absent quoting/escaping.
- Runtime method extension is documented and tested; freezing the method table would break that feature and plugin registration.
- Unit-style DOM tests already exist. The issue is missing and ineffective coverage, not a complete absence of tests.
- Static NodeList iteration during restoration is not sufficient by itself to demonstrate a bug. The reproducible persistence failures are stale outer markup, storage exceptions, and invalid state shapes.
- A fetch rejection handler is not redundant when it adds contextual logging, and normal sender click interception is deliberate behavior.


## Implementation status — 2026-09-20

Numbered findings 1–20 have been addressed across the committed runtime, regression tests, examples, README, changelog, build tooling, and CI workflow. The report remains untracked by request.

Compatibility decisions:
- Receiver aliases before the first keyword remain supported (finding 9).
- Invalid/denied apply operations emit error events and never persist invalid state. Legacy promises still resolve by default; `strictApply: true` opts into rejection and stopping downstream pipes (finding 17).
- Named WebSocket JSON routes only within its connection; raw command strings retain their documented global scope.
- History restores markup snapshots rather than replaying mutation commands; old sender-only history entries do not execute. Snapshot layout and listener limitations are documented.

Additional proposals: A (runtime setup), D (reserved grammar documentation and structured per-element delivery), F (trust/storage documentation), and G (distribution/browser compatibility documentation) are addressed to the extent compatible with the current browser-script API. B (request cancellation/concurrency policies), C (form/event APIs), E (full initialization/disposal API), and optional ESM/type/sanitizer/storage-schema features remain separate feature proposals; they were not enabled by default or added in this correctness pass.

Verification: legacy browser-style assertions, isolated Node regression tests including both runtime files, expanded lint, deterministic package builds with packed-artifact smoke checks, and real Chromium checks for native clicks, HTTP/WebSocket delivery, history traversal, reload, and mutation safety. A CI workflow now runs these checks; it has not yet run on the remote service.
