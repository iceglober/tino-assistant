import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import type { McpAuth, McpServerEntry, McpTransport } from "../../mcp/catalog.js";
import { MCP_CATALOG } from "../../mcp/catalog.js";
import type { MCPPool } from "../../mcp/pool.js";
import { validateServerUrl } from "../../mcp/validateServerUrl.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { UserCapabilityStore } from "../../persistence/user-capabilities.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

const REMOTE_TRANSPORTS: McpTransport[] = ["streamable-http", "sse"];

/**
 * /api/mcp — MCP server catalog and per-user server credential management.
 *
 * Endpoints:
 *   GET /catalog — list available MCP servers with public fields
 *   GET /servers — list user's configured MCP servers
 *   POST /servers/:id — save/configure MCP server credentials
 *   DELETE /servers/:id — disconnect MCP server
 */
export function createMcpRoutes(opts: {
  config: ConfigStore;
  logger: AppLogger;
  auditLogger?: AuditLogger;
  userCapabilities?: UserCapabilityStore;
  pool?: MCPPool;
}): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { config, logger, auditLogger, userCapabilities, pool } = opts;

  /**
   * GET /api/mcp/catalog
   * Returns available MCP servers with public fields only (id, displayName, description, icon, fields).
   */
  app.get("/catalog", (c) => {
    const publicCatalog = MCP_CATALOG.map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      icon: entry.icon,
      fields: entry.fields,
    }));
    return c.json(publicCatalog);
  });

  /**
   * GET /api/mcp/servers
   * Returns the list of MCP servers configured for this user.
   */
  app.get("/servers", async (c) => {
    const loggedInUser = c.get("user");
    if (!loggedInUser) return c.json({ error: "unauthorized" }, 401);

    if (!userCapabilities) {
      return c.json([]);
    }

    const serverConfigs = await userCapabilities.list(loggedInUser.id);
    const mcpServers = serverConfigs.filter((s) => s.capabilityId.startsWith("mcp."));

    const result = [];
    for (const serverConfig of mcpServers) {
      const serverId = serverConfig.capabilityId.replace(/^mcp\./, "");
      const config = await userCapabilities.get(loggedInUser.id, serverConfig.capabilityId);
      const settings = (config?.settings ?? {}) as Record<string, unknown>;
      // Never return raw credentials to the client — expose only non-secret
      // config plus a flag for whether a credential is stored.
      result.push({
        serverId,
        enabled: serverConfig.enabled,
        displayName: typeof settings.displayName === "string" ? settings.displayName : serverId,
        url: typeof settings.url === "string" ? settings.url : undefined,
        transport: (settings.transport as McpTransport | undefined) ?? "stdio",
        auth: (settings.auth as McpAuth | undefined) ?? { kind: "none" },
        hasCredentials: !!config && Object.keys(config.credentials ?? {}).length > 0,
      });
    }

    return c.json(result);
  });

  /**
   * POST /api/mcp/servers/:id
   * Saves or updates MCP server credentials for this user.
   */
  app.post("/servers/:id", async (c) => {
    const serverId = decodeURIComponent(c.req.param("id"));
    if (!serverId) return c.json({ error: "Missing serverId" }, 400);

    const loggedInUser = c.get("user");
    if (!loggedInUser) return c.json({ error: "unauthorized" }, 401);

    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    if (!userCapabilities) {
      return c.json({ error: "UserCapabilityStore not available" }, 503);
    }

    const capabilityId = `mcp.${serverId}`;
    const config = parsed as {
      enabled: boolean;
      credentials: Record<string, string>;
      settings: Record<string, unknown>;
    };

    // For custom remote servers, reject a bad/unsafe URL before persisting.
    const transport = config.settings?.transport as McpTransport | undefined;
    if (transport && REMOTE_TRANSPORTS.includes(transport)) {
      const url = config.settings?.url;
      if (typeof url !== "string") return c.json({ error: "mcp_url_required" }, 400);
      try {
        validateServerUrl(url);
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
    }

    await userCapabilities.set(loggedInUser.id, capabilityId, {
      enabled: config.enabled ?? true,
      credentials: config.credentials ?? {},
      settings: config.settings ?? {},
    });

    // Audit
    if (auditLogger) {
      await auditLogger.log({
        userId: loggedInUser.email,
        action: "config_change",
        toolName: `mcp.${serverId}`,
        status: "success",
      });
    }

    logger.info({ userId: loggedInUser.id, serverId }, "MCP server credentials saved");
    return c.json({ ok: true, serverId });
  });

  /**
   * POST /api/mcp/test
   * Probe a remote MCP server without persisting it — powers the "Test connection"
   * step of the add-server wizard. Body: { url, transport, auth?, credentials? }.
   * Returns { ok: true, tools: string[] } on success, or { ok: false, error } on failure.
   */
  app.post("/test", async (c) => {
    const loggedInUser = c.get("user");
    if (!loggedInUser) return c.json({ error: "unauthorized" }, 401);
    if (!pool) return c.json({ error: "mcp_pool_unavailable" }, 503);

    let body: {
      url?: string;
      transport?: McpTransport;
      auth?: McpAuth;
      credentials?: Record<string, string>;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const transport = body.transport;
    if (!transport || !REMOTE_TRANSPORTS.includes(transport)) {
      return c.json({ ok: false, error: "mcp_transport_unsupported" }, 400);
    }
    if (typeof body.url !== "string") {
      return c.json({ ok: false, error: "mcp_url_required" }, 400);
    }
    try {
      validateServerUrl(body.url);
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 400);
    }

    const entry: McpServerEntry = {
      id: "__probe__",
      displayName: "probe",
      transport,
      url: body.url,
      auth: body.auth ?? { kind: "none" },
      fields: [],
    };
    try {
      const tools = await pool.probe(entry, body.credentials);
      return c.json({ ok: true, tools });
    } catch (err) {
      logger.warn({ userId: loggedInUser.id, err: (err as Error).message }, "MCP test connection failed");
      return c.json({ ok: false, error: (err as Error).message });
    }
  });

  /**
   * DELETE /api/mcp/servers/:id
   * Removes MCP server configuration for this user and kills the pool connection.
   */
  app.delete("/servers/:id", async (c) => {
    const serverId = decodeURIComponent(c.req.param("id"));
    if (!serverId) return c.json({ error: "Missing serverId" }, 400);

    const loggedInUser = c.get("user");
    if (!loggedInUser) return c.json({ error: "unauthorized" }, 401);

    if (!userCapabilities) {
      return c.json({ error: "UserCapabilityStore not available" }, 503);
    }

    const capabilityId = `mcp.${serverId}`;
    await userCapabilities.delete(loggedInUser.id, capabilityId);

    // Kill the pool connection for this server
    if (pool) {
      await pool.kill(loggedInUser.id, serverId);
    }

    // Audit
    if (auditLogger) {
      await auditLogger.log({
        userId: loggedInUser.email,
        action: "config_change",
        toolName: `mcp.${serverId}`,
        status: "success",
      });
    }

    logger.info({ userId: loggedInUser.id, serverId }, "MCP server config deleted");
    return c.json({ ok: true, serverId });
  });

  return app;
}
