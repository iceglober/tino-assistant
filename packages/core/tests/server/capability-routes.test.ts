/**
 * Wave 3 (v2.2) — § 3.1 server route tests for /api/capabilities.
 *
 * GET  /api/capabilities      → list per-capability views with `fields`
 * PUT  /api/capabilities/:id  → write `capability.<id>` blob
 *
 * GET always returns one entry per capability module declared in
 * `ALL_CAPABILITIES` — even modules with no stored blob — so the console
 * can render an empty card. PUT validates the id against the same module
 * list and returns 400 for unknown ids.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthVariables } from "../../src/server/middleware/auth.js";
import { createCapabilityRoutes } from "../../src/server/routes/capabilities.js";
import { makeConfigStore, noopLogger } from "./_helpers.js";

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

function mountCapabilities(
  opts: Parameters<typeof createCapabilityRoutes>[0],
  user: AuthVariables["user"] = adminUser,
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api/capabilities", createCapabilityRoutes(opts));
  return app;
}

describe("GET /api/capabilities", () => {
  it("returns one view per declared capability with field schemas", async () => {
    const app = mountCapabilities({ config: makeConfigStore(), logger: noopLogger() });

    const res = await app.request("/api/capabilities");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      displayName: string;
      enabled: boolean;
      fields: Array<{ key: string; label: string; target: string }>;
    }>;
    // Every declared capability shows up, regardless of whether it has a stored blob.
    const ids = body.map((v) => v.id);
    expect(ids).toContain("github");
    expect(ids).toContain("linear");
    // Field schemas come through (e.g., github exposes OAuth fields).
    const github = body.find((v) => v.id === "github");
    expect(github?.fields.some((f) => f.key === "clientId")).toBe(true);
    // No stored blob → enabled defaults to false.
    expect(github?.enabled).toBe(false);
  });

  it("hydrates stored capability config into field values", async () => {
    const config = makeConfigStore({
      "capability.github": {
        enabled: true,
        credentials: { clientId: "Iv1.test", clientSecret: "sec_test" },
        settings: {},
      },
    });
    const app = mountCapabilities({ config, logger: noopLogger() });

    const res = await app.request("/api/capabilities");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      enabled: boolean;
      fields: Array<{ key: string; value?: string }>;
    }>;
    const github = body.find((v) => v.id === "github");
    expect(github?.enabled).toBe(true);
    const idField = github?.fields.find((f) => f.key === "clientId");
    expect(idField?.value).toBe("Iv1.test");
  });
});

describe("PUT /api/capabilities/:id", () => {
  it("writes the capability blob and returns { ok: true, id }", async () => {
    const config = makeConfigStore();
    const app = mountCapabilities({ config, logger: noopLogger() });

    const res = await app.request("/api/capabilities/github", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        fields: [{ key: "clientId", value: "Iv1.new" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "github" });

    // The blob landed under `capability.github` with the field value tucked
    // into the right `credentials.<key>` slot.
    const stored = await config.get("capability.github");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as {
      enabled: boolean;
      credentials: Record<string, string>;
    };
    expect(parsed.enabled).toBe(true);
    expect(parsed.credentials.clientId).toBe("Iv1.new");
  });

  it("returns 400 for an unknown capability id", async () => {
    const app = mountCapabilities({ config: makeConfigStore(), logger: noopLogger() });

    const res = await app.request("/api/capabilities/not-a-capability", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, fields: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unknown capability/);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const app = mountCapabilities({ config: makeConfigStore(), logger: noopLogger() });

    const res = await app.request("/api/capabilities/github", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/JSON/);
  });
});

describe("requireAdmin enforcement on /api/capabilities", () => {
  it("member cannot GET /api/capabilities", async () => {
    const app = mountCapabilities({ config: makeConfigStore(), logger: noopLogger() }, memberUser);
    const res = await app.request("/api/capabilities");
    expect(res.status).toBe(403);
  });

  it("member cannot PUT /api/capabilities/:id", async () => {
    const app = mountCapabilities({ config: makeConfigStore(), logger: noopLogger() }, memberUser);
    const res = await app.request("/api/capabilities/github", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, fields: [] }),
    });
    expect(res.status).toBe(403);
  });
});
