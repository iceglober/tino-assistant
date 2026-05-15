import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite config for the tino console React SPA.
 *
 * - Source root: `src/console-app/` (so `index.html` and `main.tsx` can sit
 *   next to each other, the way Vite expects).
 * - Build output: `dist/console/` at the package root — matches the
 *   `serveStatic` root in `src/server/index.ts` and the `COPY` line in
 *   the Dockerfile runner stage.
 * - Dev server proxy: `/api/*` and `/assets/*` forward to the Hono server on
 *   :3001 so HMR works against the real backend in local dev.
 */
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/console-app'),
  base: '/',
  build: {
    outDir: path.resolve(__dirname, 'dist/console'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/assets/tino-logo.png': 'http://localhost:3001',
    },
  },
});
