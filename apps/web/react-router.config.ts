import type { Config } from "@react-router/dev/config";

/**
 * SPA mode: no runtime server rendering. `react-router build` pre-renders the
 * root route into dist/client/index.html, which @tino/server serves for every
 * non-API path.
 */
export default {
  appDirectory: "app",
  buildDirectory: "dist",
  ssr: false,
} satisfies Config;
