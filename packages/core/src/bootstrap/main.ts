import "dotenv/config";
import { WebClient } from "@slack/web-api";
import { createAssistant } from "../application/assistant.js";
import { createSenderResolver } from "../application/sender.js";
import { loadEnv } from "../env.js";
import { buildChatModel, resolveModelConfig } from "../infrastructure/driven/model/index.js";
import { createCryptoAdapter } from "../infrastructure/driven/crypto/factory.js";
import { createIdentityResolver } from "../infrastructure/driven/identity/resolver.js";
import { createPersistence } from "../infrastructure/driven/persistence/factory.js";
import { buildGoogleTools } from "../infrastructure/driven/tools/google.js";
import { buildSlackTools } from "../infrastructure/driven/tools/slack.js";
import { createToolProvider } from "../infrastructure/driven/tools/provider.js";
import { createSlackApp } from "../infrastructure/driving/slack/slack.js";
import { startServer } from "../infrastructure/driving/http/server.js";
import { createLogger } from "../logging.js";
import type { Assistant, SenderResolver } from "../ports/inbound.js";
import type { ChatModel } from "../ports/outbound.js";

const env = loadEnv();
const logger = createLogger(env);

// Crypto adapter — encrypts per-user Google credentials in the capability store.
const cryptoAdapter = await createCryptoAdapter(env);

const { history, config, users, identities, userCapabilities, sessionStore } = await createPersistence(
  env,
  logger,
  cryptoAdapter,
);

function parseConfigValue(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
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
  port: 3001,
  reconnectSlack,
  shutdown,
  sessionStore,
  identities,
  users,
  userCapabilities,
  assistant: assistantFacade,
});

const hasSlack = Boolean(
  (parseConfigValue(await config.get("slack.botToken")) ?? env.SLACK_BOT_TOKEN) &&
    (parseConfigValue(await config.get("slack.appToken")) ?? env.SLACK_APP_TOKEN),
);
if (hasSlack) {
  const initial = await reconnectSlack();
  if (!initial.ok) logger.warn({ err: initial.error }, "initial slack connect failed — console still running");
} else {
  logger.info({ port: 3001 }, "no Slack tokens configured — visit http://localhost:3001 to set up");
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
