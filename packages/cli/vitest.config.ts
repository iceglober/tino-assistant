/**
 * Vitest config for `packages/cli`.
 *
 * Mirrors `packages/core/vitest.config.ts`. The CLI is plain Node ESM with
 * no bun:sqlite or other runtime gotchas, so the config can stay minimal:
 *   - scan `tests/**` for spec files
 *   - exclude `node_modules` and `dist`
 *
 * The root `package.json`'s `"test": "bun run --filter '*' test"` fans out
 * to every workspace package; adding the `test` script in our package.json
 * automatically pulls these CLI tests into the workspace-wide run.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
