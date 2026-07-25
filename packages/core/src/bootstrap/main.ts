import "dotenv/config";
import crypto from "node:crypto";
import { WebClient } from "@slack/web-api";
import type { ToolSet } from "ai";
import { createAssistant } from "../application/assistant.js";
import { createKbIndexer, type KbIndexer } from "../application/kb-indexer.js";
import { createSenderResolver } from "../application/sender.js";
import { loadEnv } from "../env.js";
import { createPgKnowledgeStore } from "../infrastructure/driven/kb/pg-store.js";
import { ensureKbSchema } from "../infrastructure/driven/kb/schema.js";
import { createGmailKbSource } from "../infrastructure/driven/kb/sources/gmail.js";
import { createSlackKbSource } from "../infrastructure/driven/kb/sources/slack.js";
import { createVertexEmbedder } from "../infrastructure/driven/kb/vertex-embedder.js";
import { buildKbTools } from "../infrastructure/driven/tools/kb.js";
import { buildChatModel, resolveModelConfig } from "../infrastructure/driven/model/index.js";
import { createCryptoAdapter } from "../infrastructure/driven/crypto/factory.js";
import { createIdentityResolver } from "../infrastructure/driven/identity/resolver.js";
import { createPersistence } from "../infrastructure/driven/persistence/factory.js";
import { buildGoogleTools } from "../infrastructure/driven/tools/google.js";
import { buildSlackTools } from "../infrastructure/driven/tools/slack.js";
import { buildSlackUserTools } from "../infrastructure/driven/tools/slack-user.js";
import { createToolProvider } from "../infrastructure/driven/tools/provider.js";
import { createSlackApp } from "../infrastructure/driving/slack/slack.js";
import { startServer } from "../infrastructure/driving/http/server.js";
import { createConnectTokens } from "../infrastructure/security/connect-token.js";
import { createLogger } from "../logging.js";
import type { Assistant, SenderResolver } from "../ports/inbound.js";
import type { ChatModel } from "../ports/outbound.js";

const env = loadEnv();
const logger = createLogger(env);

// Crypto adapter — encrypts per-user Google credentials in the capability store.
const cryptoAdapter = await createCryptoAdapter(env);

const { history, config, users, identities, userCapabilities, authDatabase, getGoogleRefreshToken, pgPool } =
  await createPersistence(env, logger, cryptoAdapter);

const port = env.PORT ?? 3001;

function parseConfigValue(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
}

const baseUrl = process.env.CONSOLE_BASE_URL ?? `http://localhost:${port}`;

// Connect-token signer for the bot-DM'd Slack OAuth link. Uses a dedicated
// secret persisted to the config store so it survives restarts and doesn't
// depend on better-auth's init timing.
let connectSecret = parseConfigValue(await config.get("connect.secret")) ?? process.env.CONNECT_SECRET;
if (!connectSecret) {
  connectSecret = crypto.randomBytes(32).toString("hex");
  await config.set("connect.secret", connectSecret);
}
const connectTokens = createConnectTokens(connectSecret);
const slackConnectLink = (userId: string): string =>
  `${baseUrl}/api/oauth/slack/authorize?state=${encodeURIComponent(connectTokens.issue(userId))}`;

// ── Knowledge base (Postgres + pgvector + Vertex embeddings) ─────────────────
// Constructed once (independent of Slack reconnects); tools reference it via a
// late-binding closure so refreshRuntime rebuilds never recreate it.
interface KbRuntime {
  indexer: KbIndexer;
  buildTools: (userId: string) => Promise<ToolSet>;
  forgetUser: (userId: string) => Promise<void>;
  reactivate: (userId: string, source: "slack" | "gmail") => Promise<void>;
  status: () => Promise<unknown>;
}
let kb: KbRuntime | null = null;
const vertexProject =
  (await config.getTyped<string>("kb.vertexProject", "")) || process.env.GOOGLE_VERTEX_PROJECT || "";
const vertexLocation =
  (await config.getTyped<string>("kb.vertexLocation", "")) || process.env.GOOGLE_VERTEX_LOCATION || "us-central1";
if (pgPool && process.env.KB_ENABLED !== "0" && !vertexProject) {
  logger.info("knowledge base off (set GOOGLE_VERTEX_PROJECT or kb.vertexProject to enable embeddings)");
}
if (pgPool && process.env.KB_ENABLED !== "0" && vertexProject) {
  const kbReady = await ensureKbSchema(pgPool, logger);
  if (kbReady) {
    const kbStore = createPgKnowledgeStore({ pool: pgPool });
    const embedder = createVertexEmbedder({ project: vertexProject, location: vertexLocation });
    const srcDeps = { store: kbStore, embedder, config, userCapabilities, logger };
    const indexer = createKbIndexer({
      store: kbStore,
      users,
      userCapabilities,
      config,
      logger,
      runners: {
        slackWorkspace: createSlackKbSource(srcDeps, "workspace"),
        slackPersonal: createSlackKbSource(srcDeps, "personal"),
        gmail: createGmailKbSource(srcDeps),
      },
      notifyAuthLoss: async (userId, source) => {
        const u = await users.get(userId);
        if (!u?.slackUserId || !app) return;
        const open = await app.client.conversations.open({ users: u.slackUserId });
        const ch = open.channel?.id;
        if (!ch) return;
        await app.client.chat.postMessage({
          channel: ch,
          text: `heads up — my ${source} connection for you stopped working, so I've paused indexing. DM me "connect" to fix it, or "forget me" to delete what I've indexed.`,
        });
      },
    });
    indexer.start();
    kb = {
      indexer,
      buildTools: (userId) => buildKbTools(userId, { store: kbStore, embedder, config, logger }),
      forgetUser: (userId) => kbStore.forgetUser(userId),
      reactivate: async (userId, source) => {
        await kbStore.setIndexState({ scope: "user", userId, source, status: "active", backfillDone: false });
      },
      status: async () => ({
        enabled: true,
        workspace: await kbStore.stats("workspace", ""),
        principals: await kbStore.listIndexStates(),
      }),
    };
    logger.info("knowledge base enabled");
  }
} else if (!pgPool) {
  logger.info("knowledge base off (requires the postgres adapter)");
}

// ── Runtime that depends on config the console can change (model + tools).
//    Rebuilt at startup and on reconnect so Setup edits take effect live. ──────
let assistant: Assistant | null = null;

async function refreshRuntime(): Promise<void> {
  // Read every config key once, falling back to env (dot key → UPPER_SNAKE).
  const entries = await config.list();
  const cfgMap = new Map(entries.map((e) => [e.key, parseConfigValue(e.value)]));
  // Env fallback: dot + camelCase key → UPPER_SNAKE (azure.apiKey → AZURE_API_KEY).
  const envName = (key: string): string =>
    key
      .replace(/\./g, "_")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toUpperCase();
  const get = (key: string): string | undefined => cfgMap.get(key) ?? process.env[envName(key)];

  const settings = resolveModelConfig(get);
  let model: ChatModel | null = null;
  if (settings) {
    model = buildChatModel(settings);
    logger.info({ provider: settings.provider }, "model configured");
  } else {
    logger.warn(`model not configured (provider=${get("model.provider") ?? "azure"}) — configure it in Setup`);
  }

  const slackTools = await buildSlackTools(config, logger);
  const tools = createToolProvider({
    slackTools,
    buildGoogle: (userId) => buildGoogleTools(userId, config, userCapabilities, logger),
    buildSlackUser: (userId) => buildSlackUserTools(userId, config, userCapabilities, logger),
    buildKb: (userId) => (kb ? kb.buildTools(userId) : Promise.resolve({})),
  });

  assistant = model ? createAssistant({ model, tools, history, users, logger }) : null;
}

await refreshRuntime();

// Stable inbound port for the driving adapters — delegates to the current
// assistant, or returns a friendly message when the model isn't configured yet.
const NOT_CONFIGURED = "Tino's model isn't configured yet — set the Azure credentials in Setup.";
const assistantFacade: Assistant = {
  handleMessage: (userId, text) => (assistant ? assistant.handleMessage(userId, text) : Promise.resolve(NOT_CONFIGURED)),
  reset: (userId) => (assistant ? assistant.reset(userId) : Promise.resolve(false)),
};

// ── Slack lifecycle ──────────────────────────────────────────────────────────
type SlackBoltApp = import("@slack/bolt").App;
let app: SlackBoltApp | null = null;

async function reconnectSlack(): Promise<{ ok: boolean; error?: string }> {
  await refreshRuntime();
  const botToken = parseConfigValue(await config.get("slack.botToken")) ?? env.SLACK_BOT_TOKEN;
  const appToken = parseConfigValue(await config.get("slack.appToken")) ?? env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) {
    return { ok: false, error: "missing slack.botToken or slack.appToken" };
  }

  if (app) {
    try {
      await app.stop();
    } catch (err) {
      logger.error({ err: (err as Error).message }, "error stopping slack app during reconnect");
    }
    app = null;
  }

  const slackClient = new WebClient(botToken);
  const resolver = createIdentityResolver({ users, identities, slackClient, logger });
  const senderResolver: SenderResolver = createSenderResolver({ resolver, users, identities, config, logger });

  try {
    const nextApp = createSlackApp({
      env: { ...env, SLACK_BOT_TOKEN: botToken, SLACK_APP_TOKEN: appToken },
      assistant: assistantFacade,
      senderResolver,
      logger,
      connectLink: slackConnectLink,
      kbForgetUser: kb ? (userId: string) => (kb as KbRuntime).forgetUser(userId) : undefined,
    });
    await nextApp.start();
    app = nextApp;
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err: msg }, "slack reconnect failed");
    return { ok: false, error: msg };
  }

  logger.info({ pid: process.pid }, "tino slack connected");
  return { ok: true };
}

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "tino stopping");
  kb?.indexer.stop();
  try {
    consoleServer.close();
  } catch {
    /* ignore */
  }
  if (app) {
    try {
      await app.stop();
    } catch (err) {
      logger.error({ err }, "error stopping slack app");
    }
  }
  process.exit(0);
};

// Console (setup + chat) — always starts, regardless of Slack status.
const consoleServer = await startServer({
  config,
  logger,
  port,
  reconnectSlack,
  shutdown,
  identities,
  users,
  userCapabilities,
  authDatabase,
  getGoogleRefreshToken,
  assistant: assistantFacade,
  connectTokens,
  kbStatus: kb ? () => (kb as KbRuntime).status() : undefined,
  kbReactivate: kb ? (userId: string, source: "slack" | "gmail") => (kb as KbRuntime).reactivate(userId, source) : undefined,
});

const hasSlack = Boolean(
  (parseConfigValue(await config.get("slack.botToken")) ?? env.SLACK_BOT_TOKEN) &&
    (parseConfigValue(await config.get("slack.appToken")) ?? env.SLACK_APP_TOKEN),
);
if (hasSlack) {
  const initial = await reconnectSlack();
  if (!initial.ok) logger.warn({ err: initial.error }, "initial slack connect failed — console still running");
} else {
  logger.info({ port }, "no Slack tokens configured — visit the console to set up");
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
