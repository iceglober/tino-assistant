/**
 * KB retrieval tools, in two groups the tool provider labels separately:
 *   - workspace knowledge (public channels): anyone in the workspace may see it
 *   - this person's knowledge (their DMs, private channels, mail): only them
 * The user id is bound in the closure at build time — it never appears in a
 * tool schema and can never be model-supplied. Tools only appear when there is
 * something to search (cached count, 5 min).
 *
 * Two layers are searchable: chunks (what was said) and facts (what tino has
 * concluded). Facts are cheaper and more direct for "what am I working on"
 * questions; chunks are the receipts.
 */

import type {
  ConfigStore,
  Embedder,
  KbFact,
  KbScope,
  KbSource,
  KnowledgeStore,
  Logger,
} from "@tino/core/ports/outbound";
import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";

const baseSchema = {
  query: z.string().min(1).describe("Natural-language search — describe the topic, not keywords."),
  topK: z.number().int().min(1).max(20).default(8).describe("Max results (1–20, default 8)."),
  after: z.string().optional().describe("Only content after this ISO date (use for 'since June', 'this month')."),
  before: z.string().optional().describe("Only content before this ISO date."),
};

const mineSchema = z.object({
  ...baseSchema,
  sources: z.enum(["all", "slack", "gmail"]).default("all").describe("Restrict to one source."),
});
const workspaceSchema = z.object(baseSchema);

const knowSchema = z.object({
  query: z.string().min(1).describe("What you want to know about, e.g. 'current blockers', 'the Stedi work'."),
  topK: z.number().int().min(1).max(20).default(10),
});

const factView = (f: KbFact) => ({
  kind: f.kind,
  subject: f.subject,
  statement: f.statement,
  detail: f.detail,
  confidence: Number(f.confidence.toFixed(2)),
  firstSeen: new Date(f.firstSeenMs).toISOString().slice(0, 10),
  lastSeen: new Date(f.lastSeenMs).toISOString().slice(0, 10),
  evidence: f.evidence.map((e) => ({ source: e.source, ts: new Date(e.ts).toISOString(), permalink: e.permalink })),
});

const visibilityCache = new Map<string, { at: number; visible: boolean }>();
const VISIBILITY_TTL = 5 * 60 * 1000;

async function cachedVisible(key: string, probe: () => Promise<boolean>): Promise<boolean> {
  const cached = visibilityCache.get(key);
  if (cached && Date.now() - cached.at < VISIBILITY_TTL) return cached.visible;
  const visible = await probe().catch(() => false);
  visibilityCache.set(key, { at: Date.now(), visible });
  return visible;
}

const hasChunks = (store: KnowledgeStore, scope: KbScope, userId: string): Promise<boolean> =>
  cachedVisible("chunks:" + scope + ":" + userId, async () => (await store.stats(scope, userId)).chunks > 0);

const hasFacts = (store: KnowledgeStore, scope: KbScope, userId: string): Promise<boolean> =>
  cachedVisible(
    "facts:" + scope + ":" + userId,
    async () => (await store.listFacts(scope, userId, { limit: 1, offset: 0 })).total > 0,
  );

export interface KbToolDeps {
  store: KnowledgeStore;
  embedder: Embedder;
  config: ConfigStore;
  logger: Logger;
}

function searcher(deps: KbToolDeps) {
  const { store, embedder, config, logger } = deps;

  const searchChunks = async (
    scope: KbScope,
    scopeUserId: string,
    input: { query: string; topK: number; after?: string; before?: string },
    sources?: KbSource[],
  ) => {
    try {
      const [w, tau] = await Promise.all([
        config.getTyped<number>("kb.recencyWeight", 0.3),
        config.getTyped<number>("kb.recencyTauDays", 30),
      ]);
      const embedding = await embedder.embedQuery(input.query);
      const afterMs = input.after ? Date.parse(input.after) : undefined;
      const beforeMs = input.before ? Date.parse(input.before) : undefined;
      const hits = await store.search({
        scope,
        userId: scopeUserId,
        embedding,
        topK: input.topK,
        afterMs: Number.isNaN(afterMs as number) ? undefined : afterMs,
        beforeMs: Number.isNaN(beforeMs as number) ? undefined : beforeMs,
        sources,
        recencyWeight: w,
        recencyTauDays: tau,
      });
      const stats = await store.stats(scope, scopeUserId);
      return {
        hits: hits.map((h) => ({
          text: h.text.length > 1200 ? `${h.text.slice(0, 1200)}…` : h.text,
          source: h.source,
          ts: new Date(h.ts).toISOString(),
          permalink: h.permalink,
          meta: h.meta,
          score: Number(h.score.toFixed(4)),
        })),
        indexed: {
          chunks: stats.chunks,
          oldest: stats.oldestMs ? new Date(stats.oldestMs).toISOString() : null,
        },
      };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "kb search failed");
      return { error: "kb_error", message: `knowledge-base search failed: ${(err as Error).message}` };
    }
  };

  const searchFacts = async (scope: KbScope, scopeUserId: string, input: { query: string; topK: number }) => {
    try {
      const embedding = await embedder.embedQuery(input.query);
      const facts = await store.searchFacts({ scope, userId: scopeUserId, embedding, topK: input.topK });
      return { facts: facts.map(factView) };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "kb fact search failed");
      return { error: "kb_error", message: `knowledge lookup failed: ${(err as Error).message}` };
    }
  };

  return { searchChunks, searchFacts };
}

/** What tino knows about the workspace, from public channels. */
export async function buildWorkspaceKnowledgeTools(deps: KbToolDeps): Promise<ToolSet> {
  const { searchChunks, searchFacts } = searcher(deps);
  const tools: ToolSet = {};
  if (await hasChunks(deps.store, "workspace", "")) {
    tools.kb_search_workspace = tool({
      description:
        "Semantic search over the indexed history (~90 days) of the workspace's public Slack channels. " +
        "Ranked by meaning AND recency. Use for 'what happened with X', 'catch me up', 'what has the team been discussing'. " +
        "Each hit has text, an ISO timestamp, and a permalink.",
      inputSchema: workspaceSchema,
      execute: (input) => searchChunks("workspace", "", input),
    });
  }
  if (await hasFacts(deps.store, "workspace", "")) {
    tools.kb_what_the_workspace_knows = tool({
      description:
        "What tino has already CONCLUDED about the workspace — durable facts distilled from public channels: " +
        "projects and their state, open problems, decisions, people. Each fact carries dates and permalinks.",
      inputSchema: knowSchema,
      execute: (input) => searchFacts("workspace", "", input),
    });
  }
  return tools;
}

/** What tino knows about one person, from their own DMs, private channels, and mail. */
export async function buildMyKnowledgeTools(userId: string, deps: KbToolDeps): Promise<ToolSet> {
  const { searchChunks, searchFacts } = searcher(deps);
  const tools: ToolSet = {};
  if (await hasChunks(deps.store, "private", userId)) {
    tools.kb_search_mine = tool({
      description:
        "Semantic search over the CURRENT USER's own indexed history (~90 days): their DMs, group DMs, private channels, and email. " +
        "Ranked by meaning AND recency. PREFER this for open-ended questions about the user's work, problems, or projects. " +
        "Follow up hits via permalink (slack_read_my_thread) or gmail id (gmail_get_message) before answering in depth.",
      inputSchema: mineSchema,
      execute: (input) =>
        searchChunks(
          "private",
          userId,
          input,
          input.sources === "slack"
            ? ["slack_dm", "slack_thread", "slack_channel"]
            : input.sources === "gmail"
              ? ["gmail"]
              : undefined,
        ),
    });
  }
  if (await hasFacts(deps.store, "private", userId)) {
    tools.kb_what_you_know = tool({
      description:
        "What tino has already CONCLUDED about this user — durable facts distilled from their own history: " +
        "projects and their state, open problems, commitments, decisions, people, preferences. " +
        "Start here for 'what am I working on', 'what problems am I facing', 'what do you know about me'. " +
        "Each fact carries dates, so you can answer directly and cite them. Use kb_search_mine for the raw conversation.",
      inputSchema: knowSchema,
      execute: (input) => searchFacts("private", userId, input),
    });
  }
  return tools;
}
