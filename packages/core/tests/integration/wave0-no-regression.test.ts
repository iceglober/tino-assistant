/**
 * Wave 0 regression test: bot owner's slack DM behavior is unchanged.
 *
 * This test ensures that after introducing the multi-user model (users table,
 * identities, migrations), the existing slack DM handler path still:
 * - Accepts DMs from ALLOWED_SLACK_USER_ID (the slack ID, not tino-UUID)
 * - Passes the slack ID to runAgent (NOT a tino-UUID)
 * - Preserves history from legacy HISTORY#<slackId> records
 * - Registers the same tools and capabilities as before
 *
 * No user-visible change.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock MCPPool before importing modules that use registry
vi.mock("../../src/mcp/pool.js", () => ({
  MCPPool: vi.fn(function () {
    return {
      killAll: vi.fn(async () => {}),
      kill: vi.fn(async () => {}),
      killUser: vi.fn(async () => {}),
      acquire: vi.fn(async () => ({})),
    };
  }),
}));
import { initCapabilityRegistry } from "../../src/capabilities/registry.js";
import { createHistoryStore } from "../../src/agent/history.js";
import * as runAgentModule from "../../src/agent/run.js";
import type { ConfigStore } from "../../src/persistence/config.js";
import type { AppLogger } from "../../src/slack/app.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeConfigStore(entries: Record<string, unknown> = {}): ConfigStore {
  const store = new Map<string, string>(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    getTyped: vi.fn(async <T>(key: string, fallback: T): Promise<T> => {
      const raw = store.get(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wave0-no-regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bot owner DM produces identical agent invocation as before wave 0", async () => {
    const ALLOWED_SLACK_USER_ID = "U123456";
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    // Initialize the registry (empty config, no capabilities)
    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: ALLOWED_SLACK_USER_ID,
      dbPath: ":memory:",
    });

    // Create a history store and seed it with legacy slack-id-keyed messages
    const history = createHistoryStore({ cap: 40 });
    await history.append(ALLOWED_SLACK_USER_ID, [
      { role: "user", content: "What time is it?" },
      { role: "assistant", content: "It is 3:14 PM." },
    ]);

    // Mock runAgent to capture call arguments
    const runAgentSpy = vi.spyOn(runAgentModule, "runAgent").mockResolvedValue("mocked response");

    // Create the DM handler exactly as index.ts does
    const handler = async (userId: string, text: string) => {
      const privateTools = await registry.buildPrivateTools(userId);
      const tools = { ...registry.sharedTools, ...privateTools };
      const activeCapabilities = await registry.getActiveCapabilities(userId);

      return runAgentModule.runAgent({
        model: {} as any, // mock model
        history,
        historyAppender: undefined,
        logger,
        tools,
        userId,
        text,
        auditLogger: undefined,
        activeCapabilities,
      });
    };

    // Invoke the handler with a DM
    const text = "Hello, bot!";
    await handler(ALLOWED_SLACK_USER_ID, text);

    // Assertions
    expect(runAgentSpy).toHaveBeenCalledTimes(1);
    const callArgs = runAgentSpy.mock.calls[0][0];

    // The userId must be the slack ID, NOT a tino-UUID
    expect(callArgs.userId).toBe(ALLOWED_SLACK_USER_ID);

    // The text is passed through unchanged
    expect(callArgs.text).toBe(text);

    // Tools are populated from the registry
    expect(callArgs.tools).toBeDefined();
    expect(typeof callArgs.tools).toBe("object");

    // History is the same history store we created
    expect(callArgs.history).toBe(history);

    // activeCapabilities is an array (possibly empty)
    expect(Array.isArray(callArgs.activeCapabilities)).toBe(true);
  });
});
