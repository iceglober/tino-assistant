import { generateText } from "ai";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "../../src/agent/history.js";
import { runAgent } from "../../src/agent/run.js";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { AuthVariables } from "../../src/server/middleware/auth.js";
import { createInstructionRoutes } from "../../src/server/routes/instructions.js";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      text: "ok",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  };
});

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeConfigStore(entries: Record<string, unknown> = {}): ConfigStore {
  const store = new Map<string, string>(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    getTyped: vi.fn(async <T>(key: string, fallback: T): Promise<T> => {
      const raw = store.get(key);
      if (!raw) return fallback;
      try { return JSON.parse(raw) as T; } catch { return fallback; }
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    }),
    list: vi.fn(async () => [...store.entries()].map(([key, value]) => ({ key, value, updatedAt: Date.now() }))),
    delete: vi.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had;
    }),
  };
}

describe("wave 5 — instruction resolution integration", () => {
  it("agent run merges org + user instructions in level order", async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "ok",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as never);

    const config = makeConfigStore({
      "org.instructions": [{ level: "org", source: "org-policy", text: "respond in Spanish" }],
      "user.U_MEMBER.instructions": [{ level: "user", source: "user-prefs", text: "be extra concise" }],
    });

    const history = createHistoryStore({ cap: 40 });

    await runAgent({
      model: {} as never,
      history,
      logger: stubLogger,
      tools: {},
      userId: "U_MEMBER",
      text: "hello",
      activeCapabilities: [],
      configStore: config,
    });

    const calls = vi.mocked(generateText).mock.calls;
    expect(calls.length).toBe(1);
    const systemPrompt = calls[0][0].system as string;

    expect(systemPrompt).toContain("[org-policy] respond in Spanish");
    expect(systemPrompt).toContain("[user-prefs] be extra concise");
    expect(systemPrompt.indexOf("[org-policy]")).toBeLessThan(systemPrompt.indexOf("[user-prefs]"));
  });

  it("agent run with no configStore omits instructions entirely", async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "ok",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as never);

    const history = createHistoryStore({ cap: 40 });

    await runAgent({
      model: {} as never,
      history,
      logger: stubLogger,
      tools: {},
      userId: "U1",
      text: "hello",
      activeCapabilities: [],
    });

    const systemPrompt = vi.mocked(generateText).mock.calls[0][0].system as string;
    expect(systemPrompt).not.toContain("Instructions:");
    expect(systemPrompt).not.toContain("Permissions:");
  });

  it("org permission restriction appears in agent system prompt", async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "ok",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as never);

    const config = makeConfigStore({
      "org.instructions": [{ level: "org", source: "org-policy", permissions: { write: false } }],
    });

    const history = createHistoryStore({ cap: 40 });

    await runAgent({
      model: {} as never,
      history,
      logger: stubLogger,
      tools: {},
      userId: "U1",
      text: "hello",
      activeCapabilities: [],
      configStore: config,
    });

    const systemPrompt = vi.mocked(generateText).mock.calls[0][0].system as string;
    expect(systemPrompt).toContain("Permissions:");
    expect(systemPrompt).toContain("write");
  });

  it("instruction routes round-trip feeds into agent run", async () => {
    const config = makeConfigStore();

    const adminUser: AuthVariables["user"] = {
      id: "tino-uuid-admin",
      email: "admin@acme.io",
      name: "Admin",
      role: "admin",
      status: "active",
      slackUserId: "U_ADMIN",
    };

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("user", adminUser);
      await next();
    });
    app.route("/api/instructions", createInstructionRoutes({ config, logger: stubLogger }));

    await app.request("/api/instructions/org", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instructions: [{ level: "org", source: "org-policy", text: "respond in French" }],
      }),
    });

    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "ok",
      steps: [],
      response: { messages: [] },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as never);

    const history = createHistoryStore({ cap: 40 });

    await runAgent({
      model: {} as never,
      history,
      logger: stubLogger,
      tools: {},
      userId: "U_MEMBER",
      text: "bonjour",
      activeCapabilities: [],
      configStore: config,
    });

    const systemPrompt = vi.mocked(generateText).mock.calls[0][0].system as string;
    expect(systemPrompt).toContain("[org-policy] respond in French");
  });
});
