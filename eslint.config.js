import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri", "fixtures"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Underscore-prefixed args/vars are intentional stubs/unused slots.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // E2E harness: the Playwright specs run under Node + browser APIs, and
    // tauri-mock.js is injected into the page raw (globals live on window).
    files: ["e2e/**/*.js", "e2e/**/*.ts"],
    languageOptions: {
      globals: {
        window: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        console: "readonly",
      },
    },
  },
  {
    // Node scripts and vite/vitest config files run under Node, not the DOM.
    files: ["scripts/**/*.mjs", "*.config.ts", "*.config.js"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    // Pure-core architecture guard (ARCH.md): src/core must stay
    // Tauri-free so it is unit-testable headless. Violations are errors.
    files: ["src/core/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/*"],
              message:
                "src/core must stay pure TypeScript (ARCH.md) — no @tauri-apps/* imports. Tauri adapters belong in src/app.",
            },
          ],
        },
      ],
    },
  },
);
