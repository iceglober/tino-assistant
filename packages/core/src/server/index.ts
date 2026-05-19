import fs from "node:fs";
import path from "node:path";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import type { AuditLogger } from "../audit/logger.js";
import type { CapabilityRegistry } from "../capabilities/types.js";
import type { IdentityStore, UserStore } from "../identity/store.js";
import type { ConfigStore } from "../persistence/config.js";
import type { SessionSecondaryStorage } from "../persistence/factory.js";
import type { AppLogger } from "../slack/app.js";
import { type AuthVariables, buildAuthMiddleware, createAuth } from "./middleware/auth.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createBedrockRoutes } from "./routes/bedrock.js";
import { createCapabilityRoutes } from "./routes/capabilities.js";
import { createComplianceRoutes } from "./routes/compliance.js";
import { createConfigRoutes } from "./routes/config.js";
import { createHealthRoutes } from "./routes/health.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createInstructionRoutes } from "./routes/instructions.js";
import { createOrgConfigRoutes } from "./routes/org-config.js";
import { createReloadRoutes } from "./routes/reload.js";
import { createUsersRoutes } from "./routes/users.js";
import { createUserCapabilityRoutes } from "./routes/user-capabilities.js";

/**
 * Tino console HTTP server — Hono app on top of `@hono/node-server`.
 *
 * Replaces the previous raw `node:http` server in `console/server.ts`.
 *
 * Routing:
 *   /api/health              → public, ALB-friendly liveness
 *   /api/auth/*              → better-auth handler (public; auth lives here)
 *   /api/config*             → protected (auth-gated) config CRUD
 *   /api/capabilities*       → protected capability config
 *   /api/user-capabilities/* → protected per-user capability config (wave 2)
 *   /api/compliance          → protected HIPAA snapshot
 *   /api/users/:id           → protected user deprovisioning
 *   /api/reload/*            → protected hot-reload (wave 3)
 *   /api/admin/*             → protected admin ops (restart — wave 3.4)
 *   /assets/*                → static (SPA + logo); also bypasses auth
 *   /*                       → serves the built React SPA (Vite output)
 *
 * Auth:
 *   - `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` set → Google OAuth via better-auth
 *   - either missing → auth disabled (local dev)
 *   - `CONSOLE_ALLOWED_DOMAIN` optionally restricts sessions to a specific email domain
 *
 * Production binds to `0.0.0.0` (ALB-reachable) when `CONSOLE_BASE_URL` is set;
 * dev binds to `127.0.0.1`.
 */
export interface StartServerOptions {
  config: ConfigStore;
  logger: AppLogger;
  tools: Record<string, unknown>;
  registry?: CapabilityRegistry;
  port?: number;
  auditLogger?: AuditLogger;
  /**
   * Wave 3.1 — invoked by `POST /api/reload/slack`. Reads the latest Slack
   * tokens from the config store and reconnects the Slack app in place.
   */
  reconnectSlack?: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Wave 3.2 — invoked by `POST /api/reload/capabilities`. Re-runs the
   * capability registry against the live config store and atomically swaps
   * the toolset.
   */
  reloadCapabilities?: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Wave 3.4 — invoked by `POST /api/admin/restart`. Should run the same
   * teardown as the SIGTERM handler before `process.exit`. The route sends
   * its 202 response BEFORE invoking this callback (deferred ~100ms) so the
   * client sees the ack.
   */
  shutdown?: (signal: string) => Promise<void> | void;
  /**
   * Wave 3 — DynamoDB-backed session store for better-auth's secondaryStorage.
   * When provided, sessions survive ECS restarts. Omit for local dev (SQLite).
   */
  sessionStore?: SessionSecondaryStorage;
  /**
   * Wave 3 — identity + user stores for auth middleware tino-UUID resolution.
   * The middleware resolves the better-auth session email to a tino-UUID via
   * the identity store, then loads role/status from the user store.
   */
  identities?: IdentityStore;
  users?: UserStore;
}

export interface StartedServer {
  /** Underlying Node HTTP server — `.close()` shuts it down. */
  server: ServerType;
  /** Convenience close that mirrors the old `consoleServer.close()` callsite. */
  close: () => void;
}

export async function startServer(opts: StartServerOptions): Promise<StartedServer> {
  const {
    config,
    logger,
    tools,
    registry,
    auditLogger,
    reconnectSlack,
    reloadCapabilities,
    shutdown,
    sessionStore,
    identities,
    users,
  } = opts;
  const port = opts.port ?? 3001;
  const startTime = Date.now();

  // ── Auth setup ────────────────────────────────────────────────────────────
  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const allowedDomain = process.env.CONSOLE_ALLOWED_DOMAIN;
  const baseUrl = process.env.CONSOLE_BASE_URL ?? `http://localhost:${port}`;
  const authEnabled = !!(googleClientId && googleClientSecret);

  let auth: Awaited<ReturnType<typeof createAuth>> | null = null;

  if (authEnabled) {
    try {
      auth = await createAuth({
        // biome-ignore lint/style/noNonNullAssertion: authEnabled narrows these to non-null
        googleClientId: googleClientId!,
        // biome-ignore lint/style/noNonNullAssertion: authEnabled narrows these to non-null
        googleClientSecret: googleClientSecret!,
        allowedDomain,
        baseUrl,
        dbPath: "/tmp/tino-auth.db",
        logger,
        sessionStore,
      });
      logger.info({ baseUrl, allowedDomain, authEnabled: true }, "console auth: Google OAuth enabled");
    } catch (err) {
      logger.error({ err: (err as Error).message }, "console auth: failed to initialize — running without auth");
    }
  } else {
    logger.info({ authEnabled: false }, "console auth: disabled (no GOOGLE_OAUTH_CLIENT_ID)");
  }

  // ── Build the Hono app ────────────────────────────────────────────────────
  const app = new Hono<{ Variables: AuthVariables }>();

  // Auth-gate everything (the middleware itself permits `/api/auth/*`,
  // `/api/health`, and `/assets/*` to bypass).
  app.use("*", buildAuthMiddleware({ auth, allowedDomain, logger, identities, users, configStore: config }));

  // ── /api/auth/* — better-auth handler ─────────────────────────────────────
  // better-auth ships a fetch-style handler at `auth.handler`. Hono's `c.req.raw`
  // is a `Request` and `c.body` accepts a `Response`, so this is a one-line wire-up.
  if (auth) {
    app.all("/api/auth/*", async (c: Context) => {
      const res = await auth.handler(c.req.raw);
      return res;
    });
  } else {
    // Auth disabled: return a stub so the React app's `/api/auth/get-session`
    // probe gets a deterministic null instead of a 404 that looks like an error.
    app.get("/api/auth/get-session", (c) => c.json(null));
  }

  // ── Public + protected API routes ─────────────────────────────────────────
  app.route("/api/health", createHealthRoutes({ startTime, tools, registry }));
  app.route("/api/config", createConfigRoutes({ config, logger, auditLogger }));
  app.route("/api/capabilities", createCapabilityRoutes({ config, logger }));
  app.route("/api/user-capabilities", createUserCapabilityRoutes({ config, logger, auditLogger }));
  app.route("/api/compliance", createComplianceRoutes({ config, auditLogger }));
  app.route("/api/users", createUsersRoutes({ config, logger, auditLogger }));
  if (identities && users) {
    app.route("/api/org", createOrgConfigRoutes({ config, users, identities, logger, auditLogger }));
  }
  if (auditLogger) {
    app.route("/api/audit", createAuditRoutes({ auditLogger, logger }));
  }
  app.route("/api/instructions", createInstructionRoutes({ config, logger }));
  app.route("/api/reload", createReloadRoutes({ reconnectSlack, reloadCapabilities, logger, auditLogger }));
  if (shutdown) {
    app.route("/api/admin", createAdminRoutes({ logger, auditLogger, shutdown }));
  }
  app.route("/api/bedrock", createBedrockRoutes({ logger }));

  // ── Logo asset (preserve the old multi-path lookup) ───────────────────────
  // The Dockerfile pins `WORKDIR /app` and copies `assets/` into the image,
  // so `/app/assets/tino-logo.png` is the canonical container path. Try that
  // first; fall back to the `import.meta.url`-relative paths for local dev
  // and the cwd-relative path for `tsx`-from-repo-root style runs.
  app.get("/assets/tino-logo.png", (c) => {
    const candidates = [
      // Production (Docker): WORKDIR /app + COPY assets ./assets — gap #13.
      "/app/assets/tino-logo.png",
      // Local dev (built): dist/server/index.js → ../../assets/tino-logo.png
      new URL("../../assets/tino-logo.png", import.meta.url),
      // Workspace root from package: packages/core/src/server/index.ts
      new URL("../../../../assets/tino-logo.png", import.meta.url),
      // Last-resort cwd lookup.
      new URL(`file://${process.cwd()}/assets/tino-logo.png`),
    ];
    for (const logoPath of candidates) {
      try {
        const data = fs.readFileSync(logoPath);
        c.header("Content-Type", "image/png");
        c.header("Cache-Control", "public, max-age=86400");
        return c.body(data as unknown as ArrayBuffer);
      } catch {}
    }
    return c.text("Logo not found", 404);
  });

  // ── Static React SPA (built by Vite to dist/console) ──────────────────────
  // Resolve once at startup so the path is deterministic regardless of cwd.
  // `import.meta.url` points at dist/server/index.js in production; the SPA
  // build sits at dist/console/ — three levels up + console.
  const consoleDir = resolveConsoleDir();
  const indexHtmlPath = path.join(consoleDir, "index.html");
  let indexHtml: string | null = null;
  try {
    indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
  } catch {
    logger.warn({ indexHtmlPath }, "console SPA index.html not found — run `vite build` to produce it");
  }

  // Static-file serving for SPA assets (JS, CSS, images Vite emits).
  // serveStatic resolves paths relative to process.cwd, so we pass the absolute path.
  app.use(
    "/*",
    serveStatic({
      root: path.relative(process.cwd(), consoleDir) || ".",
    }),
  );

  // SPA fallback: any non-API GET that didn't hit a file falls back to index.html.
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.text("Not found", 404);
    }
    if (!indexHtml) {
      return c.text("Console SPA not built — run `vite build` in packages/core", 503);
    }
    return c.html(indexHtml);
  });

  // ── Bind ──────────────────────────────────────────────────────────────────
  // Production: bind 0.0.0.0 so the ALB can reach the container.
  // Dev: bind 127.0.0.1.
  const hostname = process.env.CONSOLE_BASE_URL ? "0.0.0.0" : "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    logger.info({ port, host: hostname }, "config console listening");
  });

  return {
    server,
    close: () => server.close(),
  };
}

/**
 * Resolve the directory containing the built React SPA (`dist/console/`).
 *
 * In production (`node dist/server/index.js`), `import.meta.url` resolves to
 * `dist/server/index.js` and the SPA lives at `../console/`.
 *
 * In `tsx` dev (`tsx src/server/index.ts`), `import.meta.url` resolves to
 * `src/server/index.ts`. Vite's dev server is the source of truth in that mode;
 * we still return a path here, but `index.html` will simply not exist and the
 * fallback handler reports a friendly error.
 */
function resolveConsoleDir(): string {
  // .../dist/server/index.js → .../dist/console/
  // .../src/server/index.ts  → .../src/console-app/  (only used as a probe)
  const here = new URL(".", import.meta.url).pathname;
  // Distinguish dist vs src by path segment.
  if (here.includes(`${path.sep}dist${path.sep}`) || here.includes("/dist/")) {
    return path.resolve(here, "../console");
  }
  return path.resolve(here, "../../dist/console");
}
