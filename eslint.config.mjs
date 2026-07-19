export default [
  {
    files: ["index.js", "test.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: {
        talkDOM: "readonly",
        document: "readonly",
        window: "readonly",
        localStorage: "readonly",
        location: "readonly",
        history: "readonly",
        fetch: "readonly",
        console: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        confirm: "readonly",
        CustomEvent: "readonly",
        Promise: "readonly",
        Headers: "readonly",
        URL: "readonly",
        MutationObserver: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      "eqeqeq": ["warn", "always"],
    },
  },
  {
    files: ["websocket.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: {
        document: "readonly",
        window: "readonly",
        console: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        CustomEvent: "readonly",
        Promise: "readonly",
        Set: "readonly",
        MutationObserver: "readonly",
        WebSocket: "readonly",
        talkDOM: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      "eqeqeq": ["warn", "always"],
    },
  },
  {
    files: ["test-runner.js", "test/**/*.cjs", "scripts/**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: Object.fromEntries([
        "console", "process", "__dirname", "Buffer", "URL", "WebSocket", "fetch",
        "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate"
      ].map(name => [name, "readonly"])),
    },
    rules: { "no-undef": "error", "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] },
  },
];
