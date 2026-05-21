import fs from "node:fs";
import path from "node:path";
import type { LanguageModel } from "ai";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import type { AuditLogger } from "../audit/logger.js";
import type { CapabilityRegistry } from "../capabilities/types.js";
import type { IdentityStore, UserStore } from "../identity/store.js";
import type { ConfigStore } from "../persistence/config.js";
import type { SessionSecondaryStorage } from "../persistence/factory.js";
import type { AppLogger } from "../slack/app.js";
import { createGoogleCredentialResolver, createSlackCredentialResolver } from "../privacy/adapters/credentials.js";
import { createGoogleCalendarAdapter, createGoogleEmailAdapter } from "../privacy/adapters/google.js";
import { createMockCalendarAdapter, createMockEmailAdapter, createMockMessagingAdapter } from "../privacy/adapters/mock.js";
import { createSlackMessagingAdapter } from "../privacy/adapters/slack.js";
import type { PrivacyConfigStore } from "../privacy/config-store.js";
import { type AuthVariables, buildAuthMiddleware, createAuth } from "./middleware/auth.js";
import { privacyGate } from "./middleware/privacy-gate.js";
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
import { createGoogleOAuthRoutes } from "./routes/google-oauth.js";
import { createPrivacyRoutes } from "./routes/privacy.js";

/**
 * Tino console HTTP server — Hono app on top of `@hono/node-server`.
 *
 * Routing:
 *   /api/health              → public, ALB-friendly liveness
 *   /api/auth/*              → better-auth handler (public; auth lives here)
 *   /api/config*             → protected (auth-gated) config CRUD
 *   /api/capabilities*       → protected capability config
 *   /api/user-capabilities/* → protected per-user capability config
 *   /api/compliance          → protected HIPAA snapshot
 *   /api/users/:id           → protected user deprovisioning
 *   /api/reload/*            → protected hot-reload
 *   /api/admin/*             → protected admin ops (restart)
 *   /api/privacy/*           → protected privacy config
 *   /assets/*                → static (SPA + logo); also bypasses auth
 *   /*                       → serves the built React SPA (Vite output)
 */
export interface StartServerOptions {
  config: ConfigStore;
  logger: AppLogger;
  tools: Record<string, unknown>;
  registry?: CapabilityRegistry;
  port?: number;
  auditLogger?: AuditLogger;
  reconnectSlack?: () => Promise<{ ok: boolean; error?: string }>;
  reloadCapabilities?: () => Promise<{ ok: boolean; error?: string }>;
  shutdown?: (signal: string) => Promise<void> | void;
  sessionStore?: SessionSecondaryStorage;
  identities?: IdentityStore;
  users?: UserStore;
  privacyConfigStore?: PrivacyConfigStore;
  userCapabilities?: import("../persistence/user-capabilities.js").UserCapabilityStore;
  model?: LanguageModel;
  mockPrivacy?: boolean;
}

export interface StartedServer {
  server: ServerType;
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
    privacyConfigStore,
    userCapabilities,
    model,
    mockPrivacy,
  } = opts;
  const port = opts.port ?? 3001;
  const startTime = Date.now();

  // ── Auth setup ────────────────────────────────────────────────────────────
  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const allowedDomain = process.env.CONSOLE_ALLOWED_DOMAIN;
  const baseUrl = process.env.CONSOLE_BASE_URL ?? `http://localhost:${port}`;
  const isLocalDev = baseUrl.startsWith("http://localhost");
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
        emailPassword: isLocalDev,
      });
      logger.info({ baseUrl, allowedDomain, authEnabled: true }, "console auth: Google OAuth enabled");
    } catch (err) {
      logger.error({ err: (err as Error).message }, "console auth: failed to initialize — running without auth");
    }
  } else if (isLocalDev) {
    try {
      auth = await createAuth({
        allowedDomain,
        baseUrl,
        dbPath: "/tmp/tino-auth.db",
        logger,
        emailPassword: true,
      });
      logger.info({ baseUrl }, "console auth: email/password enabled (localhost)");
    } catch (err) {
      logger.error({ err: (err as Error).message }, "console auth: failed to initialize — running without auth");
    }
  } else {
    logger.info({ authEnabled: false }, "console auth: disabled (no GOOGLE_OAUTH_CLIENT_ID)");
  }

  // ── Build the Hono app ────────────────────────────────────────────────────
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("*", buildAuthMiddleware({ auth, allowedDomain, logger, identities, users, configStore: config, localDev: isLocalDev }));

  if (privacyConfigStore) {
    app.use("*", privacyGate({ privacyConfigStore }));
  }

  // ── /api/auth/* — better-auth handler ─────────────────────────────────────
  if (auth) {
    app.all("/api/auth/*", async (c: Context) => {
      const res = await auth.handler(c.req.raw);
      return res;
    });
  }

  // ── /api/me ───────────────────────────────────────────────────────────────
  app.get("/api/me", (c) => {
    const user = c.get("user");
    if (!user) return c.json(null);
    return c.json(user);
  });

  // ── API routes ────────────────────────────────────────────────────────────
  app.route("/api/health", createHealthRoutes({ startTime, tools, registry }));
  app.route("/api/config", createConfigRoutes({ config, logger, auditLogger }));
  app.route("/api/capabilities", createCapabilityRoutes({ config, logger }));
  app.route("/api/user-capabilities", createUserCapabilityRoutes({ config, logger, auditLogger, userCapabilities }));
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
  app.route("/api/oauth/google", createGoogleOAuthRoutes({
    config,
    userCapabilities,
    logger,
    auditLogger,
    baseUrl,
  }));

  if (privacyConfigStore) {
    let email, calendar, messaging;

    if (mockPrivacy) {
      logger.info("privacy adapters: using mock data");
      email = createMockEmailAdapter();
      calendar = createMockCalendarAdapter();
      messaging = createMockMessagingAdapter();
    } else {
      const googleCreds = createGoogleCredentialResolver({ userCapabilities, configStore: config });
      const slackCreds = createSlackCredentialResolver({ userCapabilities, configStore: config });
      email = createGoogleEmailAdapter({ resolveCreds: googleCreds, logger });
      calendar = createGoogleCalendarAdapter({ resolveCreds: googleCreds, logger });
      messaging = createSlackMessagingAdapter({ resolveCreds: slackCreds, logger });
    }

    app.route("/api/privacy", createPrivacyRoutes({
      privacyConfigStore,
      logger,
      userCapabilities,
      configStore: config,
      email,
      calendar,
      messaging,
      model,
      mockMode: mockPrivacy,
    }));
  }

  // ── Logo asset ────────────────────────────────────────────────────────────
  app.get("/assets/tino-logo.png", (c) => {
    const candidates = [
      "/app/assets/tino-logo.png",
      new URL("../../assets/tino-logo.png", import.meta.url),
      new URL("../../../../assets/tino-logo.png", import.meta.url),
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

  // ── Static React SPA ─────────────────────────────────────────────────────
  const consoleDir = resolveConsoleDir();
  const indexHtmlPath = path.join(consoleDir, "index.html");
  let indexHtml: string | null = null;
  try {
    indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
  } catch {
    logger.warn({ indexHtmlPath }, "console SPA index.html not found — run `vite build` to produce it");
  }

  app.use(
    "/*",
    serveStatic({
      root: path.relative(process.cwd(), consoleDir) || ".",
    }),
  );

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
  const hostname = process.env.CONSOLE_BASE_URL ? "0.0.0.0" : "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    logger.info({ port, host: hostname }, "config console listening");
  });

  return {
    server,
    close: () => server.close(),
  };
}

function resolveConsoleDir(): string {
  const here = new URL(".", import.meta.url).pathname;
  if (here.includes(`${path.sep}dist${path.sep}`) || here.includes("/dist/")) {
    return path.resolve(here, "../console");
  }
  return path.resolve(here, "../../dist/console");
}
