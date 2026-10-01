/**
 * The org itself, for its members:
 *
 *   GET  /                      → overview: org, me, setup status, my connections
 *   GET  /settings              → non-secret values + which secrets are set (admin)
 *   PUT  /settings              → { values: { key: value | null } } (admin; known keys only)
 *   POST /settings/apply        → rebuild the runtime from saved settings (admin)
 *   POST /kb/rebuild            → wipe the knowledge base and start over (admin)
 *
 * Secrets are write-only: no response ever carries one.
 */

import {
  type ApplyResult,
  type OrgOverview,
  SETTING_KEYS,
  SETTINGS,
  type SettingsUpdate,
  type SettingsView,
} from "@tino/contracts";
import { isSecretConfigKey } from "@tino/core/domain/org";
import type { Logger } from "@tino/core/ports/outbound";
import { Hono } from "hono";
import { type AuthVariables, authorize } from "../auth.js";

export function createOrgRoutes(opts: { logger: Logger }): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { logger } = opts;

  app.get("/", async (c) => {
    const rt = c.get("org");
    const me = c.get("user");
    const caps = await rt.stores.userCapabilities.list(me.id);
    const has = (id: string) => caps.some((x) => x.capabilityId === id && x.enabled);
    const body: OrgOverview = {
      org: { id: rt.org.id, slug: rt.org.slug, name: rt.org.name },
      me,
      status: await rt.status(),
      connections: {
        google: has("gmail") || has("calendar"),
        slack: has("slack"),
        mcpServers: caps.filter((x) => x.capabilityId.startsWith("mcp.")).length,
      },
    };
    return c.json(body);
  });

  app.get("/settings", authorize("read", "settings"), async (c) => {
    const entries = await c.get("org").stores.config.list();
    const byKey = new Map(entries.map((e) => [e.key, e.value]));
    const view: SettingsView = { values: {}, secrets: {} };
    for (const spec of SETTINGS) {
      const raw = byKey.get(spec.key);
      if (spec.secret) {
        view.secrets[spec.key] = raw !== undefined;
      } else if (raw !== undefined) {
        try {
          view.values[spec.key] = JSON.parse(raw) as string | number | boolean;
        } catch {
          view.values[spec.key] = raw;
        }
      }
    }
    return c.json(view);
  });

  app.put("/settings", authorize("update", "settings"), async (c) => {
    let body: SettingsUpdate;
    try {
      body = (await c.req.json()) as SettingsUpdate;
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const values = body?.values;
    if (!values || typeof values !== "object") return c.json({ error: 'body must be { "values": { … } }' }, 400);
    const unknown = Object.keys(values).filter((k) => !SETTING_KEYS.has(k));
    if (unknown.length) return c.json({ error: `unknown settings: ${unknown.join(", ")}` }, 400);

    const { config } = c.get("org").stores;
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === "") await config.delete(key);
      else if (typeof value === "string" || typeof value === "number")
        await config.set(key, typeof value === "string" ? value.trim() : value);
      else return c.json({ error: `${key} must be a string or number` }, 400);
    }
    logger.info(
      {
        org: c.get("org").org.slug,
        by: c.get("user").id,
        keys: Object.keys(values).map((k) => (isSecretConfigKey(k) ? `${k}*` : k)),
      },
      "settings updated",
    );
    return c.json({ ok: true });
  });

  app.post("/settings/apply", authorize("update", "settings"), async (c) => {
    const rt = c.get("org");
    try {
      await rt.refresh();
      const body: ApplyResult = { ok: true, status: await rt.status() };
      return c.json(body);
    } catch (err) {
      logger.error({ org: rt.org.slug, err: (err as Error).message }, "settings apply failed");
      const body: ApplyResult = { ok: false, error: (err as Error).message, status: await rt.status() };
      return c.json(body);
    }
  });

  app.post("/kb/rebuild", authorize("delete", "knowledgeBase"), async (c) => {
    const rt = c.get("org");
    await rt.rebuildKnowledge();
    logger.info({ org: rt.org.slug, by: c.get("user").id }, "knowledge base rebuilt");
    return c.json({ ok: true, status: await rt.status() });
  });

  return app;
}
