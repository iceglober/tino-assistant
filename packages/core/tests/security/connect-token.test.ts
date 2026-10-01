import { describe, expect, it } from "vitest";
import { createConnectTokens } from "../../src/infrastructure/security/connect-token.js";

describe("connect tokens", () => {
  const tokens = createConnectTokens("secret-abc");

  it("round-trips a userId", () => {
    const tok = tokens.issue("user-1");
    expect(tokens.verify(tok)).toBe("user-1");
  });

  it("rejects an expired token", () => {
    const tok = tokens.issue("user-1", -1);
    expect(tokens.verify(tok)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [, sig] = tokens.issue("user-1").split(".");
    const otherPayload = tokens.issue("user-2").split(".")[0];
    expect(tokens.verify(`${otherPayload}.${sig}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const foreign = createConnectTokens("other-secret").issue("user-1");
    expect(tokens.verify(foreign)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(tokens.verify("garbage")).toBeNull();
    expect(tokens.verify("")).toBeNull();
    expect(tokens.verify("a.b.c")).toBeNull();
  });
});
