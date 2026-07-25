/**
 * /api/kb — knowledge-base visibility for the console.
 *
 *   GET /status                     → indexer state + per-scope/source coverage
 *   GET /browse?scope=&q=&source=…  → human-readable chunk listing / search
 *
 * Auth-gated. `scope=mine` is bound to the signed-in user server-side — the
 * user id is never taken from the query string.
 */
import { Hono } from "hono";
import type { KbSource, Logger } from "../../../../ports/outbound.js";
import type { AuthVariables } from "../auth.js";

export interface KbBrowseQuery {
  scope: "workspace" | "mine";
  userId: string;
  q?: string;
  source?: KbSource;
  limit: number;
  offset: number;
}

export interface KbRoutesDeps {
  /** Full status: indexer + coverage. */
  status: (userId: string) => Promise<unknown>;
  /** Listing or semantic search, depending on `q`. */
  browse: (query: KbBrowseQuery) => Promise<unknown>;
  logger: Logger;
}

const SOURCES = new Set(["slack_channel", "slack_thread", "slack_dm", "gmail"]);

export function createKbRoutes(deps?: KbRoutesDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.get("/status", async (c) => {
    if (!deps) return c.json({ enabled: false });
    const user = c.get("user");
    return c.json(await deps.status(user.id));
  });

  app.get("/browse", async (c) => {
    if (!deps) return c.json({ enabled: false, items: [], total: 0 });
    const user = c.get("user");
    const scope = c.req.query("scope") === "workspace" ? "workspace" : "mine";
    const rawSource = c.req.query("source");
    const limit = Math.min(Number(c.req.query("limit") ?? 25) || 25, 100);
    const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
    const q = (c.req.query("q") ?? "").trim();

    try {
      return c.json(
        await deps.browse({
          scope,
          userId: user.id,
          q: q || undefined,
          source: rawSource && SOURCES.has(rawSource) ? (rawSource as KbSource) : undefined,
          limit,
          offset,
        }),
      );
    } catch (err) {
      deps.logger.warn({ err: (err as Error).message }, "kb browse failed");
      return c.json({ error: "kb_error", message: (err as Error).message }, 500);
    }
  });

  return app;
}
