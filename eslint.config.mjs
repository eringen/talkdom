export default [
  {
    files: ["index.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: {
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
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      "eqeqeq": ["warn", "always"],
    },
  },
];
