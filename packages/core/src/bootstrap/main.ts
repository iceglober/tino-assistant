import "dotenv/config";
import crypto from "node:crypto";
import { WebClient } from "@slack/web-api";
import type { ToolSet } from "ai";
import { createAssistant } from "../application/assistant.js";
import { createKbIndexer, type KbIndexer } from "../application/kb-indexer.js";
import { createKbSynthesizer } from "../application/kb-synthesizer.js";
import { createSenderResolver } from "../application/sender.js";
import { loadEnv } from "../env.js";
import { createKnowledgeExtractor } from "../infrastructure/driven/kb/extractor.js";
import { createPgKnowledgeStore } from "../infrastructure/driven/kb/pg-store.js";
import { ensureKbSchema } from "../infrastructure/driven/kb/schema.js";
import { createGmailKbSource } from "../infrastructure/driven/kb/sources/gmail.js";
import { createSlackKbSource } from "../infrastructure/driven/kb/sources/slack.js";
import { createVertexEmbedder } from "../infrastructure/driven/kb/vertex-embedder.js";
import { buildMyKnowledgeTools, buildWorkspaceKnowledgeTools } from "../infrastructure/driven/tools/kb.js";
import { buildLanguageModel, resolveModelConfig } from "../infrastructure/driven/model/index.js";
import { toChatModel } from "../infrastructure/driven/model/chat-model.js";
import { createCryptoAdapter } from "../infrastructure/driven/crypto/factory.js";
import { createIdentityResolver } from "../infrastructure/driven/identity/resolver.js";
import { createMcpClientPool } from "../infrastructure/driven/mcp/client-pool.js";
import { createMcpServerStore } from "../infrastructure/driven/mcp/store.js";
import { createPersistence } from "../infrastructure/driven/persistence/factory.js";
import { buildGoogleTools } from "../infrastructure/driven/tools/google.js";
import { mcpToolGroups } from "../infrastructure/driven/tools/mcp.js";
import { buildSlackTools, type SlackChannelTools } from "../infrastructure/driven/tools/slack.js";
import { buildSlackUserTools } from "../infrastructure/driven/tools/slack-user.js";
import { createToolProvider } from "../infrastructure/driven/tools/provider.js";
import { createSlackChannelDirectory, type SlackDirectoryClient } from "../infrastructure/driven/slack/channel-directory.js";
import { toSlackMrkdwn } from "../infrastructure/driving/slack/mrkdwn.js";
import { createSlackApp } from "../infrastructure/driving/slack/slack.js";
import type { KbRoutesDeps } from "../infrastructure/driving/http/routes/kb.js";
import { startServer } from "../infrastructure/driving/http/server.js";
import { createConnectTokens } from "../infrastructure/security/connect-token.js";
import { createLogger } from "../logging.js";
import type { LanguageModel } from "ai";
import type { Assistant, SenderResolver } from "../ports/inbound.js";
import type { ChannelDirectory, ChatModel, DirectMessenger, KnowledgeExtractor } from "../ports/outbound.js";

const env = loadEnv();
const logger = createLogger(env);

// Crypto adapter — encrypts per-user Google credentials in the capability store.
const cryptoAdapter = await createCryptoAdapter(env);

const { conversations, config, users, identities, userCapabilities, authDatabase, getGoogleRefreshToken, pgPool } =
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

// Remote MCP servers — one connection pool for the process, like the KB.
const mcpServers = createMcpServerStore(userCapabilities);
const mcpPool = createMcpClientPool({ logger });

// ── Knowledge base (Postgres + pgvector + Vertex embeddings) ─────────────────
// Constructed once (independent of Slack reconnects); tools reference it via a
// late-binding closure so refreshRuntime rebuilds never recreate it.
interface KbRuntime {
  indexer: KbIndexer;
  workspaceKnowledge: () => Promise<ToolSet>;
  myKnowledge: (userId: string) => Promise<ToolSet>;
  forgetUser: (userId: string) => Promise<void>;
  reactivate: (userId: string, source: "slack" | "gmail") => Promise<void>;
  routes: KbRoutesDeps;
}
let kb: KbRuntime | null = null;
// The extractor rides whatever provider Setup currently points at, so it is
// resolved per call rather than captured — refreshRuntime swaps this in place.
let languageModel: LanguageModel | null = null;
const currentExtractor = (): KnowledgeExtractor | null =>
  languageModel ? createKnowledgeExtractor({ model: languageModel, logger }) : null;

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
    const synthesizer = createKbSynthesizer({
      store: kbStore,
      embedder,
      extractor: currentExtractor,
      config,
      logger,
    });
    const indexer = createKbIndexer({
      store: kbStore,
      users,
      userCapabilities,
      config,
      logger,
      synthesizer,
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

    /** Console scope → the (scope, userId) pair the store expects. */
    const resolve = (scope: "workspace" | "private", userId: string): ["workspace" | "private", string] =>
      scope === "workspace" ? ["workspace", ""] : ["private", userId];

    kb = {
      indexer,
      workspaceKnowledge: () => buildWorkspaceKnowledgeTools({ store: kbStore, embedder, config, logger }),
      myKnowledge: (userId) => buildMyKnowledgeTools(userId, { store: kbStore, embedder, config, logger }),
      forgetUser: (userId) => kbStore.forgetUser(userId),
      reactivate: async (userId, source) => {
        await kbStore.setIndexState({ scope: "private", userId, source, status: "active", backfillDone: false });
      },
      routes: {
        logger,
        status: async (userId: string) => {
          const [wsStats, wsBySource, mineStats, mineBySource, states, wsPending, minePending, wsFacts, mineFacts] =
            await Promise.all([
              kbStore.stats("workspace", ""),
              kbStore.statsBySource("workspace", ""),
              kbStore.stats("private", userId),
              kbStore.statsBySource("private", userId),
              kbStore.listIndexStates(),
              kbStore.pendingSynthesisCount("workspace", ""),
              kbStore.pendingSynthesisCount("private", userId),
              kbStore.listFacts("workspace", "", { limit: 1, offset: 0 }),
              kbStore.listFacts("private", userId, { limit: 1, offset: 0 }),
            ]);
          return {
            enabled: true,
            // Distillation is off without a model, and the page should say so
            // rather than showing an empty knowledge list forever.
            distilling: languageModel !== null,
            indexer: indexer.status(),
            scopes: {
              workspace: { ...wsStats, bySource: wsBySource, pending: wsPending, facts: wsFacts.total },
              private: { ...mineStats, bySource: mineBySource, pending: minePending, facts: mineFacts.total },
            },
            // Only this user's principals + the shared workspace ones.
            principals: states.filter((s) => s.scope === "workspace" || s.userId === userId),
          };
        },

        knowledge: async ({ scope, userId, kind, subject, limit, offset }) => {
          const [s, u] = resolve(scope, userId);
          const { items, total, kinds } = await kbStore.listFacts(s, u, { limit, offset, kind, subject });
          return {
            total,
            kinds,
            items: items.map((f) => ({
              id: f.id,
              kind: f.kind,
              subject: f.subject,
              statement: f.statement,
              detail: f.detail,
              confidence: f.confidence,
              firstSeen: new Date(f.firstSeenMs).toISOString(),
              lastSeen: new Date(f.lastSeenMs).toISOString(),
              evidence: f.evidence.map((e) => ({
                source: e.source,
                ts: new Date(e.ts).toISOString(),
                permalink: e.permalink,
                snippet: e.snippet,
              })),
            })),
          };
        },

        topics: async (scope, userId) => {
          const [s, u] = resolve(scope, userId);
          const items = await kbStore.listTopics(s, u);
          return {
            items: items.map((t) => ({
              id: t.id,
              label: t.label,
              summary: t.summary,
              chunks: t.chunks,
              oldest: t.oldestMs ? new Date(t.oldestMs).toISOString() : null,
              newest: t.newestMs ? new Date(t.newestMs).toISOString() : null,
            })),
          };
        },

        topicChunks: async (scope, userId, topicId) => {
          const [s, u] = resolve(scope, userId);
          const items = await kbStore.chunksForTopic(s, u, topicId, 40);
          return {
            items: items.map((i) => ({
              ...i,
              ts: new Date(i.ts).toISOString(),
              indexedAt: new Date(i.indexedAt).toISOString(),
            })),
          };
        },

        browse: async ({ scope, userId, q, source, limit, offset }) => {
          const [s, u] = resolve(scope, userId);
          if (q) {
            const [w, tau] = await Promise.all([
              config.getTyped<number>("kb.recencyWeight", 0.3),
              config.getTyped<number>("kb.recencyTauDays", 30),
            ]);
            const embedding = await embedder.embedQuery(q);
            const hits = await kbStore.search({
              scope: s,
              userId: u,
              embedding,
              topK: limit,
              sources: source ? [source] : undefined,
              recencyWeight: w,
              recencyTauDays: tau,
            });
            return {
              mode: "search",
              total: hits.length,
              items: hits.map((h) => ({ ...h, ts: new Date(h.ts).toISOString() })),
            };
          }
          const { items, total } = await kbStore.listChunks(s, u, { limit, offset, source });
          return {
            mode: "recent",
            total,
            items: items.map((i) => ({
              ...i,
              ts: new Date(i.ts).toISOString(),
              indexedAt: new Date(i.indexedAt).toISOString(),
            })),
          };
        },

        activity: async (userId, limit) => {
          const events = await kbStore.listCycleEvents(userId, limit);
          return { items: events.map((e) => ({ ...e, at: new Date(e.at).toISOString() })) };
        },
      },
    };
    logger.info("knowledge base enabled");
  }
} else if (!pgPool) {
  logger.info("knowledge base off (requires the postgres adapter)");
}

// ── Runtime that depends on config the console can change (model + tools).
//    Rebuilt at startup and on reconnect so Setup edits take effect live. ──────
let assistant: Assistant | null = null;
type SlackBoltApp = import("@slack/bolt").App;
let app: SlackBoltApp | null = null;
let slackChannelTools: SlackChannelTools = { publicChannels: () => ({}), thisChannel: () => ({}) };
/** Slack channel lookups; set once Slack connects. */
let channelDirectory: ChannelDirectory | null = null;

/** DMs a tino user through the bot — used for the "continue in DM" follow-up. */
const slackMessenger: DirectMessenger = {
  async sendToUser(userId, text) {
    const user = await users.get(userId);
    if (!user?.slackUserId || !app) throw new Error("user has no linked Slack account or Slack is offline");
    const open = await app.client.conversations.open({ users: user.slackUserId });
    if (!open.channel?.id) throw new Error("couldn't open a DM");
    await app.client.chat.postMessage({ channel: open.channel.id, text: toSlackMrkdwn(text) });
  },
};

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
    // One construction, two consumers: the chat loop and knowledge extraction.
    languageModel = buildLanguageModel(settings);
    model = toChatModel(languageModel);
    logger.info({ provider: settings.provider }, "model configured");
  } else {
    languageModel = null;
    logger.warn(`model not configured (provider=${get("model.provider") ?? "azure"}) — configure it in Setup`);
  }

  slackChannelTools = await buildSlackTools(config, logger);
  const tools = createToolProvider({
    slack: () => slackChannelTools,
    gmailAndCalendar: (userId) => buildGoogleTools(userId, userCapabilities, logger),
    mySlackMessages: (userId) => buildSlackUserTools(userId, userCapabilities, logger),
    myKnowledge: (userId) => (kb ? kb.myKnowledge(userId) : Promise.resolve({})),
    workspaceKnowledge: () => (kb ? kb.workspaceKnowledge() : Promise.resolve({})),
    mcp: (userId) => mcpToolGroups(userId, { servers: mcpServers, pool: mcpPool }),
    logger,
  });

  assistant = model
    ? createAssistant({
        model,
        tools,
        conversations,
        users,
        config,
        directory: () => channelDirectory,
        messenger: () => (app ? slackMessenger : null),
        logger,
      })
    : null;
}

await refreshRuntime();

// Stable inbound port for the driving adapters — delegates to the current
// assistant, or returns a friendly message when the model isn't configured yet.
const NOT_CONFIGURED = "Tino's model isn't configured yet — set the Azure credentials in Setup.";
const assistantFacade: Assistant = {
  handleMessage: (userId, text, surface) =>
    assistant ? assistant.handleMessage(userId, text, surface) : Promise.resolve(NOT_CONFIGURED),
  reset: (userId) => (assistant ? assistant.reset(userId) : Promise.resolve(false)),
};

// ── Slack lifecycle ──────────────────────────────────────────────────────────

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
  channelDirectory = createSlackChannelDirectory(slackClient as unknown as SlackDirectoryClient, logger);
  const resolver = createIdentityResolver({ users, identities, slackClient, logger });
  const senderResolver: SenderResolver = createSenderResolver({ resolver, users, config, logger });

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
  await mcpPool.closeAll();
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

/** Booleans only — what members may know about the deployment's configuration. */
async function setupStatus() {
  const has = async (key: string, envKey?: string): Promise<boolean> =>
    !!(parseConfigValue(await config.get(key)) || (envKey ? process.env[envKey] : undefined));
  const [botToken, appToken, slackClientId, slackClientSecret, googleId, googleSecret] = await Promise.all([
    has("slack.botToken", "SLACK_BOT_TOKEN"),
    has("slack.appToken", "SLACK_APP_TOKEN"),
    has("slack.clientId", "SLACK_CLIENT_ID"),
    has("slack.clientSecret", "SLACK_CLIENT_SECRET"),
    has("google.oauth.clientId", "GOOGLE_OAUTH_CLIENT_ID"),
    has("google.oauth.clientSecret", "GOOGLE_OAUTH_CLIENT_SECRET"),
  ]);
  return {
    slack: botToken && appToken,
    model: languageModel !== null,
    slackConnect: slackClientId && slackClientSecret,
    googleConnect: googleId && googleSecret,
    kb: kb !== null,
  };
}

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
  mcpServers,
  mcpPool,
  setupStatus,
  kbRoutes: kb ? (kb as KbRuntime).routes : undefined,
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
