import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthVariables } from "../../src/server/middleware/auth.js";
import { createOnboardingRoutes, PRIVACY_REGEX } from "../../src/server/routes/onboarding.js";

const testUser: AuthVariables["user"] = {
  id: "tino-uuid-1",
  email: "alice@acme.io",
  name: "Alice",
  role: "member",
  status: "active",
  slackUserId: "U_ALICE",
};

function noopLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function mockPrivacyConfigStore() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (userId: string) => store.get(userId) ?? null),
    set: vi.fn(async (userId: string, config: unknown) => { store.set(userId, config); }),
    computeDelta: vi.fn(() => ({})),
    isAdditive: vi.fn(() => false),
  };
}

function buildApp(deps?: Partial<Parameters<typeof createOnboardingRoutes>[0]>) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", testUser);
    await next();
  });
  app.route("/api/onboarding", createOnboardingRoutes({
    privacyConfigStore: mockPrivacyConfigStore(),
    logger: noopLogger(),
    ...deps,
  }));
  return app;
}

describe("onboarding routes", () => {
  it("gmail labels pre-population includes top 15 labels with privacy regex flags", async () => {
    const getGmailLabels = vi.fn(async () => [
      { name: "Private", messageCount: 100 },
      { name: "Work", messageCount: 200 },
      { name: "HR", messageCount: 50 },
      { name: "Receipts", messageCount: 30 },
    ]);
    const app = buildApp({ getGmailLabels });

    const res = await app.request("/api/onboarding/gmail/labels");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { labels: Array<{ name: string; preChecked: boolean }> };
    expect(body.labels).toHaveLength(4);
    expect(body.labels.find((l) => l.name === "Private")?.preChecked).toBe(true);
    expect(body.labels.find((l) => l.name === "HR")?.preChecked).toBe(true);
    expect(body.labels.find((l) => l.name === "Work")?.preChecked).toBe(false);
  });

  it("gmail contacts pre-population includes top 15 contacts with flags", async () => {
    const getGmailContacts = vi.fn(async () => [
      { email: "doctor@example.com", name: "Dr. Smith", messageCount: 10 },
      { email: "alice@work.com", name: "Alice", messageCount: 20 },
    ]);
    const app = buildApp({ getGmailContacts });

    const res = await app.request("/api/onboarding/gmail/contacts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contacts: Array<{ email: string; preChecked: boolean }> };
    expect(body.contacts.find((c) => c.email === "doctor@example.com")?.preChecked).toBe(true);
    expect(body.contacts.find((c) => c.email === "alice@work.com")?.preChecked).toBe(false);
  });

  it("slack dms pre-population includes top 15 conversations with flags", async () => {
    const getSlackDms = vi.fn(async () => [
      { channelId: "D1", userId: "U1", userName: "Dr. Therapy", messageCount: 15 },
      { channelId: "D2", userId: "U2", userName: "Bob", messageCount: 5 },
    ]);
    const app = buildApp({ getSlackDms });

    const res = await app.request("/api/onboarding/slack/dms");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversations: Array<{ userName: string; preChecked: boolean }> };
    expect(body.conversations.find((c) => c.userName === "Dr. Therapy")?.preChecked).toBe(true);
    expect(body.conversations.find((c) => c.userName === "Bob")?.preChecked).toBe(false);
  });

  it("calendar visibility query returns default and per-calendar settings", async () => {
    const getCalendarVisibility = vi.fn(async () => ({
      defaultVisibility: "public",
      calendars: [
        { id: "primary", summary: "Work Calendar", defaultVisibility: "public" },
        { id: "personal", summary: "Personal", defaultVisibility: "private" },
      ],
    }));
    const app = buildApp({ getCalendarVisibility });

    const res = await app.request("/api/onboarding/calendar/visibility");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { defaultVisibility: string; calendars: unknown[] };
    expect(body.defaultVisibility).toBe("public");
    expect(body.calendars).toHaveLength(2);
  });

  it("finalize returns completedAt", async () => {
    const app = buildApp();

    const res = await app.request("/api/onboarding/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; completedAt: number };
    expect(body.ok).toBe(true);
    expect(body.completedAt).toBeGreaterThan(0);
  });

  it("POST /complete/gmail validates the config shape", async () => {
    const app = buildApp();

    const bad = await app.request("/api/onboarding/complete/gmail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmail: { junk: true } }),
    });
    expect(bad.status).toBe(400);

    const good = await app.request("/api/onboarding/complete/gmail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmail: { privateLabels: ["Private"], denyListedAddresses: [], threadingMode: "conservative" } }),
    });
    expect(good.status).toBe(200);
  });

  it("POST /complete/calendar rejects invalid visibility", async () => {
    const app = buildApp();

    const bad = await app.request("/api/onboarding/complete/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendar: { defaultVisibility: "bogus", gateAllByDefault: false } }),
    });
    expect(bad.status).toBe(400);
  });

  it("PRIVACY_REGEX matches expected keywords", () => {
    expect(PRIVACY_REGEX.test("private")).toBe(true);
    expect(PRIVACY_REGEX.test("Personal")).toBe(true);
    expect(PRIVACY_REGEX.test("HR")).toBe(true);
    expect(PRIVACY_REGEX.test("therapy")).toBe(true);
    expect(PRIVACY_REGEX.test("doctor")).toBe(true);
    expect(PRIVACY_REGEX.test("finance")).toBe(true);
    expect(PRIVACY_REGEX.test("engineering")).toBe(false);
    expect(PRIVACY_REGEX.test("sales")).toBe(false);
  });
});
