import { defineConfig } from 'vitest/config';

// Vitest config for `packages/core` tests.
//
// Kept separate from `vite.config.ts` because the latter is rooted at
// `src/console-app/` (the SPA build) — vitest needs to scan the package
// root to find tests under `tests/` and any colocated test files.
export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'src/console-app/**'],
  },
});
