import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthVariables } from "../../src/server/middleware/auth.js";
import { createInstructionRoutes } from "../../src/server/routes/instructions.js";
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

function buildApp(currentUser: AuthVariables["user"], config?: ReturnType<typeof makeConfigStore>) {
  const cfg = config ?? makeConfigStore();
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", currentUser);
    await next();
  });
  app.route("/api/instructions", createInstructionRoutes({ config: cfg, logger: noopLogger() }));
  return { app, config: cfg };
}

describe("instruction routes", () => {
  it("admin can set org instructions", async () => {
    const { app, config } = buildApp(adminUser);

    const res = await app.request("/api/instructions/org", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instructions: [{ level: "org", source: "org-policy", text: "respond in Spanish" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(config.set).toHaveBeenCalledWith(
      "org.instructions",
      [{ level: "org", source: "org-policy", text: "respond in Spanish" }],
    );
  });

  it("admin can get org instructions", async () => {
    const config = makeConfigStore({
      "org.instructions": [{ level: "org", source: "org-policy", text: "be concise" }],
    });
    const { app } = buildApp(adminUser, config);

    const res = await app.request("/api/instructions/org");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { instructions: unknown[] };
    expect(body.instructions).toHaveLength(1);
  });

  it("member cannot set org instructions", async () => {
    const { app } = buildApp(memberUser);

    const res = await app.request("/api/instructions/org", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: [] }),
    });
    expect(res.status).toBe(403);
  });

  it("member cannot get org instructions", async () => {
    const { app } = buildApp(memberUser);
    const res = await app.request("/api/instructions/org");
    expect(res.status).toBe(403);
  });

  it("member can set their own instructions", async () => {
    const { app, config } = buildApp(memberUser);

    const res = await app.request("/api/instructions/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instructions: [{ level: "user", source: "user-prefs", text: "respond in French" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(config.set).toHaveBeenCalledWith(
      "user.tino-uuid-member.instructions",
      [{ level: "user", source: "user-prefs", text: "respond in French" }],
    );
  });

  it("member can get their own instructions", async () => {
    const config = makeConfigStore({
      "user.tino-uuid-member.instructions": [{ level: "user", source: "user-prefs", text: "summarize" }],
    });
    const { app } = buildApp(memberUser, config);

    const res = await app.request("/api/instructions/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { instructions: unknown[] };
    expect(body.instructions).toHaveLength(1);
  });

  it("returns empty array when no instructions are set", async () => {
    const { app } = buildApp(memberUser);

    const orgRes = await app.request("/api/instructions/me");
    expect(orgRes.status).toBe(200);
    const body = (await orgRes.json()) as { instructions: unknown[] };
    expect(body.instructions).toEqual([]);
  });
});
