# wave 0: web framework foundation

set up Hono + Vite React SPA as the web framework for the tino console before fixing any bugs. every fix in waves 1-4 touches the console server or HTML — doing those on raw `node:http` with a 2000-line inline HTML string is why we keep shipping broken code. the framework goes in first, then everything else is built on solid ground.

## why hono + vite react

- **Hono** replaces raw `node:http` for the server. lightweight, fast, middleware-based (auth middleware becomes a one-liner), works with Node/Bun/Deno. MIT licensed, zero licensing risk.
- **Vite + React SPA** replaces the 2000-line inline HTML string. React pages are built by Vite into static files that Hono serves. no SSR complexity — the console is an admin tool, not a public-facing SEO-critical site. client-side rendering is fine.
- **no meta-framework** — no Vike, no Next.js, no TanStack Start. Hono handles API routes and serves the built React app. Vite handles the dev server with HMR and the production build. that's it.

## items

### 0.1 install deps

```bash
cd packages/core
bun add hono
bun add -D vite @vitejs/plugin-react react react-dom @types/react @types/react-dom
```

### 0.2 set up project structure

```
packages/core/
  src/
    server/
      index.ts            ← Hono app (replaces console/server.ts)
      middleware/
        auth.ts           ← better-auth middleware for Hono
      routes/
        config.ts         ← GET/PUT/DELETE /api/config
        health.ts         ← GET /api/health
        capabilities.ts   ← GET/PUT /api/capabilities
        compliance.ts     ← GET /api/compliance
        reload.ts         ← POST /api/reload/slack, /api/reload/capabilities (wave 3)
    console/
      main.tsx            ← React app entry point
      App.tsx             ← root component with routing
      pages/
        Login.tsx         ← Google sign-in page
        Setup.tsx         ← Slack token + basics setup flow
        Console.tsx       ← main console (capability cards, config)
      components/
        CapabilityCard.tsx
        ConfigTable.tsx
        ComplianceSection.tsx
        HealthFooter.tsx
        Header.tsx        ← signed-in indicator, sign-out, logo
      hooks/
        useConfig.ts      ← fetch /api/config
        useHealth.ts      ← fetch /api/health
        useAuth.ts        ← session state, sign-out
      styles/
        tokens.css        ← design tokens (colors, spacing, typography)
      index.html          ← Vite entry HTML
    console/
      server.ts           ← DELETED (replaced by server/)
      html.ts             ← DELETED (replaced by React pages)
      auth.ts             ← MOVED to server/middleware/auth.ts
  vite.config.ts          ← Vite config for the React SPA
```

### 0.3 hono server

```ts
// src/server/index.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { authMiddleware } from './middleware/auth.js';
import { configRoutes } from './routes/config.js';
import { healthRoutes } from './routes/health.js';
// ...

const app = new Hono();

// Public routes (no auth)
app.get('/api/health', healthRoutes.health);
app.route('/api/auth', authRoutes); // better-auth handler

// Auth middleware for everything else
app.use('*', authMiddleware);

// Protected API routes
app.route('/api/config', configRoutes);
app.route('/api/capabilities', capabilityRoutes);
app.route('/api/compliance', complianceRoutes);

// Serve the React SPA (built by Vite)
app.use('/*', serveStatic({ root: './dist/console' }));
// SPA fallback: serve index.html for all non-API routes
app.get('*', (c) => c.html(/* read dist/console/index.html */));

serve({ fetch: app.fetch, port: 3001 });
```

### 0.4 better-auth middleware for hono

better-auth has a Hono integration out of the box:

```ts
// src/server/middleware/auth.ts
import { auth } from './auth-instance.js';

// Hono middleware that checks session
export const authMiddleware = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('user', session.user);
  await next();
};
```

### 0.5 vite config for the react SPA

```ts
// packages/core/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/console',
  build: {
    outDir: '../../dist/console',
    emptyOutDir: true,
  },
});
```

### 0.6 migrate pages to react components

- **Login.tsx** — the sign-in page (currently inline HTML in server.ts)
- **Setup.tsx** — the welcome/Slack setup flow (currently in html.ts)
- **Console.tsx** — the main console with capability cards (currently in html.ts)
- **components/** — extracted from the monolithic html.ts into proper React components

use react-router for client-side routing between login → setup → console.

### 0.7 migrate API routes to hono route handlers

each `if (method === 'GET' && routePath === '/api/config')` block becomes a Hono route handler in its own file. clean, testable, type-safe.

### 0.8 delete the old console code

- delete `src/console/server.ts` (replaced by `src/server/index.ts`)
- delete `src/console/html.ts` (replaced by React pages)
- move `src/console/auth.ts` to `src/server/middleware/auth.ts`

### 0.9 update dockerfile

the Dockerfile needs a Vite build step for the React SPA:

```dockerfile
# In the builder stage:
RUN cd packages/core && npx vite build
```

the built SPA goes to `packages/core/dist/console/` and Hono serves it as static files.

## build / dev story

- **local dev:** `vite dev` for the React SPA (HMR, instant reloads) + the Hono server runs separately (or use Vite's proxy to forward API calls to Hono)
- **production:** `vite build` produces static assets. Hono serves them alongside the API routes. one process, one port.
- **Docker:** the builder stage runs both `tsc` (for the server) and `vite build` (for the SPA). the runner serves everything.

## what does NOT change

- the Slack bot, agent loop, tools, scheduler, persistence — all unchanged
- the DynamoDB/SQLite persistence layer — unchanged
- the Pulumi component — unchanged
- the CLI (`tino init`, `tino deploy`) — unchanged
- better-auth integration — same library, just mounted on Hono instead of raw http
