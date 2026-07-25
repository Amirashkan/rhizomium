// eslint.config.js
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "src-tauri/**",
      "index.backup.*.html",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.worker,
        ...globals.node,
      },
    },
    rules: {
      // Bug-catching rules stay hard errors.
      "no-unexpected-multiline": "error",
      "no-cond-assign": ["error", "except-parens"],
      "no-undef": "error",
      "no-dupe-class-members": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-fallthrough": ["error", { allowEmptyCase: true }],
      // Two expression evaluators legitimately use eval and carry a disable comment saying so; the
      // rule is on so those comments mean something and a third eval has to argue for itself.
      "no-eval": "error",
      // High-volume legacy noise reports as warnings until burned down.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-catch": "warn",
      "no-case-declarations": "warn",
      "no-prototype-builtins": "warn",
      "no-control-regex": "warn",
      "no-useless-escape": "warn",
      "no-constant-binary-expression": "warn",
      "no-async-promise-executor": "warn",
    },
  },
];
