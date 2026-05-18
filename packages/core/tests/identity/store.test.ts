import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IdentityLinkConflictError, createSqliteIdentityStore, createSqliteUserStore } from "../../src/identity/store.js";
import type { Identity, TinoUser } from "../../src/identity/types.js";

// ─── Temp-file management ─────────────────────────────────────────────────────
//
// Mirrors the pattern in tests/persistence/preferences.test.ts: each test gets
// its own sqlite file and we delete the journal/wal/shm sidecars in afterEach.

const tempFiles: string[] = [];

function tempDbPath(): string {
  const p = path.join(os.tmpdir(), `tino-identity-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<TinoUser> = {}): TinoUser {
  const now = Date.now();
  return {
    id: `user-${Math.random().toString(36).slice(2, 10)}`,
    email: "alice@example.com",
    name: "Alice",
    role: "member",
    status: "active",
    slackUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── UserStore tests ─────────────────────────────────────────────────────────

describe("createSqliteUserStore", () => {
  // a1.1 — round-trip by id
  it("UserStore round-trips a created user by id", async () => {
    const store = createSqliteUserStore({ dbPath: tempDbPath() });
    const user = makeUser({
      id: "u-bot-owner",
      email: "owner@example.com",
      name: "Bot Owner",
      role: "admin",
      slackUserId: "U01OWNER",
    });
    const created = await store.create(user);
    expect(created).toEqual(user);

    const fetched = await store.get("u-bot-owner");
    expect(fetched).toEqual(user);
  });

  // a1.2 — case-insensitive email lookup
  it("UserStore.getByEmail is case-insensitive", async () => {
    const store = createSqliteUserStore({ dbPath: tempDbPath() });
    const user = makeUser({ email: "Mixed.Case@Example.com" });
    await store.create(user);

    // All three of these spellings must resolve to the same row.
    const lower = await store.getByEmail("mixed.case@example.com");
    const upper = await store.getByEmail("MIXED.CASE@EXAMPLE.COM");
    const original = await store.getByEmail("Mixed.Case@Example.com");

    expect(lower?.id).toBe(user.id);
    expect(upper?.id).toBe(user.id);
    expect(original?.id).toBe(user.id);
  });

  // a1.3 — update patches mutable fields
  it("UserStore.update patches mutable fields", async () => {
    const store = createSqliteUserStore({ dbPath: tempDbPath() });
    const user = makeUser({
      id: "u-patch",
      role: "member",
      status: "invited",
      slackUserId: null,
      name: "Old Name",
    });
    await store.create(user);

    // Patch only role + slackUserId; status and name should be untouched.
    const after = await store.update("u-patch", {
      role: "admin",
      slackUserId: "U02NEW",
    });

    expect(after.role).toBe("admin");
    expect(after.slackUserId).toBe("U02NEW");
    // Untouched fields preserved.
    expect(after.status).toBe("invited");
    expect(after.name).toBe("Old Name");
    // updated_at advances; create + update happen in distinct millis on real
    // hardware, but we don't assert strict inequality to avoid flakes.
    expect(after.updatedAt).toBeGreaterThanOrEqual(user.updatedAt);

    // Subsequent get reflects the patch.
    const reloaded = await store.get("u-patch");
    expect(reloaded?.role).toBe("admin");
    expect(reloaded?.slackUserId).toBe("U02NEW");
  });
});

// ─── IdentityStore tests ────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    provider: "slack",
    externalId: `U${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    tinoUserId: `user-${Math.random().toString(36).slice(2, 10)}`,
    linkedAt: Date.now(),
    ...overrides,
  };
}

describe("createSqliteIdentityStore", () => {
  // a2.1 — resolve returns null when no link exists
  it("IdentityStore.resolve returns null when no link", async () => {
    const store = createSqliteIdentityStore({ dbPath: tempDbPath() });
    const result = await store.resolve("slack", "U_NONEXISTENT");
    expect(result).toBeNull();
  });

  // a2.2 — duplicate (provider, externalId) is rejected
  it("IdentityStore.link rejects duplicate (provider, externalId)", async () => {
    const store = createSqliteIdentityStore({ dbPath: tempDbPath() });
    const identity = makeIdentity({ provider: "slack", externalId: "U01OWNER" });
    await store.link(identity);

    const duplicate = makeIdentity({
      provider: "slack",
      externalId: "U01OWNER",
      tinoUserId: "different-user",
    });
    expect(() => store.link(duplicate)).toThrow(IdentityLinkConflictError);

    const resolved = await store.resolve("slack", "U01OWNER");
    expect(resolved).toBe(identity.tinoUserId);
  });

  // a2.3 — listForUser returns all linked identities ordered by linkedAt
  it("IdentityStore.listForUser returns all linked identities", async () => {
    const store = createSqliteIdentityStore({ dbPath: tempDbPath() });
    const userId = "user-multi";
    const now = Date.now();

    const slack = makeIdentity({ provider: "slack", externalId: "U01SLACK", tinoUserId: userId, linkedAt: now });
    const google = makeIdentity({ provider: "google", externalId: "alice@example.com", tinoUserId: userId, linkedAt: now + 100 });
    await store.link(slack);
    await store.link(google);

    const identities = await store.listForUser(userId);
    expect(identities).toHaveLength(2);
    expect(identities[0].provider).toBe("slack");
    expect(identities[0].externalId).toBe("U01SLACK");
    expect(identities[1].provider).toBe("google");
    expect(identities[1].externalId).toBe("alice@example.com");

    const otherUser = await store.listForUser("user-nobody");
    expect(otherUser).toHaveLength(0);
  });
});
