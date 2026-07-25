/**
 * /api/kb — knowledge-base visibility for the console.
 *
 *   GET /status                     → indexer state + per-scope coverage
 *   GET /knowledge?scope=&kind=     → distilled facts (the default browse view)
 *   GET /topics?scope=              → labelled themes
 *   GET /topics/:id/chunks?scope=   → the messages behind one theme
 *   GET /browse?scope=&q=&source=   → raw chunk listing / search (drill-down)
 *   GET /activity?limit=            → per-cycle, per-source indexer log
 *
 * Auth-gated. `scope=private` is bound to the signed-in user server-side — the
 * user id is never taken from the query string.
 */
import { Hono } from "hono";
import type { KbFactKind, KbSource, Logger } from "../../../../ports/outbound.js";
import type { AuthVariables } from "../auth.js";

/** What the console asks for. 'private' always means the caller's own scope. */
export type KbConsoleScope = "workspace" | "private";

export interface KbBrowseQuery {
  scope: KbConsoleScope;
  userId: string;
  q?: string;
  source?: KbSource;
  limit: number;
  offset: number;
}

export interface KbKnowledgeQuery {
  scope: KbConsoleScope;
  userId: string;
  kind?: KbFactKind;
  subject?: string;
  limit: number;
  offset: number;
}

export interface KbRoutesDeps {
  /** Full status: indexer + coverage. */
  status: (userId: string) => Promise<unknown>;
  /** Distilled facts. */
  knowledge: (query: KbKnowledgeQuery) => Promise<unknown>;
  /** Labelled clusters. */
  topics: (scope: KbConsoleScope, userId: string) => Promise<unknown>;
  /** Chunks assigned to one cluster. */
  topicChunks: (scope: KbConsoleScope, userId: string, topicId: string) => Promise<unknown>;
  /** Raw chunk listing or semantic search, depending on `q`. */
  browse: (query: KbBrowseQuery) => Promise<unknown>;
  /** Recent indexer cycle events. */
  activity: (userId: string, limit: number) => Promise<unknown>;
  logger: Logger;
}

const SOURCES = new Set<string>(["slack_channel", "slack_thread", "slack_dm", "gmail"]);
const KINDS = new Set<string>(["project", "person", "problem", "commitment", "decision", "preference", "fact"]);

const readScope = (raw: string | undefined): KbConsoleScope => (raw === "workspace" ? "workspace" : "private");
const readLimit = (raw: string | undefined, def: number, max: number): number =>
  Math.min(Number(raw ?? def) || def, max);

export function createKbRoutes(deps?: KbRoutesDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  /** Every handler shares the same failure shape so the page can render it. */
  const guard = async (
    c: { json: (body: unknown, status?: 500) => Response },
    what: string,
    fn: () => Promise<unknown>,
  ): Promise<Response> => {
    try {
      return c.json(await fn());
    } catch (err) {
      deps?.logger.warn({ err: (err as Error).message }, "kb " + what + " failed");
      return c.json({ error: "kb_error", message: (err as Error).message }, 500);
    }
  };

  app.get("/status", async (c) => {
    if (!deps) return c.json({ enabled: false });
    return guard(c, "status", () => deps.status(c.get("user").id));
  });

  app.get("/knowledge", async (c) => {
    if (!deps) return c.json({ enabled: false, items: [], total: 0, kinds: [] });
    const rawKind = c.req.query("kind");
    const rawSubject = c.req.query("subject");
    return guard(c, "knowledge", () =>
      deps.knowledge({
        scope: readScope(c.req.query("scope")),
        userId: c.get("user").id,
        kind: rawKind && KINDS.has(rawKind) ? (rawKind as KbFactKind) : undefined,
        subject: rawSubject || undefined,
        limit: readLimit(c.req.query("limit"), 50, 200),
        offset: Math.max(Number(c.req.query("offset") ?? 0) || 0, 0),
      }),
    );
  });

  app.get("/topics", async (c) => {
    if (!deps) return c.json({ enabled: false, items: [] });
    return guard(c, "topics", () => deps.topics(readScope(c.req.query("scope")), c.get("user").id));
  });

  app.get("/topics/:id/chunks", async (c) => {
    if (!deps) return c.json({ enabled: false, items: [] });
    return guard(c, "topic chunks", () =>
      deps.topicChunks(readScope(c.req.query("scope")), c.get("user").id, c.req.param("id")),
    );
  });

  app.get("/browse", async (c) => {
    if (!deps) return c.json({ enabled: false, items: [], total: 0 });
    const rawSource = c.req.query("source");
    const q = (c.req.query("q") ?? "").trim();
    return guard(c, "browse", () =>
      deps.browse({
        scope: readScope(c.req.query("scope")),
        userId: c.get("user").id,
        q: q || undefined,
        source: rawSource && SOURCES.has(rawSource) ? (rawSource as KbSource) : undefined,
        limit: readLimit(c.req.query("limit"), 25, 100),
        offset: Math.max(Number(c.req.query("offset") ?? 0) || 0, 0),
      }),
    );
  });

  app.get("/activity", async (c) => {
    if (!deps) return c.json({ enabled: false, items: [] });
    return guard(c, "activity", () => deps.activity(c.get("user").id, readLimit(c.req.query("limit"), 60, 200)));
  });

  return app;
}
