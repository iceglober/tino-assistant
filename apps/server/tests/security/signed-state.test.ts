import { describe, expect, it } from "vitest";
import { createSignedState, type OAuthState } from "../../src/infrastructure/security/signed-state.js";

const state = (over: Partial<OAuthState> = {}): OAuthState => ({
  orgId: "org-1",
  userId: "user-1",
  purpose: "slack.connect",
  client: "org",
  ...over,
});

describe("signed OAuth state", () => {
  const tokens = createSignedState("secret-abc");

  it("round-trips org, user, purpose and client", () => {
    expect(tokens.verify(tokens.issue(state()))).toEqual(state());
  });

  it("rejects an expired token", () => {
    expect(tokens.verify(tokens.issue(state(), -1))).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [, sig] = tokens.issue(state()).split(".");
    const otherPayload = tokens.issue(state({ orgId: "org-2" })).split(".")[0];
    expect(tokens.verify(`${otherPayload}.${sig}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    expect(tokens.verify(createSignedState("other-secret").issue(state()))).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(tokens.verify("garbage")).toBeNull();
    expect(tokens.verify("")).toBeNull();
    expect(tokens.verify("a.b.c")).toBeNull();
  });
});
