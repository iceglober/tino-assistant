/**
 * The HTTP server — Hono on `@hono/node-server`.
 *
 *   /api/health              → public liveness
 *   /api/auth/*              → better-auth (accounts, sessions, email verification)
 *   /api/platform, /api/me   → platform info; the account and its orgs
 *   /api/orgs                → create an org, check a slug, join by domain
 *   /api/orgs/:slug/*        → everything inside an org (members only; see orgScope)
 *   /api/oauth/*             → OAuth callbacks shared by every org
 *   /slack/events[/:orgId]   → Slack Events API
 *   /*                       → the web app (apps/web/dist), SPA fallback
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { PlatformInfo } from "@tino/contracts";
import type { Logger } from "@tino/core/ports/outbound";
import type { Auth } from "better-auth";
import { Hono } from "hono";
import type { OrgRegistry } from "../../../bootstrap/org-registry.js";
import type { McpClientPool } from "../../driven/mcp/client-pool.js";
import type { Persistence } from "../../driven/persistence/postgres/index.js";
import { type AccountVariables, type AuthVariables, orgScope, sessionMiddleware } from "./auth.js";
import { createChatRoutes } from "./routes/chat.js";
import { type ConnectionDeps, createOAuthCallbackRoutes, createOrgConnectionRoutes } from "./routes/connections.js";
import { createHealthRoutes } from "./routes/health.js";
import { createKbRoutes } from "./routes/kb.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createOrgRoutes } from "./routes/org.js";
import { createPlatformRoutes } from "./routes/platform.js";
import { createSlackEventRoutes } from "./routes/slack-events.js";
import { createUserRoutes } from "./routes/users.js";

export interface ServerOptions {
  auth: Auth;
  persistence: Persistence;
  registry: OrgRegistry;
  connections: Omit<ConnectionDeps, "runtime" | "refresh" | "orgs" | "logger">;
  platformInfo: () => PlatformInfo;
  platformSigningSecret?: string;
  mcpPool: McpClientPool;
  /** Local dev: unverified emails may create orgs, join and accept invites. */
  trustUnverified: boolean;
  /** Whether this address may create orgs (closed beta). */
  canCreateOrg: (email: string) => boolean;
  onInvite?: Parameters<typeof createUserRoutes>[0]["onInvite"];
  logger: Logger;
}

export function createHttpApp(opts: ServerOptions): Hono<{ Variables: AccountVariables }> {
  const { auth, persistence, registry, logger } = opts;
  const app = new Hono<{ Variables: AccountVariables }>();

  app.route("/api/health", createHealthRoutes({ startTime: Date.now() }));
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.use("/api/*", sessionMiddleware(auth));

  app.route(
    "/api",
    createPlatformRoutes({
      persistence,
      info: opts.platformInfo,
      trustUnverified: opts.trustUnverified,
      canCreateOrg: opts.canCreateOrg,
      logger,
    }),
  );

  const connectionDeps: ConnectionDeps = {
    ...opts.connections,
    orgs: persistence.orgs,
    runtime: (orgId) => registry.get(orgId),
    refresh: (orgId) => registry.refresh(orgId),
    logger,
  };
  app.route("/api/oauth", createOAuthCallbackRoutes(connectionDeps));

  const org = new Hono<{ Variables: AuthVariables }>();
  org.use(
    "*",
    orgScope({ runtimeBySlug: (slug) => registry.bySlug(slug), trustUnverified: opts.trustUnverified, logger }),
  );
  org.route("/", createOrgRoutes({ logger }));
  org.route("/", createOrgConnectionRoutes(connectionDeps));
  org.route("/users", createUserRoutes({ logger, onInvite: opts.onInvite }));
  org.route("/mcp", createMcpRoutes({ pool: opts.mcpPool, logger }));
  org.route("/chat", createChatRoutes({ logger }));
  org.route(
    "/kb",
    createKbRoutes(
      (c) => c.get("org").kb()?.routes,
      async (c) => (await c.get("org").status()).kb.reason,
    ),
  );
  app.route("/api/orgs/:slug", org as unknown as Hono<{ Variables: AccountVariables }>);

  app.route(
    "/slack",
    createSlackEventRoutes({
      runtime: (orgId) => registry.get(orgId),
      orgs: persistence.orgs,
      platformSigningSecret: opts.platformSigningSecret,
      logger,
    }),
  );

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  return app;
}

/** Serve the built web app with an SPA fallback, then listen. */
export function startServer(
  app: Hono<{ Variables: AccountVariables }>,
  opts: { port: number; hostname: string; webDir?: string; logger: Logger },
): { server: ServerType; close: () => void } {
  const webDir = opts.webDir ?? defaultWebDir();
  let indexHtml: string | null = null;
  try {
    indexHtml = fs.readFileSync(path.join(webDir, "index.html"), "utf8");
  } catch {
    opts.logger.warn({ webDir }, "web app not built — run `bun run build` (the API still works)");
  }
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDir) || "." }));
  app.get("*", (c) => (indexHtml ? c.html(indexHtml) : c.text("Web app not built — run `bun run build`.", 503)));

  const server = serve({ fetch: app.fetch, port: opts.port, hostname: opts.hostname }, () => {
    opts.logger.info({ port: opts.port, host: opts.hostname }, "listening");
  });
  return { server, close: () => server.close() };
}

/** apps/web/dist/client (React Router SPA build), relative to this file. */
function defaultWebDir(): string {
  return process.env.WEB_DIST ?? fileURLToPath(new URL("../../../../../web/dist/client", import.meta.url));
}
