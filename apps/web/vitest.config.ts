import { defineConfig } from "vitest/config";

// Unit tests for pure helpers only — no react-router plugin, no DOM.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
  },
});
