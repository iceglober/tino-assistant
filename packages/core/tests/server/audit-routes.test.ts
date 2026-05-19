import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLogger } from "../../src/audit/logger.js";
import type { AuthVariables } from "../../src/server/middleware/auth.js";
import { createAuditRoutes } from "../../src/server/routes/audit.js";
import { noopLogger } from "./_helpers.js";

const adminUser: AuthVariables["user"] = {
  id: "tino-uuid-admin",
  email: "admin@acme.io",
  name: "Admin",
  role: "admin",
  status: "active",
  slackUserId: "U_ADMIN",
};

const memberUser: AuthVariables["user"] = {
  id: "tino-uuid-member",
  email: "member@acme.io",
  name: "Member",
  role: "member",
  status: "active",
  slackUserId: "U_MEMBER",
};

const sampleEntries: AuditEntry[] = [
  {
    timestamp: 1000,
    userId: "tino-uuid-admin",
    action: "config_change",
    toolName: "org.accessControl",
    status: "success",
  },
  {
    timestamp: 2000,
    userId: "tino-uuid-member",
    action: "tool_call",
    toolName: "gmail.send",
    status: "success",
  },
  {
    timestamp: 3000,
    userId: "tino-uuid-admin",
    action: "role_change",
    toolName: "user:tino-uuid-member",
    status: "success",
  },
  {
    timestamp: 4000,
    userId: "tino-uuid-member",
    action: "login",
    status: "success",
  },
];

function makeAuditLogger(entries: AuditEntry[] = sampleEntries): AuditLogger {
  return {
    log: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(async (opts) => {
      let filtered = [...entries];
      if (opts.userId) filtered = filtered.filter((e) => e.userId === opts.userId);
      if (opts.action) filtered = filtered.filter((e) => e.action === opts.action);
      if (opts.since) filtered = filtered.filter((e) => e.timestamp >= opts.since!);
      if (opts.limit) filtered = filtered.slice(0, opts.limit);
      return filtered;
    }),
    count: vi.fn(async () => entries.length),
    lastEntryAt: vi.fn(async () => entries.at(-1)?.timestamp),
  };
}

function buildApp(currentUser: AuthVariables["user"], auditLogger?: AuditLogger) {
  const logger = makeAuditLogger();
  const al = auditLogger ?? logger;
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", currentUser);
    await next();
  });
  app.route("/api/audit", createAuditRoutes({ auditLogger: al, logger: noopLogger() }));
  return { app, auditLogger: al };
}

describe("audit routes", () => {
  it("admin sees all entries with no filter", async () => {
    const { app } = buildApp(adminUser);
    const res = await app.request("/api/audit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: AuditEntry[] };
    expect(body.entries).toHaveLength(4);
  });

  it("member sees only their own entries", async () => {
    const { app, auditLogger } = buildApp(memberUser);
    const res = await app.request("/api/audit");
    expect(res.status).toBe(200);
    expect(auditLogger.query).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "tino-uuid-member" }),
    );
    const body = (await res.json()) as { entries: AuditEntry[] };
    for (const entry of body.entries) {
      expect(entry.userId).toBe("tino-uuid-member");
    }
  });

  it("member cannot override userId filter", async () => {
    const { app, auditLogger } = buildApp(memberUser);
    const res = await app.request("/api/audit?userId=tino-uuid-admin");
    expect(res.status).toBe(200);
    expect(auditLogger.query).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "tino-uuid-member" }),
    );
  });

  it("admin can filter by userId", async () => {
    const { app, auditLogger } = buildApp(adminUser);
    const res = await app.request("/api/audit?userId=tino-uuid-member");
    expect(res.status).toBe(200);
    expect(auditLogger.query).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "tino-uuid-member" }),
    );
    const body = (await res.json()) as { entries: AuditEntry[] };
    for (const entry of body.entries) {
      expect(entry.userId).toBe("tino-uuid-member");
    }
  });

  it("filter by action returns only that action", async () => {
    const { app } = buildApp(adminUser);
    const res = await app.request("/api/audit?action=tool_call");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: AuditEntry[] };
    for (const entry of body.entries) {
      expect(entry.action).toBe("tool_call");
    }
  });

  it("filter by since returns only entries after timestamp", async () => {
    const { app } = buildApp(adminUser);
    const res = await app.request("/api/audit?since=2500");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: AuditEntry[] };
    for (const entry of body.entries) {
      expect(entry.timestamp).toBeGreaterThanOrEqual(2500);
    }
  });

  it("limit caps the number of entries returned", async () => {
    const { app } = buildApp(adminUser);
    const res = await app.request("/api/audit?limit=2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: AuditEntry[] };
    expect(body.entries).toHaveLength(2);
  });
});
