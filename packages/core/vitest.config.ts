import { defineConfig } from "vitest/config";

// Vitest config for `packages/core` tests.
//
// Kept separate from `vite.config.ts` because the latter is rooted at
// `src/console-app/` (the SPA build) — vitest needs to scan the package
// root to find tests under `tests/` and any colocated test files.
//
// Bun runtime: tests must run under Bun so `bun:sqlite` resolves. The `test`
// npm script invokes vitest via `bun --bun ./node_modules/vitest/dist/cli.js
// run`, which makes the parent process Bun; child workers (forks) inherit
// the Bun runtime via process.execPath.
//
// `server.deps.inline: ['zod']` forces vitest to bundle zod's ESM entry
// instead of relying on Bun's native CJS/ESM interop, which mishandles
// zod's `index.js` re-export under vitest's Module Runner.
export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec,test-d}.{ts,tsx}", "src/**/*.{test,spec,test-d}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "src/console-app/**"],
    pool: "forks",
    server: {
      deps: {
        inline: ["zod"],
      },
    },
  },
});
