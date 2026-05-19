import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { onboardingGate } from "../../src/server/middleware/onboarding-gate.js";

function buildApp(completedAt: number | null) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("privacySetupCompletedAt" as any, completedAt);
    await next();
  });
  app.use("*", onboardingGate());
  app.get("/dashboard", (c) => c.text("ok"));
  app.get("/api/config", (c) => c.json({ ok: true }));
  app.get("/api/auth/get-session", (c) => c.json({ session: true }));
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/onboarding/gmail", (c) => c.text("gmail step"));
  app.get("/api/onboarding/gmail/labels", (c) => c.json({ labels: [] }));
  return app;
}

describe("onboarding gate middleware", () => {
  it("user with null privacy_setup_completed_at is redirected to /onboarding", async () => {
    const app = buildApp(null);
    const res = await app.request("/dashboard");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/onboarding");
  });

  it("user with completed onboarding reaches main console", async () => {
    const app = buildApp(Date.now());
    const res = await app.request("/dashboard");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("api routes return 403 when onboarding incomplete", async () => {
    const app = buildApp(null);
    const res = await app.request("/api/config");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("onboarding_required");
  });

  it("/api/auth/* routes bypass the gate", async () => {
    const app = buildApp(null);
    const res = await app.request("/api/auth/get-session");
    expect(res.status).toBe(200);
  });

  it("/onboarding/* routes bypass the gate", async () => {
    const app = buildApp(null);
    const res = await app.request("/onboarding/gmail");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("gmail step");
  });

  it("/api/onboarding/* routes bypass the gate", async () => {
    const app = buildApp(null);
    const res = await app.request("/api/onboarding/gmail/labels");
    expect(res.status).toBe(200);
  });

  it("/api/health bypasses the gate", async () => {
    const app = buildApp(null);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });
});
