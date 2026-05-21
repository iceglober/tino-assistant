import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthVariables } from "../../src/server/middleware/auth.js";
import { createPrivacyRoutes } from "../../src/server/routes/privacy.js";
import { PRIVACY_REGEX } from "../../src/privacy/defaults.js";
import type { EmailPort, CalendarPort, MessagingPort } from "../../src/privacy/ports.js";

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

function buildApp(deps?: Partial<Parameters<typeof createPrivacyRoutes>[0]>) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", testUser);
    await next();
  });
  app.route("/api/privacy", createPrivacyRoutes({
    privacyConfigStore: mockPrivacyConfigStore(),
    logger: noopLogger(),
    ...deps,
  }));
  return app;
}

describe("privacy routes", () => {
  it("email labels use withDefaults to set preChecked", async () => {
    const email: EmailPort = {
      getLabels: vi.fn(async () => [
        { name: "Private", itemCount: 100 },
        { name: "Work", itemCount: 200 },
        { name: "HR", itemCount: 50 },
        { name: "Receipts", itemCount: 30 },
      ]),
      getContacts: vi.fn(async () => []),
      getSampleSubjects: vi.fn(async () => []),
      getContactSamples: vi.fn(async () => []),
    };
    const app = buildApp({ email });

    const res = await app.request("/api/privacy/email/labels");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { labels: Array<{ name: string; preChecked: boolean }> };
    expect(body.labels).toHaveLength(4);
    expect(body.labels.find((l) => l.name === "Private")?.preChecked).toBe(true);
    expect(body.labels.find((l) => l.name === "HR")?.preChecked).toBe(true);
    expect(body.labels.find((l) => l.name === "Work")?.preChecked).toBe(false);
    for (const l of body.labels) {
      expect(l).toHaveProperty("examples");
    }
  });

  it("email contacts use withDefaults and include all contacts", async () => {
    const email: EmailPort = {
      getLabels: vi.fn(async () => []),
      getContacts: vi.fn(async () => [
        { address: "doctor@example.com", displayName: "Dr. Smith", itemCount: 10 },
        { address: "alice@work.com", displayName: "Alice", itemCount: 20 },
      ]),
      getSampleSubjects: vi.fn(async () => []),
      getContactSamples: vi.fn(async () => []),
    };
    const app = buildApp({ email });

    const res = await app.request("/api/privacy/email/contacts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contacts: Array<{ address: string; preChecked: boolean }> };
    expect(body.contacts.find((c) => c.address === "doctor@example.com")?.preChecked).toBe(true);
    expect(body.contacts.find((c) => c.address === "alice@work.com")?.preChecked).toBe(false);
  });

  it("messaging dms use withDefaults", async () => {
    const messaging: MessagingPort = {
      getDMs: vi.fn(async () => [
        { id: "D1", participantId: "U1", participantName: "Dr. Therapy", itemCount: 15 },
        { id: "D2", participantId: "U2", participantName: "Bob", itemCount: 5 },
      ]),
      getDMSamples: vi.fn(async () => []),
    };
    const app = buildApp({ messaging });

    const res = await app.request("/api/privacy/messaging/dms");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversations: Array<{ participantName: string; preChecked: boolean }> };
    expect(body.conversations.find((c) => c.participantName === "Dr. Therapy")?.preChecked).toBe(true);
    expect(body.conversations.find((c) => c.participantName === "Bob")?.preChecked).toBe(false);
  });

  it("calendar visibility query returns settings", async () => {
    const calendar: CalendarPort = {
      getVisibility: vi.fn(async () => ({
        defaultVisibility: "public",
        calendars: [
          { id: "primary", name: "Work Calendar" },
          { id: "personal", name: "Personal" },
        ],
      })),
    };
    const app = buildApp({ calendar });

    const res = await app.request("/api/privacy/calendar/visibility");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { defaultVisibility: string; calendars: unknown[] };
    expect(body.defaultVisibility).toBe("public");
    expect(body.calendars).toHaveLength(2);
  });

  it("POST /complete/email validates the config shape", async () => {
    const app = buildApp();

    const bad = await app.request("/api/privacy/complete/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: { junk: true } }),
    });
    expect(bad.status).toBe(400);

    const good = await app.request("/api/privacy/complete/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: { privateFolders: ["Private"], denyListedAddresses: [] } }),
    });
    expect(good.status).toBe(200);
  });

  it("POST /complete/calendar rejects invalid visibility", async () => {
    const app = buildApp();

    const bad = await app.request("/api/privacy/complete/calendar", {
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

  it("POST /scan returns 503 when no model and not mock mode", async () => {
    const app = buildApp();
    const res = await app.request("/api/privacy/scan", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("POST /scan in mock mode returns SSE with scan results", async () => {
    const app = buildApp({ mockMode: true });
    const res = await app.request("/api/privacy/scan", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: progress");
    expect(text).toContain("event: result");
    expect(text).toContain("Medical");
    expect(text).toContain("medical");
  });
});
