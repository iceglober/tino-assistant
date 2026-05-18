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
