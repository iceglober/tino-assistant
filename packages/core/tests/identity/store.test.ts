import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteUserStore } from "../../src/identity/store.js";
import type { TinoUser } from "../../src/identity/types.js";

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
