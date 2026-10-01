import { isValidMcpId, type McpAuth, type McpScope, mcpUrlProblem } from "@tino/core/domain/mcp";
import type { Logger } from "@tino/core/ports/outbound";
import { Hono } from "hono";
import type { McpClientPool } from "../../../driven/mcp/client-pool.js";
import type { StoredMcpServer } from "../../../driven/mcp/store.js";
import type { AuthVariables } from "../auth.js";

/**
 * /api/orgs/:slug/mcp — remote MCP servers.
 *
 *   GET    /servers              → workspace servers + the caller's personal ones
 *   PUT    /servers/:scope/:id   → create/update (workspace scope: admins only)
 *   DELETE /servers/:scope/:id   → remove (workspace scope: admins only)
 *   POST   /test                 → connect + list tools without saving
 *
 * Tokens are write-only: responses carry `hasToken`, never the token. Omitting
 * `token` on update keeps the stored one; sending "" clears it.
 */
export function createMcpRoutes(opts: { pool: McpClientPool; logger: Logger }): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { pool, logger } = opts;

  app.use("*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  const view = ({ token, ...s }: StoredMcpServer) => ({ ...s, hasToken: !!token });

  interface Body {
    name?: string;
    url?: string;
    transport?: string;
    auth?: { kind?: string; headerName?: string };
    token?: string;
    enabled?: boolean;
    resultsVisibleTo?: string;
  }

  /** Validate a request body into a server config, or return an error message. */
  function parse(id: string, scope: McpScope, b: Body, existing: StoredMcpServer | null): StoredMcpServer | string {
    const url = (b.url ?? existing?.url ?? "").trim();
    const problem = mcpUrlProblem(url);
    if (problem) return problem;
    let auth: McpAuth;
    const kind = b.auth?.kind ?? existing?.auth.kind ?? "none";
    if (kind === "bearer") auth = { kind: "bearer" };
    else if (kind === "header") {
      const headerName = (
        b.auth?.headerName ?? (existing?.auth.kind === "header" ? existing.auth.headerName : "")
      ).trim();
      if (!/^[A-Za-z0-9-]+$/.test(headerName)) return "a header name is required for header auth";
      auth = { kind: "header", headerName };
    } else auth = { kind: "none" };
    return {
      id,
      scope,
      name: (b.name ?? existing?.name ?? id).trim() || id,
      url,
      transport: (b.transport ?? existing?.transport) === "sse" ? "sse" : "http",
      auth,
      enabled: b.enabled ?? existing?.enabled ?? true,
      resultsVisibleTo:
        scope === "workspace" && (b.resultsVisibleTo ?? existing?.resultsVisibleTo) === "workspace"
          ? "workspace"
          : "asker",
      token: b.token === undefined ? existing?.token : b.token || undefined,
    };
  }

  const scopeParam = (raw: string): McpScope | null => (raw === "workspace" || raw === "personal" ? raw : null);

  app.get("/servers", async (c) => {
    const servers = c.get("org").mcpServers;
    const user = c.get("user");
    const all = await servers.listFor(user.id);
    return c.json({
      canManageWorkspace: user.role === "admin",
      workspace: all.filter((s) => s.scope === "workspace").map(view),
      personal: all.filter((s) => s.scope === "personal").map(view),
    });
  });

  app.put("/servers/:scope/:id", async (c) => {
    const servers = c.get("org").mcpServers;
    const user = c.get("user");
    const scope = scopeParam(c.req.param("scope"));
    const id = c.req.param("id");
    if (!scope) return c.json({ error: "scope must be workspace or personal" }, 400);
    if (!isValidMcpId(id)) return c.json({ error: "id must be 1–24 lowercase letters, digits, or dashes" }, 400);
    if (scope === "workspace" && user.role !== "admin") return c.json({ error: "admins only" }, 403);

    let body: Body;
    try {
      body = (await c.req.json()) as Body;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    // Tool names are `mcp_<id>_…` for both scopes, so ids must not collide across them.
    const other = await servers.get(scope === "workspace" ? "personal" : "workspace", user.id, id);
    if (other) return c.json({ error: `id "${id}" is already used by a ${other.scope} server` }, 409);

    const existing = await servers.get(scope, user.id, id);
    const parsed = parse(id, scope, body, existing);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    await servers.save(user.id, parsed);
    await pool.evict(servers.ownerOf(scope, user.id), id);
    logger.info({ by: user.id, scope, server: id }, existing ? "mcp server updated" : "mcp server added");
    return c.json(view(parsed));
  });

  app.delete("/servers/:scope/:id", async (c) => {
    const servers = c.get("org").mcpServers;
    const user = c.get("user");
    const scope = scopeParam(c.req.param("scope"));
    const id = c.req.param("id");
    if (!scope) return c.json({ error: "scope must be workspace or personal" }, 400);
    if (scope === "workspace" && user.role !== "admin") return c.json({ error: "admins only" }, 403);
    const removed = await servers.remove(scope, user.id, id);
    await pool.evict(servers.ownerOf(scope, user.id), id);
    if (removed) logger.info({ by: user.id, scope, server: id }, "mcp server removed");
    return c.json({ ok: true, removed });
  });

  app.post("/test", async (c) => {
    const servers = c.get("org").mcpServers;
    const user = c.get("user");
    let body: Body & { id?: string; scope?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const scope = scopeParam(body.scope ?? "personal") ?? "personal";
    if (scope === "workspace" && user.role !== "admin") return c.json({ error: "admins only" }, 403);
    // Testing an edit of a saved server reuses its stored token when none is typed.
    const existing = body.id && isValidMcpId(body.id) ? await servers.get(scope, user.id, body.id) : null;
    const parsed = parse(body.id && isValidMcpId(body.id) ? body.id : "test", scope, body, existing);
    if (typeof parsed === "string") return c.json({ ok: false, error: parsed });
    try {
      const tools = await pool.probe(parsed);
      return c.json({ ok: true, tools });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message });
    }
  });

  return app;
}
