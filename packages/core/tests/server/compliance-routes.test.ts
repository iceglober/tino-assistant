/**
 * Wave 3 (v2.2) — § 3.1 server route tests for GET /api/compliance.
 *
 * Asserts the response has the HIPAA snapshot shape:
 *   { hipaa: { encryption, auditLogging, dataRetention, baaStatus, accessControl } }
 *
 * The route reads `tino.deploy.json` from disk to surface BAA + retention
 * fields. We don't stub the filesystem here — the route's `try/catch`
 * gracefully falls back to defaults when the file is missing or malformed,
 * which is exactly the path exercised when the tests run from the
 * `packages/core` working directory.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMemoryAuditLogger } from "../../src/audit/memory.js";
import { createComplianceRoutes } from "../../src/server/routes/compliance.js";
import { makeConfigStore } from "./_helpers.js";

function mountCompliance(opts: Parameters<typeof createComplianceRoutes>[0]): Hono {
  const app = new Hono();
  app.route("/api/compliance", createComplianceRoutes(opts));
  return app;
}

describe("GET /api/compliance", () => {
  it("returns a HIPAA snapshot with encryption, audit, retention, BAA, and access sections", async () => {
    const app = mountCompliance({
      config: makeConfigStore(),
      auditLogger: createMemoryAuditLogger(),
    });

    const res = await app.request("/api/compliance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hipaa: {
        encryption: { dynamodb: string; secretsManager: string; cloudwatchLogs: string };
        auditLogging: { enabled: boolean; entryCount: number; retentionDays: number };
        dataRetention: { ttlEnabled: boolean; auditRetentionDays: number; historyRetentionDays: number };
        baaStatus: Record<string, string>;
        accessControl: { userCount: number; adminCount: number };
      };
    };

    // All five HIPAA sections are present.
    expect(body.hipaa.encryption).toBeDefined();
    expect(body.hipaa.auditLogging).toBeDefined();
    expect(body.hipaa.dataRetention).toBeDefined();
    expect(body.hipaa.baaStatus).toBeDefined();
    expect(body.hipaa.accessControl).toBeDefined();

    // Audit logger is wired → enabled=true, entryCount=0 (we logged nothing).
    expect(body.hipaa.auditLogging.enabled).toBe(true);
    expect(body.hipaa.auditLogging.entryCount).toBe(0);

    // Retention defaults are honest fallbacks (90/30) when no deploy.json is found.
    expect(body.hipaa.dataRetention.auditRetentionDays).toBeGreaterThan(0);
    expect(body.hipaa.dataRetention.historyRetentionDays).toBeGreaterThan(0);
  });

  it("reports auditLogging.enabled=false when no audit logger is wired", async () => {
    const app = mountCompliance({
      config: makeConfigStore(),
      auditLogger: undefined,
    });

    const res = await app.request("/api/compliance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hipaa: { auditLogging: { enabled: boolean; entryCount: number } };
    };
    expect(body.hipaa.auditLogging.enabled).toBe(false);
    expect(body.hipaa.auditLogging.entryCount).toBe(0);
  });

  it("counts user.* and admin.* config entries for accessControl", async () => {
    const config = makeConfigStore({
      "user.U001.status": "active",
      "user.U002.status": "active",
      "admin.U003": true,
    });
    const app = mountCompliance({ config, auditLogger: undefined });

    const res = await app.request("/api/compliance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hipaa: { accessControl: { userCount: number; adminCount: number } };
    };
    // Two `user.*` entries, one `admin.*` — but the route uses Math.max with
    // 1, so the floor is always at least 1. With real entries we should see
    // the actual count.
    expect(body.hipaa.accessControl.userCount).toBe(2);
    expect(body.hipaa.accessControl.adminCount).toBe(1);
  });
});
