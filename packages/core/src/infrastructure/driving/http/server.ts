import fs from "node:fs";
import path from "node:path";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import type { Assistant } from "../../../ports/inbound.js";
import type {
  ConfigStore,
  IdentityStore,
  Logger,
  SessionSecondaryStorage,
  UserCapabilityStore,
  UserStore,
} from "../../../ports/outbound.js";
import { type AuthVariables, buildAuthMiddleware, createAuth } from "./auth.js";
import { createChatRoutes } from "./routes/chat.js";
import { createConfigRoutes } from "./routes/config.js";
import { createGoogleOAuthRoutes } from "./routes/google-oauth.js";
import { createHealthRoutes } from "./routes/health.js";
import { createReloadRoutes } from "./routes/reload.js";

/**
 * Tino console HTTP server — Hono on `@hono/node-server`.
 *
 * Routing:
 *   /api/health        → public liveness
 *   /api/auth/*        → better-auth handler (auth lives here)
 *   /api/me            → the signed-in tino user
 *   /api/config*       → auth-gated config CRUD (Slack/Azure/Google keys)
 *   /api/oauth/google  → connect Google (per-user)
 *   /api/reload/slack  → reconnect Slack with the latest config
 *   /api/chat          → message Tino from the browser
 *   /*                 → the built React SPA (Login / Setup / Chat)
 */
export interface StartServerOptions {
  config: ConfigStore;
  logger: Logger;
  port?: number;
  reconnectSlack?: () => Promise<{ ok: boolean; error?: string }>;
  shutdown?: (signal: string) => Promise<void> | void;
  sessionStore?: SessionSecondaryStorage;
  identities?: IdentityStore;
  users?: UserStore;
  userCapabilities?: UserCapabilityStore;
  /** The assistant port — powers the web chat box. */
  assistant: Assistant;
}

export interface StartedServer {
  server: ServerType;
  close: () => void;
}

export async function startServer(opts: StartServerOptions): Promise<StartedServer> {
  const { config, logger, reconnectSlack, sessionStore, identities, users, userCapabilities, assistant } = opts;
  const port = opts.port ?? 3001;
  const startTime = Date.now();

  // ── Auth setup ────────────────────────────────────────────────────────────
  const allowedDomain = process.env.CONSOLE_ALLOWED_DOMAIN;
  const baseUrl = process.env.CONSOLE_BASE_URL ?? `http://localhost:${port}`;
  const isLocalDev = baseUrl.startsWith("http://localhost");
  const hasGoogleCreds = !!(
    (await config.getTyped<string>("google.oauth.clientId", "")) || process.env.GOOGLE_OAUTH_CLIENT_ID
  );
  const canSignIn = hasGoogleCreds || isLocalDev;

  let initialAuth: Awaited<ReturnType<typeof createAuth>> | null = null;
  if (canSignIn) {
    try {
      initialAuth = await createAuth({
        config,
        googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        allowedDomain,
        baseUrl,
        dbPath: process.env.AUTH_DB_PATH ?? "/tmp/tino-auth.db",
        logger,
        sessionStore,
        emailPassword: isLocalDev,
      });
      logger.info({ baseUrl, google: hasGoogleCreds }, "console auth enabled");
    } catch (err) {
      logger.error({ err: (err as Error).message }, "console auth failed to initialize — running without auth");
    }
  } else {
    logger.info("console auth: no sign-in method configured — console accessible without auth");
  }

  const authRef = { current: initialAuth };

  async function reloadAuth(): Promise<{ ok: boolean; error?: string }> {
    try {
      authRef.current = await createAuth({
        config,
        googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        allowedDomain,
        baseUrl,
        dbPath: process.env.AUTH_DB_PATH ?? "/tmp/tino-auth.db",
        logger,
        sessionStore,
        emailPassword: isLocalDev,
      });
      logger.info("auth reloaded from config store");
      return { ok: true };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ err: msg }, "auth reload failed");
      return { ok: false, error: msg };
    }
  }

  // ── Build the Hono app ────────────────────────────────────────────────────
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use(
    "*",
    buildAuthMiddleware({
      authRef,
      allowedDomain,
      logger,
      identities,
      users,
      configStore: config,
      userCapabilities,
      authDbPath: process.env.AUTH_DB_PATH ?? "/tmp/tino-auth.db",
      localDev: isLocalDev,
    }),
  );

  app.all("/api/auth/*", async (c: Context) => {
    const auth = authRef.current;
    if (!auth) return c.json({ error: "auth not configured" }, 503);
    return auth.handler(c.req.raw);
  });

  app.get("/api/me", (c) => c.json(c.get("user") ?? null));

  app.route("/api/health", createHealthRoutes({ startTime, isAuthConfigured: () => !!authRef.current }));
  app.route("/api/config", createConfigRoutes({ config, logger }));
  app.route("/api/chat", createChatRoutes({ assistant, logger }));
  app.route(
    "/api/reload",
    createReloadRoutes({ reconnectSlack, reloadAuth, isAuthConfigured: () => !!authRef.current, logger }),
  );
  app.route("/api/oauth/google", createGoogleOAuthRoutes({ config, userCapabilities, logger, baseUrl }));

  // ── Logo asset ────────────────────────────────────────────────────────────
  app.get("/assets/tino-logo.png", (c) => {
    const candidates = [
      "/app/assets/tino-logo.png",
      path.join(packageRoot(), "assets", "tino-logo.png"),
      `${process.cwd()}/assets/tino-logo.png`,
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

  // ── Static React SPA ──────────────────────────────────────────────────────
  const consoleDir = resolveConsoleDir();
  let indexHtml: string | null = null;
  try {
    indexHtml = fs.readFileSync(path.join(consoleDir, "index.html"), "utf8");
  } catch {
    logger.warn({ consoleDir }, "console SPA index.html not found — run `vite build`");
  }

  app.use("/*", serveStatic({ root: path.relative(process.cwd(), consoleDir) || "." }));
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.text("Not found", 404);
    if (!indexHtml) return c.text("Console SPA not built — run `vite build` in packages/core", 503);
    return c.html(indexHtml);
  });

  const hostname = process.env.CONSOLE_BASE_URL ? "0.0.0.0" : "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    logger.info({ port, host: hostname }, "console listening");
  });

  return { server, close: () => server.close() };
}

/**
 * The @tino/core package root, derived by splitting this file's path at the
 * `/src/` (dev) or `/dist/` (built) boundary — robust to however deep in the
 * layer tree this adapter sits.
 */
function packageRoot(): string {
  const here = new URL(".", import.meta.url).pathname;
  const marker = here.includes("/dist/") ? "/dist/" : "/src/";
  return here.slice(0, here.indexOf(marker));
}

function resolveConsoleDir(): string {
  // The console SPA is always built to <packageRoot>/dist/console.
  return path.join(packageRoot(), "dist", "console");
}
