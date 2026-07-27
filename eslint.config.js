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
    // .mjs covers the build-time tooling under scripts/, which is ESM by
    // extension rather than by package type.
    files: ["**/*.js", "**/*.mjs"],
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
      // These were the legacy backlog and it is now at zero, so `npm run lint` is clean rather than
      // 800 lines of noise. Left at "warn" so a work-in-progress branch is not blocked by an unused
      // variable; promote to "error" if the zero should be enforced in CI.
      // ignoreRestSiblings: `const { savedAt, ...stable } = data` names savedAt precisely so the
      // rest object does NOT carry it. The binding being unread is the point, not an oversight.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
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
