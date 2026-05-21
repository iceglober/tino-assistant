import "dotenv/config";
import { WebClient } from "@slack/web-api";
import { createBedrockModel, DEFAULT_BEDROCK_MODEL_ID, validateBedrockModel } from "./agent/bedrock.js";
import { HistoryAppender } from "./agent/history-appender.js";
import { createPrivacyConfigStore } from "./privacy/config-store.js";
import { SourceRespectingPrivacyFilter } from "./privacy/source-respecting-filter.js";
import { createHistoryStore } from "./agent/history.js";
import { runAgent } from "./agent/run.js";
import { migrateEnvToCapabilities } from "./capabilities/migration.js";
import { initCapabilityRegistry } from "./capabilities/registry.js";
import { createCryptoAdapter } from "./crypto/factory.js";
import { migrateCredentialsToUserPartitions } from "./crypto/migration.js";
import { createEncryptedHistoryStore } from "./drive/adapters/encrypted-history-store.js";
import { createAppDataPreferencesStore } from "./drive/adapters/preferences-store.js";
import { createAppDataPrivacyConfigStore } from "./drive/adapters/privacy-config-store.js";
import { createKeyManager } from "./drive/key-manager.js";
import { createAppDataClientResolver } from "./drive/resolve-client.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logging/logger.js";
import { migrateToUserModel } from "./identity/migration.js";
import { createIdentityResolver } from "./identity/resolver.js";
import { SYSTEM_USER_ID } from "./identity/types.js";
import { createPersistence } from "./persistence/factory.js";
import { createGoogleCredentialResolver } from "./privacy/adapters/credentials.js";
import { startScheduler } from "./scheduler/index.js";
import { startServer } from "./server/index.js";
import { createSlackApp, type DmHandler } from "./slack/app.js";
import { createProactiveDm } from "./slack/proactive.js";

const env = loadEnv();
const logger = createLogger(env);

// Create crypto adapter for encrypting per-user credentials (wave 2)
const cryptoAdapter = await createCryptoAdapter(env);

const {
  history,
  tasks: taskStore,
  preferences: preferencesStore,
  config: configStore,
  users,
  identities,
  userCapabilities,
  auditLogger,
  sessionStore,
} = await createPersistence(env, logger, cryptoAdapter);

// `auditLogger` is sourced from the persistence factory:
//   - sqlite → in-memory (dev only; entries lost on restart)
//   - dynamodb → durable, TTL-backed (90d default, see audit/dynamo.ts:22)
// The shape is identical, so callers don't branch on adapter.

// Create privacy config store (encrypted per-user config) and wire the real filter
const serverPrivacyConfigStore = createPrivacyConfigStore({ configStore, crypto: cryptoAdapter });

// Wire appDataFolder-backed stores for per-user private storage.
// When Google credentials are available, privacy config and preferences live in
// each user's Drive appDataFolder; conversation history stays server-side but
// encrypted with a per-user key from appDataFolder. Falls back to server-side
// storage when Google is unavailable.
const googleCreds = createGoogleCredentialResolver({ userCapabilities, configStore });
const appDataResolver = createAppDataClientResolver({ resolveCreds: googleCreds, logger });
const appDataKeyManager = createKeyManager();

const privacyConfigStore = createAppDataPrivacyConfigStore({
  resolveClient: appDataResolver,
  fallback: serverPrivacyConfigStore,
  logger,
});

const wrappedPreferences = createAppDataPreferencesStore({
  resolveClient: appDataResolver,
  fallback: preferencesStore,
  logger,
});

const wrappedHistory = createEncryptedHistoryStore({
  inner: history,
  keyManager: appDataKeyManager,
  resolveClient: appDataResolver,
  logger,
});

const privacyFilter = new SourceRespectingPrivacyFilter((userId) => privacyConfigStore.get(userId));
const historyAppender = new HistoryAppender(wrappedHistory, privacyFilter);

// Run one-time migration from env vars to config store (no-op if already done)
await migrateEnvToCapabilities(env, configStore, logger);

// Run one-time migration to the multi-user model (wave 0)
if (env.SLACK_BOT_TOKEN && env.ALLOWED_SLACK_USER_ID) {
  const slackClient = new WebClient(env.SLACK_BOT_TOKEN);
  await migrateToUserModel({
    configStore,
    users,
    identities,
    history,
    preferences: preferencesStore,
    tasks: taskStore,
    slackClient,
    allowedSlackUserId: env.ALLOWED_SLACK_USER_ID,
    logger,
  });
}

// Run one-time migration to move private-capability credentials to per-user partitions (wave 2)
await migrateCredentialsToUserPartitions({
  configStore,
  userCapabilities,
  users,
  logger,
  allowedSlackUserId: env.ALLOWED_SLACK_USER_ID,
});

// Read Slack connection config from config store (written by console)
// configStore.get returns JSON-stringified values, so parse them
function parseConfigValue(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
}
const slackBotToken = parseConfigValue(await configStore.get("slack.botToken")) ?? env.SLACK_BOT_TOKEN;
const slackAppToken = parseConfigValue(await configStore.get("slack.appToken")) ?? env.SLACK_APP_TOKEN;
const allowedUserId = parseConfigValue(await configStore.get("slack.adminUserId")) ?? env.ALLOWED_SLACK_USER_ID ?? "";

const hasSlack = Boolean(slackBotToken && slackAppToken);

// Warn if the user table is empty and no bootstrap admin can be seeded
if (!allowedUserId) {
  const allUsers = await users.list();
  if (allUsers.length === 0) {
    logger.warn(
      "user table is empty and ALLOWED_SLACK_USER_ID is unset — no admin can DM tino. " +
        "Seed an admin via the console (Google OAuth) or set ALLOWED_SLACK_USER_ID.",
    );
  }
}

// Read Bedrock model ID from config store; fall back to default
const configuredModelId = await configStore.getTyped<string>("bedrock.modelId", DEFAULT_BEDROCK_MODEL_ID);
// Validate the configured model is actually reachable with current credentials.
// On failure, fall back to the default — never crash on an invalid saved ID.
let bedrockModelId = configuredModelId;
const validation = await validateBedrockModel(configuredModelId, env.AWS_REGION);
if (!validation.ok) {
  logger.error(
    { modelId: configuredModelId, err: validation.error },
    "bedrock model validation failed — falling back to default",
  );
  if (configuredModelId !== DEFAULT_BEDROCK_MODEL_ID) {
    bedrockModelId = DEFAULT_BEDROCK_MODEL_ID;
  }
}
const model = createBedrockModel(bedrockModelId, env.AWS_REGION);

// Initialize capability registry — loads capabilities, registers tools, starts findWork pollers
const registry = await initCapabilityRegistry({
  configStore,
  logger,
  allowedUserId,
  dbPath: env.DB_PATH,
  preferencesStore: wrappedPreferences,
  taskStore,
  userCapabilities,
  onNewWork: async (summary: string) => {
    // findWork callback — run the agent on the work item and post result to owner
    const taskHistory = createHistoryStore({ cap: 40 });
    const prompt = [
      "You are executing a scheduled task. Your response will be posted directly to the owner's Slack DM.",
      "Do not explain that you are a bot. Just produce the content.",
      "",
      summary,
    ].join("\n");

    const privateTools = await registry.buildPrivateTools(SYSTEM_USER_ID);
    const tools = { ...registry.sharedTools, ...privateTools };
    const activeCapabilities = await registry.getActiveCapabilities(SYSTEM_USER_ID);

    const taskHistoryAppender = new HistoryAppender(taskHistory, privacyFilter);
    const result = await runAgent({
      model,
      history: taskHistory,
      historyAppender: taskHistoryAppender,
      logger,
      tools,
      userId: SYSTEM_USER_ID,
      text: prompt,
      auditLogger,
      activeCapabilities,
    });

    await postDm(result);
  },
});

const tools = registry.sharedTools;

// 9g: Log tool-definition token count estimate at startup.
const toolTokenEstimate = Math.ceil(
  Object.values(tools)
    .map((t) => {
      const desc = (t as { description?: string }).description ?? "";
      const schema = JSON.stringify((t as { inputSchema?: unknown }).inputSchema ?? {});
      return desc.length + schema.length;
    })
    .reduce((a, b) => a + b, 0) / 4,
);
logger.info({ toolCount: Object.keys(tools).length, estimatedTokens: toolTokenEstimate }, "tool definitions loaded");

// ── Module-scoped Slack lifecycle state ──────────────────────────────────
// `reconnectSlack()` (wave 3.1) needs to read/write these on demand: tearing
// down the existing `app` and scheduler, then constructing fresh ones with
// the latest tokens from the config store. A closure-over-`let`-in-the-
// outer-block won't work because the reload route AND the SIGTERM handler
// both need to call into the same lifecycle state from outside any previous
// closure. Module-scoped `let` is the simplest correct choice; the
// trade-off is acceptable here (single instance, single process).
type SlackBoltApp = import("@slack/bolt").App;
let app: SlackBoltApp | null = null;
let postDm: (text: string) => Promise<void> = async () => {
  /* no-op: Slack not connected */
};
let stopScheduler: () => void = () => {
  /* no-op */
};

/**
 * Read the current Slack tokens from the config store and start (or restart)
 * the Slack app, proactive DM helper, and scheduler in place.
 *
 * Wave 3.1 — invoked by `POST /api/reload/slack` and at startup. Returns
 * `{ ok: false, error }` (HTTP 200 to caller) on user-visible failures
 * (missing tokens, Slack rejected the credentials) so the console can
 * toast the error without treating it as a server bug.
 */
async function reconnectSlack(): Promise<{ ok: boolean; error?: string }> {
  // Re-read the tokens fresh — the config store is the source of truth.
  const botToken = parseConfigValue(await configStore.get("slack.botToken")) ?? env.SLACK_BOT_TOKEN;
  const appToken = parseConfigValue(await configStore.get("slack.appToken")) ?? env.SLACK_APP_TOKEN;
  const adminId = parseConfigValue(await configStore.get("slack.adminUserId")) ?? env.ALLOWED_SLACK_USER_ID ?? "";

  if (!botToken || !appToken || !adminId) {
    return { ok: false, error: "missing slack.botToken, slack.appToken, or slack.adminUserId" };
  }

  // Tear down the existing connection if any. `app.stop()` may throw if
  // Slack is unreachable — never let it propagate across this boundary;
  // the caller wants a clean `{ ok: false, error }` instead of an exception.
  if (app) {
    try {
      stopScheduler();
      stopScheduler = () => {
        /* no-op */
      };
      await app.stop();
    } catch (err) {
      logger.error({ err: (err as Error).message }, "error stopping slack app during reconnect");
    }
    app = null;
    postDm = async () => {
      /* no-op: Slack mid-reload */
    };
  }

  const slackEnv = {
    ...env,
    SLACK_BOT_TOKEN: botToken,
    SLACK_APP_TOKEN: appToken,
    ALLOWED_SLACK_USER_ID: adminId,
  };

  const slackClient = new WebClient(botToken);
  const identityResolver = createIdentityResolver({ users, identities, slackClient, logger });

  const handler: DmHandler = async (userId, text) => {
    const privateTools = await registry.buildPrivateTools(userId);
    const tools = { ...registry.sharedTools, ...privateTools };
    const activeCapabilities = await registry.getActiveCapabilities(userId);

    return runAgent({
      model,
      history: wrappedHistory,
      historyAppender,
      logger,
      tools,
      userId,
      text,
      auditLogger,
      activeCapabilities,
    });
  };

  let nextApp: SlackBoltApp;
  try {
    nextApp = createSlackApp({
      env: slackEnv,
      onDm: handler,
      logger,
      history: wrappedHistory,
      identityResolver,
      users,
      configStore,
      auditLogger,
    });
    await nextApp.start();
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err: msg }, "slack reconnect failed");
    return { ok: false, error: msg };
  }

  app = nextApp;
  logger.info({ nodeVersion: process.version, pid: process.pid }, "tino slack connected");

  postDm = await createProactiveDm(nextApp, adminId, logger);

  stopScheduler = startScheduler({
    taskStore,
    logger,
    runTask: async (task) => {
      const taskHistory = createHistoryStore({ cap: 40 });
      const taskPrompt = [
        "You are executing a scheduled task. Your response will be posted directly to the owner's Slack DM — you do not need a tool to send it.",
        "Do not explain that you are a bot or that you cannot send messages. Just produce the content the task asks for.",
        "",
        `Task: ${task.description}`,
      ].join("\n");
      const privateTools = await registry.buildPrivateTools(task.userId);
      const tools = { ...registry.sharedTools, ...privateTools };
      const activeCapabilities = await registry.getActiveCapabilities(task.userId);

      const taskHistoryAppender = new HistoryAppender(taskHistory, privacyFilter);
      return runAgent({
        model,
        history: taskHistory,
        historyAppender: taskHistoryAppender,
        logger,
        tools,
        userId: task.userId,
        text: taskPrompt,
        auditLogger,
        activeCapabilities,
      });
    },
    postResult: (text: string) => postDm(text),
  });

  return { ok: true };
}

/**
 * Wave 3.2 — re-run the capability registry against the live config store.
 * The registry mutates `registry.tools` in place so all callers (agent loop,
 * scheduler, findWork callbacks) pick up the new toolset without surgery.
 * Per-capability errors don't roll back the whole reload (registry handles).
 */
async function reloadCapabilities(): Promise<{ ok: boolean; error?: string }> {
  try {
    return await registry.reload();
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err: msg }, "capability reload failed");
    return { ok: false, error: msg };
  }
}

/**
 * Unified shutdown — used by SIGINT/SIGTERM and by the wave 3.4 admin
 * restart route. Hoisted out of the `if (hasSlack)` branches so one named
 * function is reachable from `startServer`'s `shutdown` option.
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "tino stopping");
  try {
    stopScheduler();
  } catch {
    /* ignore */
  }
  try {
    registry.stopAll();
  } catch {
    /* ignore */
  }
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

// Config console — always starts, regardless of Slack status
const mockPrivacy = env.PERSISTENCE_ADAPTER === "sqlite";
const consoleServer = await startServer({
  config: configStore,
  logger,
  tools,
  registry,
  port: 3001,
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
});

if (hasSlack) {
  const initial = await reconnectSlack();
  if (!initial.ok) {
    logger.warn({ err: initial.error }, "initial slack connect failed — console still running");
  }
} else {
  logger.info({ port: 3001 }, "no Slack tokens configured — visit http://localhost:3001 to set up");
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
