import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createIdentityResolver } from "../../src/identity/resolver.js";
import type { SlackWebClient } from "../../src/identity/resolver.js";
import { createSqliteIdentityStore, createSqliteUserStore } from "../../src/identity/store.js";
import type { Identity, TinoUser } from "../../src/identity/types.js";

const tempFiles: string[] = [];

function tempDbPath(): string {
  const p = path.join(os.tmpdir(), `tino-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tempFiles.splice(0)) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(p + suffix);
      } catch {
        /* ignore */
      }
    }
  }
});

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const stubSlackClient: SlackWebClient = {
  users: {
    async info() {
      return {};
    },
  },
};

function setup() {
  const dbPath = tempDbPath();
  const users = createSqliteUserStore({ dbPath });
  const identities = createSqliteIdentityStore({ dbPath });
  const resolver = createIdentityResolver({
    users,
    identities,
    slackClient: stubSlackClient,
    logger: noopLogger,
  });
  return { users, identities, resolver };
}

describe("createIdentityResolver", () => {
  it("resolveSlack returns the linked tinoUserId", async () => {
    const { identities, resolver } = setup();
    const identity: Identity = {
      provider: "slack",
      externalId: "U01OWNER",
      tinoUserId: "uuid-abc-123",
      linkedAt: Date.now(),
    };
    await identities.link(identity);

    const result = await resolver.resolveSlack("U01OWNER");
    expect(result).toBe("uuid-abc-123");
  });

  it("resolveSlack returns null when no link exists", async () => {
    const { resolver } = setup();
    const result = await resolver.resolveSlack("U_NONEXISTENT");
    expect(result).toBeNull();
  });

  it("resolveGoogle lowercases the email before lookup", async () => {
    const { identities, resolver } = setup();
    await identities.link({
      provider: "google",
      externalId: "alice@example.com",
      tinoUserId: "uuid-google-1",
      linkedAt: Date.now(),
    });

    expect(await resolver.resolveGoogle("Alice@Example.COM")).toBe("uuid-google-1");
    expect(await resolver.resolveGoogle("alice@example.com")).toBe("uuid-google-1");
    expect(await resolver.resolveGoogle("bob@example.com")).toBeNull();
  });
});

describe("provisionFromSlack", () => {
  function setupWithSlackEmail(email: string) {
    const dbPath = tempDbPath();
    const users = createSqliteUserStore({ dbPath });
    const identities = createSqliteIdentityStore({ dbPath });
    const slackClient: SlackWebClient = {
      users: {
        async info() {
          return { user: { profile: { email } } };
        },
      },
    };
    const resolver = createIdentityResolver({
      users,
      identities,
      slackClient,
      logger: noopLogger,
    });
    return { users, identities, resolver };
  }

  it("provisionFromSlack org-domain creates user when domain matches", async () => {
    const { identities, resolver } = setupWithSlackEmail("alice@acme.com");

    const user = await resolver.provisionFromSlack("U_ALICE", {
      mode: "org-domain",
      orgDomain: "acme.com",
    });

    expect(user.email).toBe("alice@acme.com");
    expect(user.role).toBe("member");
    expect(user.status).toBe("active");
    expect(user.slackUserId).toBe("U_ALICE");
    expect(user.id).toBeTruthy();

    const linked = await identities.listForUser(user.id);
    expect(linked).toHaveLength(2);
    expect(linked.find((i) => i.provider === "slack")?.externalId).toBe("U_ALICE");
    expect(linked.find((i) => i.provider === "google")?.externalId).toBe("alice@acme.com");
  });

  it("provisionFromSlack org-domain rejects when domain does not match and no existing user", async () => {
    const { resolver } = setupWithSlackEmail("alice@other.com");

    await expect(
      resolver.provisionFromSlack("U_ALICE", {
        mode: "org-domain",
        orgDomain: "acme.com",
      }),
    ).rejects.toThrow("domain_mismatch");
  });

  it("provisionFromSlack links slack identity to existing user by email even when domain differs", async () => {
    const { users, identities, resolver } = setupWithSlackEmail("alice@other.com");

    const existingUser = await users.create({
      id: "uuid-existing-cross-domain",
      email: "alice@other.com",
      name: "Alice",
      role: "admin",
      status: "active",
      slackUserId: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await identities.link({
      provider: "google",
      externalId: "alice@other.com",
      tinoUserId: existingUser.id,
      linkedAt: Date.now(),
    });

    const merged = await resolver.provisionFromSlack("U_ALICE_SLACK", {
      mode: "org-domain",
      orgDomain: "acme.com",
    });

    expect(merged.id).toBe("uuid-existing-cross-domain");
    expect(merged.slackUserId).toBe("U_ALICE_SLACK");
  });

  it("provisionFromSlack merges into existing google-linked user when emails match", async () => {
    const { users, identities, resolver } = setupWithSlackEmail("alice@acme.com");

    const existingUser = await users.create({
      id: "uuid-existing-google",
      email: "alice@acme.com",
      name: "Alice",
      role: "member",
      status: "active",
      slackUserId: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await identities.link({
      provider: "google",
      externalId: "alice@acme.com",
      tinoUserId: existingUser.id,
      linkedAt: Date.now(),
    });

    const merged = await resolver.provisionFromSlack("U_ALICE_SLACK", {
      mode: "org-domain",
      orgDomain: "acme.com",
    });

    expect(merged.id).toBe("uuid-existing-google");
    expect(merged.slackUserId).toBe("U_ALICE_SLACK");

    const linked = await identities.listForUser("uuid-existing-google");
    expect(linked).toHaveLength(2);
    expect(linked.find((i) => i.provider === "slack")?.externalId).toBe("U_ALICE_SLACK");
    expect(linked.find((i) => i.provider === "google")?.externalId).toBe("alice@acme.com");

    const allUsers = await users.list();
    expect(allUsers).toHaveLength(1);
  });
});
