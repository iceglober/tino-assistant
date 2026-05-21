import { describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "../../src/agent/history.js";
import { runScrub } from "../../src/privacy/scrub.js";
import type { PrivacyConfig } from "../../src/privacy/types.js";

const stubLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function makeAuditLogger() {
  return {
    log: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    lastEntryAt: vi.fn().mockResolvedValue(undefined),
  };
}

describe("retroactive scrub", () => {
  it("adding a folder scrubs prior matching threads to placeholders", async () => {
    const history = createHistoryStore({ cap: 100 });
    const userId = "user-1";

    await history.append(userId, [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc1", toolName: "gmail_search", input: {} }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "gmail_search",
            output: {
              messages: [{ id: "m1", threadId: "t1", from: "therapist@example.com", labels: ["Private"] }],
            },
          },
        ],
      },
    ] as any);

    const config: PrivacyConfig = {
      version: 2,
      email: { privateFolders: ["Private"], denyListedAddresses: [] },
      lastReviewedAt: Date.now(),
    };

    const audit = makeAuditLogger();
    const result = await runScrub({
      userId,
      addedRules: { email: { addedFolders: ["Private"], removedFolders: [], addedAddresses: [], removedAddresses: [] } },
      history,
      config,
      auditLogger: audit,
      logger: stubLogger,
    });

    expect(result.rowsScrubbed).toBe(1);

    const after = await history.get(userId);
    const toolMsg = after.find((m) => m.role === "tool") as any;
    expect(toolMsg.content[0].output.type).toBe("redacted");
    expect(toolMsg.content[0].output.reason).toBe("private_folder");
  });

  it("removing from deny-list does not unscrub previously-gated rows", async () => {
    const history = createHistoryStore({ cap: 100 });
    const userId = "user-1";

    await history.append(userId, [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc1", toolName: "gmail_search", input: {} }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "gmail_search",
            output: { type: "redacted", reason: "private_folder", metadata: { threadId: "t1" } },
          },
        ],
      },
    ] as any);

    const config: PrivacyConfig = {
      version: 2,
      email: { privateFolders: [], denyListedAddresses: [] },
      lastReviewedAt: Date.now(),
    };

    const result = await runScrub({
      userId,
      addedRules: {},
      history,
      config,
      logger: stubLogger,
    });

    expect(result.rowsScrubbed).toBe(0);

    const after = await history.get(userId);
    const toolMsg = after.find((m) => m.role === "tool") as any;
    expect(toolMsg.content[0].output.type).toBe("redacted");
  });

  it("second scrub run is idempotent", async () => {
    const history = createHistoryStore({ cap: 100 });
    const userId = "user-1";

    await history.append(userId, [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc1", toolName: "slack_read_dm", input: { channel: "D_THERAPIST" } }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "slack_read_dm",
            output: { messages: [{ user: "U_OTHER", ts: "123" }] },
          },
        ],
      },
    ] as any);

    const config: PrivacyConfig = {
      version: 2,
      messaging: { denyListedConversationIds: ["D_THERAPIST"], denyListedUserIds: [] },
      lastReviewedAt: Date.now(),
    };

    const delta = { messaging: { addedConversationIds: ["D_THERAPIST"], removedConversationIds: [], addedUserIds: [], removedUserIds: [] } };

    const r1 = await runScrub({ userId, addedRules: delta, history, config, logger: stubLogger });
    expect(r1.rowsScrubbed).toBe(1);

    const r2 = await runScrub({ userId, addedRules: delta, history, config, logger: stubLogger });
    expect(r2.rowsScrubbed).toBe(0);
  });

  it("scrub completion writes a privacy_scrub audit entry", async () => {
    const history = createHistoryStore({ cap: 100 });
    const userId = "user-1";

    await history.append(userId, [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc1", toolName: "calendar_list_events", input: {} }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "calendar_list_events",
            output: { events: [{ summary: "Therapy", visibility: "private" }] },
          },
        ],
      },
    ] as any);

    const config: PrivacyConfig = {
      version: 2,
      calendar: { defaultVisibility: "public", gateAllByDefault: false },
      lastReviewedAt: Date.now(),
    };

    const audit = makeAuditLogger();
    await runScrub({
      userId,
      addedRules: {},
      history,
      config,
      auditLogger: audit,
      logger: stubLogger,
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        action: "privacy_scrub",
        status: "success",
      }),
    );
  });
});
