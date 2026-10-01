import { defineConfig } from "vitest/config";

// Run under Bun (`bun --bun vitest`) so Bun-only modules resolve in tests.
// `server.deps.inline: ['zod']` makes vitest bundle zod's ESM entry instead of
// relying on Bun's CJS/ESM interop, which mishandles zod's re-exports.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    server: { deps: { inline: ["zod"] } },
  },
});
