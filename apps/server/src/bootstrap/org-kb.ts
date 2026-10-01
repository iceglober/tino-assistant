/**
 * One org's knowledge base: its store, sources, indexer and synthesizer, the
 * agent's knowledge tools, and what the console reads. Built by the org's
 * runtime once the org has an embedder; the platform scheduler drives
 * `indexer.runCycleOnce()` for each org in turn.
 */
import type { ToolSet } from "ai";
import { createKbIndexer, type KbIndexer } from "@tino/core/application/kb-indexer";
import { createKbSynthesizer } from "@tino/core/application/kb-synthesizer";
import { parseDontLearnFrom } from "@tino/core/domain/dont-learn-from";
import type { KnowledgeExtractor, KnowledgeStore, Logger } from "@tino/core/ports/outbound";
import { createDontLearnFromStore } from "../infrastructure/driven/kb/dont-learn-from-store.js";
import type { NamedEmbedder } from "../infrastructure/driven/kb/embedders.js";
import { createGmailKbSource } from "../infrastructure/driven/kb/sources/gmail.js";
import { gmailClientFor, gmailExclusionOptions } from "../infrastructure/driven/kb/sources/gmail-exclusions.js";
import { createSlackKbSource } from "../infrastructure/driven/kb/sources/slack.js";
import type { OrgStores } from "../infrastructure/driven/persistence/postgres/index.js";
import { buildMyKnowledgeTools, buildWorkspaceKnowledgeTools } from "../infrastructure/driven/tools/kb.js";
import type { KbRoutesDeps } from "../infrastructure/driving/http/routes/kb.js";

export interface OrgKb {
  indexer: KbIndexer;
  store: KnowledgeStore;
  workspaceKnowledge: () => Promise<ToolSet>;
  myKnowledge: (userId: string) => Promise<ToolSet>;
  forgetUser: (userId: string) => Promise<void>;
  reactivate: (userId: string, source: "slack" | "gmail") => Promise<void>;
  routes: KbRoutesDeps;
}

export function createOrgKb(opts: {
  stores: OrgStores & { knowledge: NonNullable<OrgStores["knowledge"]> };
  embedder: NamedEmbedder;
  /** Distillation rides whatever model the org has configured right now. */
  extractor: () => KnowledgeExtractor | null;
  notifyAuthLoss: (userId: string, source: "slack" | "gmail") => Promise<void>;
  logger: Logger;
}): OrgKb {
  const { stores, embedder, extractor, notifyAuthLoss, logger } = opts;
  const { config, users, userCapabilities } = stores;
  const kbStore = stores.knowledge(embedder.model);
  const dontLearnFrom = createDontLearnFromStore(userCapabilities);
  const srcDeps = { store: kbStore, embedder, config, userCapabilities, dontLearnFrom, logger };
  const synthesizer = createKbSynthesizer({ store: kbStore, embedder, extractor, config, logger });
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
    notifyAuthLoss,
  });

  /** Console scope → the (scope, userId) pair the store expects. */
  const resolve = (scope: "workspace" | "private", userId: string): ["workspace" | "private", string] =>
    scope === "workspace" ? ["workspace", ""] : ["private", userId];

  const routes: KbRoutesDeps = {
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
        embedModel: embedder.model,
        // Distillation is off without a model; the page says so rather than
        // showing an empty knowledge list forever.
        distilling: extractor() !== null,
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

    dontLearnFrom: {
      get: async (userId) => {
        const exclusions = await dontLearnFrom.get(userId);
        const gmail = await gmailClientFor(userId, userCapabilities);
        if (!gmail) return { exclusions, gmailConnected: false, options: null };
        try {
          return { exclusions, gmailConnected: true, options: await gmailExclusionOptions(gmail) };
        } catch (err) {
          logger.warn({ userId, err: (err as Error).message }, "couldn't read gmail labels/filters");
          return { exclusions, gmailConnected: true, options: null, optionsError: "couldn't read your Gmail labels and filters" };
        }
      },
      set: async (userId, input) => {
        const parsed = parseDontLearnFrom(input);
        if (typeof parsed === "string") return { ok: false as const, error: parsed };
        await dontLearnFrom.set(userId, parsed);
        return { ok: true as const, value: { exclusions: parsed, appliesBy: indexer.status().nextRunAt ?? null } };
      },
    },

    activity: async (userId, limit) => {
      const events = await kbStore.listCycleEvents(userId, limit);
      return { items: events.map((e) => ({ ...e, at: new Date(e.at).toISOString() })) };
    },
  };

  const toolDeps = { store: kbStore, embedder, config, logger };
  return {
    indexer,
    store: kbStore,
    workspaceKnowledge: () => buildWorkspaceKnowledgeTools(toolDeps),
    myKnowledge: (userId) => buildMyKnowledgeTools(userId, toolDeps),
    forgetUser: (userId) => kbStore.forgetUser(userId),
    reactivate: async (userId, source) => {
      await kbStore.setIndexState({ scope: "private", userId, source, status: "active", backfillDone: false });
    },
    routes,
  };
}
