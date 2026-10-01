import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const api = "http://localhost:3001";

export default defineConfig({
  plugins: [reactRouter()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/slack": { target: api, changeOrigin: false },
    },
  },
});
