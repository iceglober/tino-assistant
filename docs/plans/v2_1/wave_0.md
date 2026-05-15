# wave 0: web framework foundation

set up Vike as the web framework for the tino console before fixing any bugs. every fix in waves 1-4 touches the console server or HTML — doing those on raw `node:http` with a 2000-line inline HTML string is why we keep shipping broken code. the framework goes in first, then everything else is built on solid ground.

## why vike

- **SSR + SPA hybrid** — the console needs server-rendered pages (login, initial load) and client-side interactivity (capability cards, config editing, real-time status). vike does both.
- **file-based routing** — replaces the manual `if (url === '/api/health')` chain in `server.ts` with actual route files.
- **no framework lock-in** — vike is a "do-one-thing-well" Vite plugin, not a full framework. it handles routing and SSR; we pick the UI library (React, Solid, or just vanilla — our choice).
- **works with any server** — vike integrates with Express, Hono, Fastify, or raw Node. we can keep our existing `http.createServer` or switch to Hono (recommended for the middleware pattern we need for auth).
- **the 2000-line HTML string dies** — pages become actual `.tsx` files with proper components, CSS modules or Tailwind, and type-safe data loading.

## items

### 0.1 install vike + choose UI approach

**decision needed:** which UI library for the console pages?

options:
- **React** — most ecosystem support, the team knows it (kn-eng uses React). heavier bundle but irrelevant for an admin console.
- **Solid** — smaller bundle, similar API to React, vike has first-class support. less ecosystem.
- **vanilla (no library)** — vike supports plain HTML/JS pages. lightest weight but we lose component composition.

**recommendation:** React. the team already uses it in kn-eng's web-app. the console is an admin tool, not a public-facing app — bundle size doesn't matter. React's ecosystem (form libraries, component patterns) will save time in waves 1-4.

**install:**
```bash
cd packages/core
bun add vike vike-react react react-dom
bun add -D @types/react @types/react-dom @vitejs/plugin-react vite
```

### 0.2 set up vike project structure

```
packages/core/
  src/
    console/
      server.ts          ← keeps the http server, but delegates to vike for page rendering
      auth.ts            ← unchanged
    pages/               ← NEW: vike pages
      +Layout.tsx         ← shared layout (header, nav, footer)
      +Head.tsx           ← shared <head> (title, favicon, meta)
      +config.ts          ← vike config (SSR, data loading)
      login/
        +Page.tsx         ← Google sign-in page
      setup/
        +Page.tsx         ← welcome / Slack setup flow
        +data.ts          ← server-side data loading (check config store)
      console/
        +Page.tsx         ← main console (capability cards, config)
        +data.ts          ← load capabilities, health, compliance from API
      console/capability/
        @id/
          +Page.tsx       ← individual capability config page
          +data.ts        ← load capability details
    api/                  ← NEW: API routes (moved from inline server.ts)
      config.ts           ← GET/PUT/DELETE /api/config
      health.ts           ← GET /api/health
      capabilities.ts     ← GET/PUT /api/capabilities
      compliance.ts       ← GET /api/compliance
      reload.ts           ← POST /api/reload/slack, /api/reload/capabilities (wave 3)
```

### 0.3 migrate the login page

**what moves:**
- the inline HTML login page (currently a string literal in `server.ts`) becomes `pages/login/+Page.tsx`
- the Google OAuth sign-in flow stays the same (fetch POST to `/api/auth/sign-in/social`)
- better-auth routes (`/api/auth/*`) are handled by the auth middleware before vike

**acceptance:**
- [ ] `/login` renders the sign-in page via vike (SSR)
- [ ] clicking "sign in with Google" works (same flow as before)
- [ ] unauthenticated requests to `/` redirect to `/login`

### 0.4 migrate the setup flow

**what moves:**
- the welcome screen (Slack token inputs) becomes `pages/setup/+Page.tsx`
- the basics screen (model ID, admin user ID) becomes part of the same page or a step within it
- server-side data loading (`+data.ts`) checks the config store to determine which step to show

**acceptance:**
- [ ] first-time visit (no Slack tokens) → renders the setup page
- [ ] after saving Slack tokens → advances to basics
- [ ] after saving basics → redirects to the main console

### 0.5 migrate the main console

**what moves:**
- the capability cards, config table, compliance section, health display
- the 2000-line `html.ts` string becomes React components:
  - `CapabilityCard.tsx`
  - `ConfigTable.tsx`
  - `ComplianceSection.tsx`
  - `HealthFooter.tsx`
- data loading via `+data.ts` (calls the internal API routes)

**acceptance:**
- [ ] the main console renders with all sections
- [ ] capability cards are interactive (expand, save, validate)
- [ ] the design tokens (colors, spacing, typography) match the current design
- [ ] mobile responsive

### 0.6 migrate API routes out of server.ts

**what moves:**
- all the `if (method === 'GET' && routePath === '/api/config')` blocks move to dedicated route handlers
- `server.ts` becomes a thin shell: create http server → auth middleware → vike handler → API routes
- API routes are plain functions that receive parsed request data and return JSON

**acceptance:**
- [ ] `server.ts` is < 100 lines
- [ ] all API routes work as before
- [ ] auth middleware applies to all routes except public paths

### 0.7 delete `html.ts`

once all pages are migrated to vike components, delete `packages/core/src/console/html.ts` (the 2000-line string). it's replaced by the `pages/` directory.

**acceptance:**
- [ ] `html.ts` is deleted
- [ ] no inline HTML strings in `server.ts`
- [ ] the console looks and works the same as before (or better)

## dependency on other waves

wave 0 should be done BEFORE waves 1-4. every fix in those waves touches the console — doing them on the vike foundation means:
- wave 1 fixes (API 401, session handling) are cleaner with proper middleware
- wave 2 (capability UI) is built as React components, not string concatenation
- wave 3 (hot-reload) can use vike's HMR for the console UI itself
- wave 4 (HTTPS, docs) benefits from the cleaner architecture

## build / dev story

- **local dev:** `vite dev` (vike's dev server with HMR) — instant page reloads when editing console pages
- **production:** `vite build` produces static assets + SSR bundle. the Node server serves them. no separate build step for the console HTML.
- **Docker:** the Dockerfile runs `vite build` in the builder stage (alongside `tsc`). the runner stage serves the built assets.

## what does NOT change

- the Slack bot, agent loop, tools, scheduler, persistence — all unchanged
- the DynamoDB/SQLite persistence layer — unchanged
- the Pulumi component — unchanged
- the CLI (`tino init`, `tino deploy`) — unchanged
- better-auth integration — unchanged (just moved from inline to middleware)
