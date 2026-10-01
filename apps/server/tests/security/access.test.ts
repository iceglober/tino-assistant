import { describe, expect, it } from "vitest";
import { type AccessSubject, createAccess } from "../../src/infrastructure/security/access.js";

const access = createAccess();
const as = (role: AccessSubject["role"], over: Partial<AccessSubject> = {}): AccessSubject => ({
  memberId: "m1",
  role,
  status: "active",
  orgStatus: "active",
  ...over,
});

describe("org access policy", () => {
  it("keeps settings, invitations and the Slack install to admins and owners", () => {
    for (const [action, resource] of [
      ["update", "settings"],
      ["create", "invitation"],
      ["create", "slackApp"],
      ["delete", "knowledgeBase"],
    ] as const) {
      expect(access.check(as("member"), action, resource, "any").granted).toBe(false);
      expect(access.check(as("admin"), action, resource, "any").granted).toBe(true);
      expect(access.check(as("owner"), action, resource, "any").granted).toBe(true);
    }
  });

  it("enforces ownership of personal MCP servers", () => {
    expect(access.check(as("member"), "update", "mcpServer", "own", { ownerId: "m1" }).granted).toBe(true);
    expect(access.check(as("member"), "update", "mcpServer", "own", { ownerId: "m2" }).granted).toBe(false);
    // A workspace server belongs to the org, not to any member.
    expect(access.check(as("member"), "update", "mcpServer", "own", { ownerId: "org:o1" }).granted).toBe(false);
    expect(access.check(as("admin"), "update", "mcpServer", "any").granted).toBe(true);
  });

  it("shows members a team directory without the private fields", () => {
    const row = { id: "m2", name: "Bo", email: "bo@acme.io", role: "member", status: "active", connections: ["gmail"] };
    const asMember = access.check(as("member"), "read", "member", "any");
    expect(asMember.filter(row)).toEqual({
      id: "m2",
      name: "Bo",
      email: "bo@acme.io",
      role: "member",
      status: "active",
    });
    expect(access.check(as("admin"), "read", "member", "any").filter(row)).toEqual(row);
  });

  it("fails closed for suspended members, suspended orgs and unknown roles", () => {
    expect(access.check(as("owner", { status: "suspended" }), "read", "org", "any").granted).toBe(false);
    expect(access.check(as("owner", { orgStatus: "suspended" }), "read", "org", "any").granted).toBe(false);
    expect(access.check(as("nobody" as AccessSubject["role"]), "read", "org", "any").granted).toBe(false);
  });
});
