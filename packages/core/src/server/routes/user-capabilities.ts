import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import { ALL_CAPABILITIES } from "../../capabilities/all.js";
import { buildCapabilityView, buildConfigFromPayload, findCapability } from "../../capabilities/schema.js";
import type { CapabilityConfig } from "../../capabilities/types.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { UserCapabilityStore } from "../../persistence/user-capabilities.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * /api/user-capabilities/:userId — per-user capability management.
 *
 * Per-user capabilities are stored under `user.<tinoUserId>.capability.<id>` keys.
 * Each user can only access their own capabilities via their userId from the auth context.
 *
 * Endpoints:
 *   GET /  — list user's private capabilities
 *   PUT /:capabilityId — save/configure private capability
 *   DELETE /:capabilityId — disconnect private capability
 */
export function createUserCapabilityRoutes(opts: {
  config: ConfigStore;
  logger: AppLogger;
  auditLogger?: AuditLogger;
  userCapabilities?: UserCapabilityStore;
}): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { config, logger, auditLogger, userCapabilities } = opts;

  /**
   * GET /api/user-capabilities/:userId
   * Returns the list of private capabilities for this user (scoped by userId).
   */
  app.get("/:userId", async (c) => {
    const userId = decodeURIComponent(c.req.param("userId"));
    if (!userId) return c.json({ error: "Missing userId" }, 400);

    // Get logged-in user from auth context
    const loggedInUser = c.get("user");
    if (!loggedInUser) return c.json({ error: "unauthorized" }, 401);

    // Verify user is accessing their own data
    if (loggedInUser.id !== userId) {
      return c.json({ error: "Forbidden: cannot access other user's capabilities" }, 403);
    }

    // Load per-user capability entries from both stores.
    // UserCapabilityStore (encrypted, wave 2) takes precedence over ConfigStore.
    const stored = new Map<string, { config: CapabilityConfig | null; updatedAt: number }>();

    // Check UserCapabilityStore first (encrypted per-user credentials)
    if (userCapabilities) {
      const ucList = await userCapabilities.list(userId);
      for (const { capabilityId, enabled } of ucList) {
        try {
          const cfg = await userCapabilities.get(userId, capabilityId);
          if (cfg) stored.set(capabilityId, { config: cfg, updatedAt: Date.now() });
        } catch {
          stored.set(capabilityId, { config: { enabled, credentials: {}, settings: {} }, updatedAt: Date.now() });
        }
      }
    }

    // Fall back to ConfigStore for capabilities not found in UserCapabilityStore
    const entries = await config.list();
    for (const e of entries) {
      const prefix = `user.${userId}.capability.`;
      if (!e.key.startsWith(prefix)) continue;
      const id = e.key.slice(prefix.length);
      if (stored.has(id)) continue;
      let parsed: CapabilityConfig | null = null;
      try {
        parsed = JSON.parse(e.value) as CapabilityConfig;
      } catch { /* malformed JSON */ }
      stored.set(id, { config: parsed, updatedAt: e.updatedAt });
    }

    // Return one entry per private capability module (in declaration order).
    // Shows all available private capabilities so users can see what's connectable,
    // with stored config merged in for already-configured ones.
    const views = ALL_CAPABILITIES
      .filter((cap) => cap.scope === "private")
      .map((cap) => {
        const s = stored.get(cap.id);
        return buildCapabilityView(cap, s?.config ?? null, s?.updatedAt);
      });

    return c.json(views);
  });

  /**
   * PUT /api/user-capabilities/:userId/:capabilityId
   * Saves or updates a private capability configuration for this user.
   */
  app.put("/:userId/:capabilityId", async (c) => {
    const userId = decodeURIComponent(c.req.param("userId"));
    const capabilityId = decodeURIComponent(c.req.param("capabilityId"));

    if (!userId) return c.json({ error: "Missing userId" }, 400);
    if (!capabilityId) return c.json({ error: "Missing capability id" }, 400);

    // Get logged-in user from auth context
    const loggedInUser = c.get("user");
    if (!loggedInUser) return c.json({ error: "unauthorized" }, 401);

    // Verify user is accessing their own data
    if (loggedInUser.id !== userId) {
      return c.json({ error: "Forbidden: cannot modify other user's capabilities" }, 403);
    }

    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const cap = findCapability(capabilityId);
    if (!cap) return c.json({ error: `Unknown capability: ${capabilityId}` }, 400);

    // Read the existing blob so unknown fields survive a save
    let existing: CapabilityConfig | null = null;
    const raw = await config.get(`user.${userId}.capability.${capabilityId}`);
    if (raw) {
      try {
        existing = JSON.parse(raw) as CapabilityConfig;
      } catch {
        existing = null;
      }
    }

    const next = buildConfigFromPayload(cap, parsed, existing);
    const key = `user.${userId}.capability.${capabilityId}`;
    await config.set(key, next);

    // Audit
    if (auditLogger) {
      await auditLogger.log({
        userId: loggedInUser.email,
        action: "config_change",
        toolName: capabilityId,
        status: "success",
      });
    }

    logger.info({ userId, capabilityId }, "user capability config updated via console");
    return c.json({ ok: true, userId, id: capabilityId });
  });

  /**
   * DELETE /api/user-capabilities/:userId/:capabilityId
   * Removes a private capability configuration for this user.
   */
  app.delete("/:userId/:capabilityId", async (c) => {
    const userId = decodeURIComponent(c.req.param("userId"));
    const capabilityId = decodeURIComponent(c.req.param("capabilityId"));

    if (!userId) return c.json({ error: "Missing userId" }, 400);
    if (!capabilityId) return c.json({ error: "Missing capability id" }, 400);

    // Get logged-in user from auth context
    const loggedInUser = c.get("user");
    if (!loggedInUser) return c.json({ error: "unauthorized" }, 401);

    // Verify user is accessing their own data
    if (loggedInUser.id !== userId) {
      return c.json({ error: "Forbidden: cannot delete other user's capabilities" }, 403);
    }

    const key = `user.${userId}.capability.${capabilityId}`;
    await config.delete(key);
    if (userCapabilities) {
      await userCapabilities.delete(userId, capabilityId);
    }

    // Audit
    if (auditLogger) {
      await auditLogger.log({
        userId: loggedInUser.email,
        action: "config_change",
        toolName: capabilityId,
        status: "success",
      });
    }

    logger.info({ userId, capabilityId }, "user capability config deleted via console");
    return c.json({ ok: true, userId, id: capabilityId });
  });

  return app;
}
