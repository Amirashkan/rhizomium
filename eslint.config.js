// eslint.config.js
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: {
      env: {
        browser: true  // ← این باید داخل linterOptions باشه
      }
    },
    rules: {
      "no-unexpected-multiline": "error",
      "no-cond-assign": ["error", "always"],
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    },
  },
];
