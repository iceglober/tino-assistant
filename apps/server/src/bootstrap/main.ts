/**
 * Composition root for the managed service. Wires the platform once — database,
 * encryption, accounts, the org registry, the HTTP server — and leaves
 * everything org-specific to the per-org runtimes the registry builds.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import type { PlatformInfo } from "@tino/contracts";
import { covers } from "@tino/core/domain/oauth-clients";
import { baseUrlOf, isProduction, loadEnv, orgCreatorPolicy, platformClients } from "../env.js";
import { createCryptoAdapter } from "../infrastructure/driven/crypto/factory.js";
import { createEmailSender } from "../infrastructure/driven/email/sender.js";
import {
  createOpenAiEmbedder,
  createVertexEmbedder,
  type NamedEmbedder,
} from "../infrastructure/driven/kb/embedders.js";
import { createMcpClientPool } from "../infrastructure/driven/mcp/client-pool.js";
import type { ClientCapability } from "../infrastructure/driven/oauth/org-clients.js";
import { createDb } from "../infrastructure/driven/persistence/db.js";
import { createPersistence } from "../infrastructure/driven/persistence/postgres/index.js";
import { buildAuthOptions, createAuth, migrateAuth } from "../infrastructure/driving/http/auth.js";
import { slackConnectLink } from "../infrastructure/driving/http/routes/connections.js";
import { createHttpApp, startServer } from "../infrastructure/driving/http/server.js";
import { createSignedState } from "../infrastructure/security/signed-state.js";
import { createLogger } from "../logging.js";
import { createOrgRegistry } from "./org-registry.js";

const env = loadEnv();
const logger = createLogger(env);
const baseUrl = baseUrlOf(env);
const production = isProduction(env);

if (!production && !env.ENCRYPTION_KEY)
  logger.warn("ENCRYPTION_KEY unset — using the dev key (fine for local data only)");
const cryptoAdapter = createCryptoAdapter(env);
const pool = await createDb({ databaseUrl: env.DATABASE_URL, pgliteDir: env.PGLITE_DIR });
if (!env.DATABASE_URL) logger.info({ dir: env.PGLITE_DIR }, "using PGlite (local dev database)");

// Sessions and OAuth state are signed with AUTH_SECRET; in dev, a stable key
// derived from the encryption key keeps sessions across restarts.
const authSecret =
  env.AUTH_SECRET ??
  createHash("sha256")
    .update(`tino-dev-auth:${env.ENCRYPTION_KEY ?? "dev"}`)
    .digest("hex");
const signedState = createSignedState(authSecret);
const clients = platformClients(env);
const email = createEmailSender({ resendApiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, logger });

// Accounts, orgs, members and invitations are better-auth's; its tables come
// first because tino's reference them.
const authOptions = buildAuthOptions({
  baseUrl,
  secret: authSecret,
  database: pool,
  email,
  requireEmailVerification: production,
  googleSignIn: clients.google
    ? { clientId: clients.google.clientId, clientSecret: clients.google.clientSecret }
    : undefined,
  canCreateOrg: orgCreatorPolicy(env),
  trustedOrigins: production ? [] : ["http://localhost:5173"],
  logger,
});
await migrateAuth(authOptions);
const persistence = await createPersistence(pool, logger, cryptoAdapter);
const auth = createAuth(authOptions, logger);

const platformEmbedder: NamedEmbedder | null = env.PLATFORM_OPENAI_API_KEY
  ? createOpenAiEmbedder(env.PLATFORM_OPENAI_API_KEY)
  : env.GOOGLE_VERTEX_PROJECT
    ? createVertexEmbedder({ project: env.GOOGLE_VERTEX_PROJECT, location: env.GOOGLE_VERTEX_LOCATION })
    : null;

/** People connected through tino's own Google client, across orgs — what a pilot cap counts. */
async function platformUsers(capability: ClientCapability): Promise<number> {
  const capabilityId =
    capability === "google.calendar" ? "calendar" : capability === "google.gmail" ? "gmail" : "slack";
  const res = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM user_capability
     WHERE capability_id = $1 AND settings_json->'client'->>'owner' = 'platform'`,
    [capabilityId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

const mcpPool = createMcpClientPool({ logger });
const registry = createOrgRegistry(
  persistence,
  {
    pool,
    logger,
    baseUrl,
    mcpPool,
    platformClients: clients,
    platformEmbedder,
    platformUsers,
    kbAvailable: persistence.kbAvailable && env.KB_ENABLED === "1",
    slackConnectLink: (orgId, userId) => slackConnectLink(signedState, baseUrl, orgId, userId),
  },
  logger,
);

const platformInfo = (): PlatformInfo => {
  const g = clients.google;
  return {
    baseUrl,
    signups: env.SIGNUPS,
    signIn: { email: true, google: !!g },
    emailVerification: production,
    managed: {
      google: {
        calendar: !!g && (covers(g.approval, "verified") || !!g.pilot),
        gmail: !!g && (covers(g.approval, "assessed") || !!g.pilot),
        pilot: !!g?.pilot && !covers(g.approval, "assessed"),
      },
      slack: !!clients.slack && covers(clients.slack.approval, "assessed"),
    },
    platformEmbeddings: platformEmbedder !== null,
  };
};

const app = createHttpApp({
  auth,
  persistence,
  registry,
  connections: { baseUrl, state: signedState, platformClients: clients },
  platformInfo,
  platformSigningSecret: env.PLATFORM_SLACK_SIGNING_SECRET,
  mcpPool,
  trustUnverified: !production,
  canCreateOrg: orgCreatorPolicy(env),
  logger,
});

await registry.warmAll();
registry.startScheduler();
const http = startServer(app, { port: env.PORT, hostname: env.BASE_URL ? "0.0.0.0" : "127.0.0.1", logger });
logger.info({ baseUrl, managedGoogle: !!clients.google, managedSlack: !!clients.slack }, "tino platform up");

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "tino stopping");
  http.close();
  await registry.stop();
  await mcpPool.closeAll();
  await pool.end().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
