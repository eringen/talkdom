# talkDOM — Planned Features

Features needed to further reduce vanilla JS and move toward full HATEOAS in the dashboard.

## 1. Form Body Support ✅

**Keywords:** `post-form:`, `put-form:`, `delete-form:`

Serialize a form element's inputs as `application/x-www-form-urlencoded` body and send with the request.

**Usage:**
```html
<button sender="receiver post-form: /api/endpoint apply: inner form: #my-form">Submit</button>
<form id="my-form">
  <input name="name" value="test">
  <input name="email" value="user@example.com">
</form>
<div receiver="receiver"></div>
```

**Implementation:**
- `src/index.js:153` - `serializeForm()` helper function using `URLSearchParams` and `FormData`
- `src/index.js:184-198` - Method definitions for `post-form:apply:form:`, `put-form:apply:form:`, `delete-form:apply:form:`
- The `form:` keyword specifies the CSS selector for the form element
- Form data is serialized as `application/x-www-form-urlencoded`

## 2. JSON Body Support ✅

**Keywords:** `post-json:`, `put-json:`

Send a JSON payload constructed from a form or inline data.

**Usage:**
```html
<button sender="receiver post-json: /api/data apply: inner json: {&quot;name&quot;:&quot;test&quot;,&quot;value&quot;:123}">Submit</button>
<div receiver="receiver"></div>
```

**Implementation:**
- `src/index.js:200-207` - Method definitions for `post-json:apply:json:`, `put-json:apply:json:`
- The `json:` keyword specifies the JSON payload (JSON parsed at runtime)
- Content-Type header should be set by the server; body is sent as raw JSON string

## 3. Dynamic Polling (MutationObserver) ✅

Previously `poll:` only started for elements present at page load. Elements added later (e.g., via Alpine `x-if` or talkDOM fragment injection) didn't get polling.

**Solution:** Added a `MutationObserver` that watches for dynamically added elements with `[receiver]` attributes containing `poll:`.

**Implementation:**
- `src/index.js:405-421` - MutationObserver observes `document` for added nodes with `[receiver]` attributes
- Automatically calls `startPolling()` for any newly added polling receiver elements
- Works with all existing polling functionality including cleanup when elements are removed

## 4. Loading State Class ✅

**Keyword:** `loading:`

Toggle a CSS class on the receiver element while the fetch is in progress.

**Usage:**
```html
<style>
.is-loading { opacity: 0.5; pointer-events: none; }
</style>
<div receiver="data get: /api/data apply: inner loading: is-loading"></div>
<button sender="data">Refresh</button>
```

**Implementation:**
- `src/index.js:275-282` - `send()` function parses and strips `loading:` keyword before looking up the method
- `src/index.js:293-295` - Class is added before async operation starts
- `src/index.js:297-298, 301-302` - Class is removed after success or error
- Works with any async method (fetch operations, custom methods returning promises)

## Tests Added

All new features include comprehensive tests in `test.js`:

- Form body support: 4 tests (POST, PUT, DELETE, error handling)
- JSON body support: 2 tests (POST, PUT)
- Loading state class: 2 tests (success, error)
- Dynamic polling: 1 test (MutationObserver behavior)

**Total: 84 tests passing**
