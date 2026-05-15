# wave 0: web framework foundation

set up Hono + Vite React SPA as the web framework for the tino console before fixing any bugs. every fix in waves 1-4 touches the console server or HTML — doing those on raw `node:http` with a 2000-line inline HTML string is why we keep shipping broken code. the framework goes in first, then everything else is built on solid ground.

## why hono + vite react

- **Hono** replaces raw `node:http` for the server. lightweight, fast, middleware-based (auth middleware becomes a one-liner), works with Node/Bun/Deno. MIT licensed, zero licensing risk.
- **Vite + React SPA** replaces the 2000-line inline HTML string. React pages are built by Vite into static files that Hono serves. no SSR complexity — the console is an admin tool, not a public-facing SEO-critical site. client-side rendering is fine.
- **no meta-framework** — no Vike, no Next.js, no TanStack Start. Hono handles API routes and serves the built React app. Vite handles the dev server with HMR and the production build. that's it.

## items

### enrichment notes (apply across all items in this wave)

**files affected (overall):**
- NEW: `packages/core/src/server/index.ts`, `packages/core/src/server/middleware/auth.ts`, `packages/core/src/server/routes/{config,health,capabilities,compliance,reload}.ts`
- NEW: `packages/core/src/console/main.tsx`, `App.tsx`, `pages/{Login,Setup,Console}.tsx`, `components/*.tsx`, `hooks/*.ts`, `styles/tokens.css`, `index.html`
- NEW: `packages/core/vite.config.ts`
- DELETE: `packages/core/src/console/server.ts` (490 lines), `packages/core/src/console/html.ts` (2109 lines)
- MOVE: `packages/core/src/console/auth.ts` → `packages/core/src/server/middleware/auth.ts`
- EDIT: `Dockerfile` (add `vite build` step in builder stage), `packages/core/package.json` (add hono/vite/react deps and a `build:console` script)

**mirrors (overall):**
- `packages/core/src/console/server.ts:69-354` (the inline `handleRoute` function) is the single canonical mirror for what each new Hono route handler must do — every `if (method === '...' && routePath === '...')` block at lines 76, 83, 102, 111, 155, 181, 197, 229, 287, 325 maps 1:1 to a Hono route file in `routes/`.
- `packages/core/src/console/html.ts:1462-1565` (the screen-switcher and fetch helpers in vanilla JS) is the React-router mirror — keep the same screen names (`screen-welcome` → `<Login>`, `screen-basics` → `<Setup>`, `screen-console` → `<Console>`).
- `packages/core/src/console/auth.ts:1-32` (the `createAuth` factory) is the mirror for the new `server/middleware/auth.ts` — the `betterAuth({ ... })` config block stays identical; only the Node-http adapter (`toNodeHandler`, `fromNodeHeaders` from `better-auth/node`) is swapped for the Hono adapter (`betterAuth/api/getSession({ headers: c.req.raw.headers })`).

**context (canonical route handler shape from `console/server.ts:111-152` — `PUT /api/config/:key`):**
```ts
if (method === 'PUT' && routePath.startsWith('/api/config/')) {
  const key = decodeURIComponent(routePath.slice('/api/config/'.length));
  if (!key) { res.writeHead(400); res.end('Missing key'); return; }
  readBody(req, (err, body) => {
    if (err) { res.writeHead(400); res.end('Failed to read request body'); return; }
    let parsed: { value: unknown };
    try { parsed = JSON.parse(body) as { value: unknown }; }
    catch { res.writeHead(400); res.end('Request body must be valid JSON'); return; }
    if (!('value' in parsed)) { res.writeHead(400); res.end('Request body must have a "value" field'); return; }
    void config.set(key, parsed.value).then(async () => {
      logger.info({ key }, 'config updated via console');
      if (auditLogger) await auditLogger.log({ userId: 'console', action: 'config_change', toolName: key, status: 'success' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, key }));
    });
  });
  return;
}
```
→ Hono equivalent in `routes/config.ts`:
```ts
configRoutes.put('/:key', async (c) => {
  const key = c.req.param('key');
  const { value } = await c.req.json();
  if (value === undefined) return c.json({ error: 'value required' }, 400);
  await config.set(key, value);
  await auditLogger?.log({ userId: 'console', action: 'config_change', toolName: key, status: 'success' });
  return c.json({ ok: true, key });
});
```

**context (current `createAuth` to wrap in Hono middleware — `console/auth.ts:5-31`):**
```ts
export async function createAuth(opts: {
  googleClientId: string; googleClientSecret: string;
  allowedDomain?: string; baseUrl: string; dbPath?: string;
}): Promise<Auth> {
  const auth = betterAuth({
    baseURL: opts.baseUrl,
    secret: process.env['BETTER_AUTH_SECRET'] ?? crypto.randomUUID(),
    database: new Database(opts.dbPath ?? "./tino-auth.db"),
    socialProviders: { google: { clientId: opts.googleClientId, clientSecret: opts.googleClientSecret } },
    session: { expiresIn: 60 * 60 * 24 },
  }) as unknown as Auth;
  const { runMigrations } = await getMigrations((auth as any).options);
  await runMigrations();
  return auth;
}
```

**context (existing `index.ts` startConsole call site to update — line 94):**
```ts
const consoleServer = await startConsole(configStore, logger, tools, registry, 3001, auditLogger);
// → becomes: const consoleServer = await startServer({ config: configStore, logger, tools, registry, port: 3001, auditLogger });
```

**conventions (apply across the wave):**
- imports: ESM with `.js` extensions for compiled output; React/TSX uses `.tsx`; named imports throughout
- exports: named `export function`, `export const`; never default
- TypeScript: `tsconfig.build.json` already extends NodeNext; preserve that. Vite uses its own bundler config separately
- React: function components only (no classes); hooks over HOCs; keep JSX terse and prop types inline (`{ children }: { children: ReactNode }`)
- routing: react-router-dom v6+ (`<Routes>` + `<Route>`); SPA fallback to index.html for any non-`/api/*` path
- styling: design tokens go to `styles/tokens.css` (mirror the `:root` block at `console/html.ts:75-97` exactly — same variable names, same hex values); never hex inline
- test framework: vitest (already configured for `packages/core` per `package.json:test`); React tests use `@testing-library/react` if added
- error handling: try/catch with `(err as Error).message` in log lines; pino-style `logger.info({ ... }, 'message')`; never `alert()` in console JS — use the existing `showToast(msg, level)` pattern (defined in `html.ts`)
- audit: every config write goes through `auditLogger.log({ userId, action, toolName, status })` — match the shape at `server.ts:139-146`
- security: do NOT bypass `authMiddleware` for any new route except `/api/auth/*` and `/api/health` (existing `publicPaths` allowlist at `server.ts:368`); login page HTML is served from the auth middleware itself when session is missing — preserve that behavior in the Hono port
- bundling: keep `@tino/aws` out of the React SPA bundle; only `@tino/core` types may cross the client/server boundary
- Dockerfile: builder stage runs `tsc -p tsconfig.build.json` AND `vite build`; runner stage copies `dist/` (server) AND `dist/console/` (SPA assets); `WORKDIR /app` is fixed (see wave 1.4)

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

## Open questions

(none — defaults captured in implementation; resolved during build)

## Decisions made during execution

- **Console SPA root directory:** `src/console-app/` (not `src/console/`). The plan listed `src/console/main.tsx` etc., but the path was already scaffolded as `console-app/` in the working tree, and `console/` was occupied by the legacy files we're deleting. Keeping `console-app/` avoids a name collision during the deletion step. The Vite root and `serveStatic` paths were updated to match.
- **Where the `JSX` namespace comes from:** React 19 dropped the global `JSX` namespace; every `*.tsx` file imports `type JSX` from `'react'`. Documented in `tsconfig.app.json` (`"jsx": "react-jsx"`).
- **Vitest config split:** added `packages/core/vitest.config.ts` so vitest can find `tests/**` from the package root. `vite.config.ts` is rooted at `src/console-app/`, which would otherwise cause vitest to scan only the SPA tree.
- **Separate `tsconfig.app.json`:** the SPA needs DOM lib, JSX, and Bundler module resolution; the server needs Node types and NodeNext. Two configs, both run in the `typecheck` script.
- **Build outputs:** server tsc → `dist/server/`, Vite SPA → `dist/console/`. Dockerfile copies both via the existing `COPY --from=builder /app/packages/core/dist`.
- **`/api/users` and `/api/reload` routes:** kept the existing scaffolds. `users` mirrors the old `DELETE /api/users/:userId`; `reload` is wave 3 stubs returning 501.
- **`/api/auth/get-session` stub when auth disabled:** preserved from the existing scaffolding — returns `null` so the React `useAuth` hook gets a deterministic answer in local dev.
