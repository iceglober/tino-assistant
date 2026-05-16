/**
 * Wave 3 (v2.2) — § 3.1 server route tests for DELETE /api/users/:userId.
 *
 * The route deprovisions a user by:
 *   1. setting `user.<id>.status` to "deactivated"
 *   2. deleting every `user.<id>.capability.*` token entry
 *   3. audit-logging a `user_deprovisioned` action
 *
 * We assert against the in-memory ConfigStore + memory audit logger to
 * verify all three side effects fire, including that token entries
 * belonging to OTHER users are not touched.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMemoryAuditLogger } from "../../src/audit/memory.js";
import { createUsersRoutes } from "../../src/server/routes/users.js";
import { makeConfigStore, noopLogger } from "./_helpers.js";

function mountUsers(opts: Parameters<typeof createUsersRoutes>[0]): Hono {
  const app = new Hono();
  app.route("/api/users", createUsersRoutes(opts));
  return app;
}

describe("DELETE /api/users/:userId", () => {
  it("marks user deactivated, deletes their capability tokens, and audit-logs", async () => {
    const config = makeConfigStore({
      "user.U001.status": "active",
      "user.U001.capability.github": { token: "ghp_user1" },
      "user.U001.capability.linear": { token: "lin_user1" },
      // A different user's token stays put.
      "user.U002.capability.github": { token: "ghp_user2" },
    });
    const audit = createMemoryAuditLogger();
    const app = mountUsers({ config, logger: noopLogger(), auditLogger: audit });

    const res = await app.request("/api/users/U001", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, userId: "U001", status: "deactivated" });

    // Status flipped to deactivated.
    const status = await config.get("user.U001.status");
    expect(status).toBe(JSON.stringify("deactivated"));

    // U001's capability entries are gone.
    expect(await config.get("user.U001.capability.github")).toBeNull();
    expect(await config.get("user.U001.capability.linear")).toBeNull();

    // U002's entry is intact — we don't blast every user's tokens.
    expect(await config.get("user.U002.capability.github")).not.toBeNull();

    // Audit-logged.
    const entries = await audit.query({ action: "user_deprovisioned" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.toolName).toBe("U001");
    expect(entries[0]?.userId).toBe("console");
    expect(entries[0]?.status).toBe("success");
  });

  it("works when no audit logger is wired (no throw)", async () => {
    const config = makeConfigStore({ "user.U001.capability.github": { token: "x" } });
    const app = mountUsers({ config, logger: noopLogger(), auditLogger: undefined });

    const res = await app.request("/api/users/U001", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await config.get("user.U001.capability.github")).toBeNull();
  });

  it("decodes URL-encoded user ids", async () => {
    const config = makeConfigStore({
      "user.user@example.com.status": "active",
    });
    const app = mountUsers({ config, logger: noopLogger(), auditLogger: undefined });

    const res = await app.request(`/api/users/${encodeURIComponent("user@example.com")}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe("user@example.com");
  });
});
