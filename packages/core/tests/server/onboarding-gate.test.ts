import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { PrivacyConfigStore } from "../../src/privacy/config-store.js";
import type { PrivacyConfig } from "../../src/privacy/types.js";
import { onboardingGate } from "../../src/server/middleware/onboarding-gate.js";

const baseConfig: PrivacyConfig = {
  version: 1,
  gmail: { privateLabels: [], denyListedAddresses: [], threadingMode: "conservative" },
  lastReviewedAt: Date.now(),
  lastRepromptAt: null,
};

function stubConfigStore(hasConfig: boolean): PrivacyConfigStore {
  return {
    get: async () => (hasConfig ? baseConfig : null),
    set: async () => {},
    computeDelta: () => ({}),
    isAdditive: () => false,
  };
}

function buildApp(hasConfig: boolean) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as any, { id: "user-1", role: "member" });
    await next();
  });
  app.use("*", onboardingGate({ privacyConfigStore: stubConfigStore(hasConfig) }));
  app.get("/dashboard", (c) => c.text("ok"));
  app.get("/api/config", (c) => c.json({ ok: true }));
  app.get("/api/auth/get-session", (c) => c.json({ session: true }));
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/onboarding/gmail", (c) => c.text("gmail step"));
  app.get("/api/onboarding/gmail/labels", (c) => c.json({ labels: [] }));
  return app;
}

describe("onboarding gate middleware", () => {
  it("user with no privacy config is redirected to /onboarding", async () => {
    const app = buildApp(false);
    const res = await app.request("/dashboard");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/onboarding");
  });

  it("user with completed onboarding reaches main console", async () => {
    const app = buildApp(true);
    const res = await app.request("/dashboard");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("api routes return 403 when onboarding incomplete", async () => {
    const app = buildApp(false);
    const res = await app.request("/api/config");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("onboarding_required");
  });

  it("/api/auth/* routes bypass the gate", async () => {
    const app = buildApp(false);
    const res = await app.request("/api/auth/get-session");
    expect(res.status).toBe(200);
  });

  it("/onboarding/* routes bypass the gate", async () => {
    const app = buildApp(false);
    const res = await app.request("/onboarding/gmail");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("gmail step");
  });

  it("/api/onboarding/* routes bypass the gate", async () => {
    const app = buildApp(false);
    const res = await app.request("/api/onboarding/gmail/labels");
    expect(res.status).toBe(200);
  });

  it("/api/health bypasses the gate", async () => {
    const app = buildApp(false);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });

  it("admin users bypass the gate even without privacy config", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user" as any, { id: "admin-1", role: "admin" });
      await next();
    });
    app.use("*", onboardingGate({ privacyConfigStore: stubConfigStore(false) }));
    app.get("/api/config", (c) => c.json({ ok: true }));
    app.get("/dashboard", (c) => c.text("ok"));

    const apiRes = await app.request("/api/config");
    expect(apiRes.status).toBe(200);

    const dashRes = await app.request("/dashboard");
    expect(dashRes.status).toBe(200);
  });
});
