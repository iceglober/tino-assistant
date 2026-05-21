import { describe, expect, it } from "vitest";
import { emailFilter } from "../../src/privacy/email-filter.js";
import type { EmailPrivacyConfig } from "../../src/privacy/types.js";

const baseConfig: EmailPrivacyConfig = {
  privateFolders: ["Private", "HR"],
  denyListedAddresses: ["therapist@example.com"],
};

describe("email privacy filter", () => {
  it("thread with private folder gates", () => {
    const result = emailFilter(
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
      expect(result.placeholder.reason).toBe("private_folder");
      expect(result.placeholder.metadata.threadId).toBe("t1");
    }
  });

  it("thread with deny-listed sender gates", () => {
    const result = emailFilter(
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
    const result = emailFilter(
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
    const result = emailFilter(
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
    const result = emailFilter(
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

  it("folder matching is case-insensitive", () => {
    const result = emailFilter(
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
    const result = emailFilter(
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

  it("single message with deny-listed from gates", () => {
    const result = emailFilter(
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
    const result = emailFilter(
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
