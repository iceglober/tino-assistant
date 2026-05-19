import { describe, expect, it } from "vitest";
import { gmailFilter } from "../../src/privacy/gmail.js";
import type { GmailPrivacyConfig } from "../../src/privacy/types.js";

const baseConfig: GmailPrivacyConfig = {
  privateLabels: ["Private", "HR"],
  denyListedAddresses: ["therapist@example.com"],
  threadingMode: "conservative",
};

describe("gmail privacy filter", () => {
  it("thread with private label gates", () => {
    const result = gmailFilter(
      {},
      {
        messages: [
          { id: "m1", threadId: "t1", from: "alice@co.com", labels: ["Private"], internalDate: "1716100000000" },
        ],
      },
      baseConfig,
    );
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.placeholder.reason).toBe("private_label");
      expect(result.placeholder.metadata.threadId).toBe("t1");
    }
  });

  it("thread with deny-listed sender gates", () => {
    const result = gmailFilter(
      {},
      {
        messages: [
          { id: "m1", threadId: "t1", from: "therapist@example.com", internalDate: "1716100000000" },
        ],
      },
      baseConfig,
    );
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.placeholder.reason).toBe("address_deny_listed");
    }
  });

  it("thread with deny-listed cc gates", () => {
    const result = gmailFilter(
      {},
      {
        messages: [
          { id: "m1", threadId: "t1", from: "alice@co.com", cc: "therapist@example.com", internalDate: "1716100000000" },
        ],
      },
      baseConfig,
    );
    expect(result.persist).toBe(false);
  });

  it("thread where matching message is mid-thread gates whole thread", () => {
    const result = gmailFilter(
      {},
      {
        messages: [
          { id: "m1", threadId: "t1", from: "alice@co.com", internalDate: "1716100000000" },
          { id: "m2", threadId: "t1", from: "bob@co.com", internalDate: "1716100001000" },
          { id: "m3", threadId: "t1", from: "therapist@example.com", internalDate: "1716100002000" },
        ],
      },
      baseConfig,
    );
    expect(result.persist).toBe(false);
  });

  it("thread with no matches persists", () => {
    const result = gmailFilter(
      {},
      {
        messages: [
          { id: "m1", threadId: "t1", from: "alice@co.com", labels: ["Work"], internalDate: "1716100000000" },
        ],
      },
      baseConfig,
    );
    expect(result.persist).toBe(true);
  });

  it("label matching is case-insensitive", () => {
    const result = gmailFilter(
      {},
      {
        messages: [
          { id: "m1", threadId: "t1", from: "alice@co.com", labels: ["private"], internalDate: "1716100000000" },
        ],
      },
      baseConfig,
    );
    expect(result.persist).toBe(false);
  });

  it("address matching normalizes plus-addressing", () => {
    const result = gmailFilter(
      {},
      {
        messages: [
          { id: "m1", threadId: "t1", from: "therapist+notes@example.com", internalDate: "1716100000000" },
        ],
      },
      baseConfig,
    );
    expect(result.persist).toBe(false);
  });

  it("single message (gmail_get_message) with deny-listed from gates", () => {
    const result = gmailFilter(
      {},
      {
        id: "m1",
        threadId: "t1",
        from: "therapist@example.com",
        body: "session notes...",
        internalDate: "1716100000000",
      },
      baseConfig,
    );
    expect(result.persist).toBe(false);
  });

  it("no config means persist", () => {
    const result = gmailFilter(
      {},
      {
        messages: [
          { id: "m1", threadId: "t1", from: "therapist@example.com", labels: ["Private"] },
        ],
      },
      undefined,
    );
    expect(result.persist).toBe(true);
  });
});
