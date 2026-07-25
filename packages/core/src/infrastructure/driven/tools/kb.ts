/**
 * KB retrieval tools. `kb_search_mine`'s user id is bound in the closure at
 * build time — it never appears in a tool schema and can never be
 * model-supplied. Tools only appear when the scope actually has rows (cached
 * count, 5 min) so the model isn't offered an empty index.
 */
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { ConfigStore, Embedder, KbScope, KbSource, KnowledgeStore, Logger } from "../../../ports/outbound.js";

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

const visibilityCache = new Map<string, { at: number; visible: boolean }>();
const VISIBILITY_TTL = 5 * 60 * 1000;

async function hasRows(store: KnowledgeStore, scope: KbScope, userId: string): Promise<boolean> {
  const key = `${scope}:${userId}`;
  const cached = visibilityCache.get(key);
  if (cached && Date.now() - cached.at < VISIBILITY_TTL) return cached.visible;
  const stats = await store.stats(scope, userId).catch(() => ({ chunks: 0, oldestMs: null, newestMs: null }));
  const visible = stats.chunks > 0;
  visibilityCache.set(key, { at: Date.now(), visible });
  return visible;
}

export interface KbToolDeps {
  store: KnowledgeStore;
  embedder: Embedder;
  config: ConfigStore;
  logger: Logger;
}

export async function buildKbTools(userId: string, deps: KbToolDeps): Promise<ToolSet> {
  const { store, embedder, config, logger } = deps;

  const run = async (
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

  const tools: ToolSet = {};

  if (await hasRows(store, "workspace", "")) {
    tools.kb_search_workspace = tool({
      description:
        "Semantic search over the indexed history (~90 days) of public Slack channels the bot is in. " +
        "Ranked by meaning AND recency. Use for 'what happened with X', 'catch me up', 'what has the team been discussing'. " +
        "Each hit has text, an ISO timestamp, and a permalink — open the thread with slack tools for the full discussion.",
      inputSchema: workspaceSchema,
      execute: (input) => run("workspace", "", input),
    });
  }

  if (await hasRows(store, "user", userId)) {
    tools.kb_search_mine = tool({
      description:
        "Semantic search over the CURRENT USER's own indexed history (~90 days): their DMs, group DMs, private channels, and email. " +
        "Ranked by meaning AND recency. PREFER this for open-ended questions about the user's work, problems, or projects. " +
        "Follow up hits via permalink (slack_read_my_thread) or gmail id (gmail_get_message) before answering in depth.",
      inputSchema: mineSchema,
      execute: (input) =>
        run("user", userId, input, input.sources === "slack" ? ["slack_dm", "slack_thread"] : input.sources === "gmail" ? ["gmail"] : undefined),
    });
  }

  return tools;
}
