/**
 * Everything one org runs: its model, tools, Slack app, knowledge base, and the
 * assistant built from them — the single-tenant tino of old, constructed from
 * stores bound to this org and nothing else. The platform keeps one of these
 * per active org (lazily) and calls `refresh()` when the org's settings change.
 */
import type { App } from "@slack/bolt";
import type { OrgSetupStatus } from "@tino/contracts";
import { WebClient } from "@slack/web-api";
import type { LanguageModel } from "ai";
import { createAssistant } from "@tino/core/application/assistant";
import { createSenderResolver } from "@tino/core/application/sender";
import { type Org, orgOwnerId } from "@tino/core/domain/org";
import type { Assistant } from "@tino/core/ports/inbound";
import type { ChannelDirectory, ChatModel, DirectMessenger, KnowledgeExtractor, Logger } from "@tino/core/ports/outbound";
import { createIdentityResolver } from "../infrastructure/driven/identity/resolver.js";
import { type NamedEmbedder, resolveEmbedder } from "../infrastructure/driven/kb/embedders.js";
import { createKnowledgeExtractor } from "../infrastructure/driven/kb/extractor.js";
import { wipeOrgKnowledge } from "../infrastructure/driven/kb/pg-store.js";
import type { McpClientPool } from "../infrastructure/driven/mcp/client-pool.js";
import { createMcpServerStore, type McpServerStore } from "../infrastructure/driven/mcp/store.js";
import { toChatModel } from "../infrastructure/driven/model/chat-model.js";
import { buildLanguageModel, resolveModelConfig } from "../infrastructure/driven/model/index.js";
import {
  type ClientCapability,
  createOrgOAuthClients,
  type OrgOAuthClients,
  withGoogleClientSecrets,
} from "../infrastructure/driven/oauth/org-clients.js";
import type { PgPool } from "../infrastructure/driven/persistence/db.js";
import type { OrgStores } from "../infrastructure/driven/persistence/postgres/index.js";
import { createSlackChannelDirectory, type SlackDirectoryClient } from "../infrastructure/driven/slack/channel-directory.js";
import { buildGoogleTools } from "../infrastructure/driven/tools/google.js";
import { mcpToolGroups } from "../infrastructure/driven/tools/mcp.js";
import { createToolProvider } from "../infrastructure/driven/tools/provider.js";
import { buildSlackTools, type SlackChannelTools } from "../infrastructure/driven/tools/slack.js";
import { buildSlackUserTools } from "../infrastructure/driven/tools/slack-user.js";
import { toSlackMrkdwn } from "../infrastructure/driving/slack/mrkdwn.js";
import { createSlackApp } from "../infrastructure/driving/slack/slack.js";
import type { PlatformOAuthClient } from "@tino/core/domain/oauth-clients";
import { createOrgKb, type OrgKb } from "./org-kb.js";

/** What every org runtime shares: process-wide resources and platform config. */
export interface PlatformServices {
  pool: PgPool;
  logger: Logger;
  baseUrl: string;
  mcpPool: McpClientPool;
  platformClients: { google: PlatformOAuthClient | null; slack: PlatformOAuthClient | null };
  platformEmbedder: NamedEmbedder | null;
  /** People connected through a platform client, across all orgs. */
  platformUsers: (capability: ClientCapability) => Promise<number>;
  /** Whether the knowledge-base tables exist and indexing is on. */
  kbAvailable: boolean;
  /** A personal link that starts the Slack connect flow for a member (the bot DMs it). */
  slackConnectLink: (orgId: string, userId: string) => string;
}

export interface OrgRuntime {
  readonly org: Org;
  readonly stores: OrgStores;
  readonly assistant: Assistant;
  readonly mcpServers: McpServerStore;
  readonly oauth: OrgOAuthClients;
  /** The org's Slack app, once a bot token is installed. */
  slackApp(): App | null;
  kb(): OrgKb | null;
  status(): Promise<OrgSetupStatus>;
  /** Re-read settings and rebuild the model, tools, Slack app and KB. */
  refresh(): Promise<void>;
  /** Wipe the KB and re-pin it to the current embedder (after a model change). */
  rebuildKnowledge(): Promise<void>;
  setOrg(org: Org): void;
  close(): Promise<void>;
}

function parseValue(raw: string): string | undefined {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "string" ? v : v === null ? undefined : String(v);
  } catch {
    return raw;
  }
}

const NOT_CONFIGURED =
  "Tino's model isn't set up for your org yet — an admin can add one in Settings → Model.";

export async function createOrgRuntime(initialOrg: Org, stores: OrgStores, platform: PlatformServices): Promise<OrgRuntime> {
  let org = initialOrg;
  const logger = (platform.logger as unknown as { child?: (b: object) => Logger }).child?.({ org: org.slug }) ?? platform.logger;
  const { config, users, identities, conversations } = stores;

  const oauth = createOrgOAuthClients({
    orgId: org.id,
    config,
    platform: platform.platformClients,
    platformUsers: platform.platformUsers,
  });
  // Tools and sources read Google credentials with the issuing client joined in.
  const userCapabilities = withGoogleClientSecrets(stores.userCapabilities, oauth);
  const mcpServers = createMcpServerStore(stores.userCapabilities, orgOwnerId(org.id));

  let assistant: Assistant | null = null;
  let languageModel: LanguageModel | null = null;
  let slackApp: App | null = null;
  let channelDirectory: ChannelDirectory | null = null;
  let slackChannelTools: SlackChannelTools = { publicChannels: () => ({}), thisChannel: () => ({}) };
  let kb: OrgKb | null = null;
  let kbState: OrgSetupStatus["kb"] = { enabled: false, reason: "not started" };

  const extractor = (): KnowledgeExtractor | null =>
    languageModel ? createKnowledgeExtractor({ model: languageModel, logger }) : null;

  /** DMs a member through the org's bot — the "continue in DM" follow-up and auth-loss notices. */
  const messenger: DirectMessenger = {
    async sendToUser(userId, text) {
      const user = await users.get(userId);
      if (!user?.slackUserId || !slackApp) throw new Error("user has no linked Slack account or Slack is not installed");
      const open = await slackApp.client.conversations.open({ users: user.slackUserId });
      if (!open.channel?.id) throw new Error("couldn't open a DM");
      await slackApp.client.chat.postMessage({ channel: open.channel.id, text: toSlackMrkdwn(text) });
    },
  };

  const assistantFacade: Assistant = {
    handleMessage: (userId, text, surface) =>
      assistant ? assistant.handleMessage(userId, text, surface) : Promise.resolve(NOT_CONFIGURED),
    reset: (userId) => (assistant ? assistant.reset(userId) : Promise.resolve(false)),
  };

  async function buildKb(get: (key: string) => string | undefined): Promise<void> {
    if (!platform.kbAvailable || !stores.knowledge) {
      kb = null;
      kbState = { enabled: false, reason: "the knowledge base is turned off on this server" };
      return;
    }
    const resolved = resolveEmbedder(get, platform.platformEmbedder);
    if (!resolved.embedder) {
      kb = null;
      kbState = { enabled: false, reason: resolved.reason };
      return;
    }
    const embedder = resolved.embedder;
    const pinned = await config.getTyped<string>("kb.embedModel", "");
    if (!pinned) await config.set("kb.embedModel", embedder.model);
    else if (pinned !== embedder.model) {
      kb = null;
      kbState = {
        enabled: false,
        embedModel: pinned,
        reason: `the embedding model changed (${pinned} → ${embedder.model}); rebuild the knowledge base to switch`,
      };
      return;
    }
    if (kb && kbState.embedModel === embedder.model) return; // unchanged — keep the indexer's state
    kb = createOrgKb({
      stores: stores as OrgStores & { knowledge: NonNullable<OrgStores["knowledge"]> },
      embedder,
      extractor,
      notifyAuthLoss: async (userId, source) => {
        await messenger
          .sendToUser(
            userId,
            `heads up — my ${source} connection for you stopped working, so I've paused indexing. DM me "connect" to fix it, or "forget me" to delete what I've indexed.`,
          )
          .catch(() => {});
      },
      logger,
    });
    kbState = { enabled: true, embedModel: embedder.model };
  }

  async function buildSlack(get: (key: string) => string | undefined): Promise<void> {
    const botToken = get("slack.botToken");
    if (!botToken) {
      slackApp = null;
      channelDirectory = null;
      return;
    }
    const slackClient = new WebClient(botToken);
    channelDirectory = createSlackChannelDirectory(slackClient as unknown as SlackDirectoryClient, logger);
    const resolver = createIdentityResolver({ users, identities, slackClient, logger });
    const senderResolver = createSenderResolver({ resolver, users, config, logger });
    slackApp = createSlackApp({
      botToken,
      assistant: assistantFacade,
      senderResolver,
      logger,
      connectLink: (userId) => platform.slackConnectLink(org.id, userId),
      kbForgetUser: async (userId) => {
        if (kb) await kb.forgetUser(userId);
      },
    });
  }

  async function refresh(): Promise<void> {
    const entries = await config.list();
    const cfg = new Map(entries.map((e) => [e.key, parseValue(e.value)]));
    const get = (key: string): string | undefined => cfg.get(key) || undefined;

    const settings = resolveModelConfig(get);
    let model: ChatModel | null = null;
    if (settings) {
      languageModel = buildLanguageModel(settings);
      model = toChatModel(languageModel);
    } else {
      languageModel = null;
    }

    await buildSlack(get);
    await buildKb(get);
    slackChannelTools = await buildSlackTools(config, logger);

    const tools = createToolProvider({
      slack: () => slackChannelTools,
      gmailAndCalendar: (userId) => buildGoogleTools(userId, userCapabilities, logger),
      mySlackMessages: (userId) => buildSlackUserTools(userId, userCapabilities, logger),
      myKnowledge: (userId) => (kb ? kb.myKnowledge(userId) : Promise.resolve({})),
      workspaceKnowledge: () => (kb ? kb.workspaceKnowledge() : Promise.resolve({})),
      mcp: (userId) => mcpToolGroups(userId, { servers: mcpServers, pool: platform.mcpPool }),
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
          messenger: () => (slackApp ? messenger : null),
          logger,
        })
      : null;
    logger.info({ model: settings?.provider ?? null, slack: !!slackApp, kb: kbState.enabled }, "org runtime ready");
  }

  await refresh();

  return {
    get org() {
      return org;
    },
    stores: { ...stores, userCapabilities },
    assistant: assistantFacade,
    mcpServers,
    oauth,
    slackApp: () => slackApp,
    kb: () => kb,
    refresh,
    setOrg(next) {
      org = next;
    },

    async rebuildKnowledge() {
      await wipeOrgKnowledge(platform.pool, org.id);
      await config.delete("kb.embedModel");
      kb = null;
      await refresh();
    },

    async status() {
      const google = await oauth.resolve("google.gmail");
      const slackClient = await config.getTyped<string>("slack.clientOwner", "");
      return {
        model: languageModel !== null,
        slack: {
          installed: slackApp !== null,
          teamId: org.slackTeamId,
          client: slackClient === "org" || slackClient === "platform" ? slackClient : null,
        },
        google: google.ok
          ? { available: true, client: google.ref.owner, pilot: google.pilot }
          : { available: false, client: null, pilot: false, reason: google.message },
        kb: kbState,
      };
    },

    async close() {
      kb = null;
      slackApp = null;
    },
  };
}
