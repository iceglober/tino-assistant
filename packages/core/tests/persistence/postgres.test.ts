/**
 * Contract tests for the Postgres persistence adapters, run against a real
 * pgvector Postgres (docker compose up -d postgres):
 *
 *   TEST_DATABASE_URL=postgres://tino:tino@localhost:5433/tino bun run test
 *
 * Skipped when TEST_DATABASE_URL is absent so the default suite stays
 * zero-dependency. Mirrors the sqlite adapters' behavior contract.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityLinkConflictError } from "../../src/domain/types.js";
import { LocalAdapter } from "../../src/infrastructure/driven/crypto/local-adapter.js";
import { getGoogleRefreshTokenPg } from "../../src/infrastructure/driven/persistence/postgres/auth-account.js";
import { createPgPool } from "../../src/infrastructure/driven/persistence/postgres/client.js";
import { createPgConfigStore } from "../../src/infrastructure/driven/persistence/postgres/config.js";
import { createPgHistoryStore } from "../../src/infrastructure/driven/persistence/postgres/history.js";
import { ensureSchema } from "../../src/infrastructure/driven/persistence/postgres/schema.js";
import { createPgUserCapabilityStore } from "../../src/infrastructure/driven/persistence/postgres/user-capabilities.js";
import { createPgIdentityStore, createPgUserStore } from "../../src/infrastructure/driven/persistence/postgres/users.js";
import type { TinoUser } from "../../src/domain/types.js";

const DB_URL = process.env.TEST_DATABASE_URL;

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!DB_URL)("postgres persistence adapters", () => {
  const pool = DB_URL ? createPgPool(DB_URL) : (null as never);
  const crypto = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "pg-contract-test-key" });

  beforeAll(async () => {
    await ensureSchema(pool, noopLogger);
    // Dedicated local test DB — truncate for a deterministic run.
    await pool.query("TRUNCATE config, user_capability, conversation, identity, tino_user CASCADE");
  });

  afterAll(async () => {
    await pool?.end();
  });

  const mkUser = (over: Partial<TinoUser> = {}): TinoUser => ({
    id: globalThis.crypto.randomUUID(),
    email: `alice-${globalThis.crypto.randomUUID().slice(0, 8)}@acme.io`,
    name: "Alice",
    role: "admin",
    status: "active",
    slackUserId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  });

  it("config: raw-string round trip, list, delete", async () => {
    const config = createPgConfigStore({ pool });
    await config.set("test.key", "hello");
    expect(await config.get("test.key")).toBe(JSON.stringify("hello")); // raw stored string
    expect(await config.getTyped("test.key", "")).toBe("hello");
    expect(await config.getTyped("test.missing", "fallback")).toBe("fallback");

    await config.set("test.key", { nested: true });
    expect(await config.getTyped<{ nested: boolean }>("test.key", { nested: false })).toEqual({ nested: true });

    const list = await config.list();
    expect(list.some((e) => e.key === "test.key")).toBe(true);
    expect(typeof list[0]?.updatedAt).toBe("number"); // int8 mapped back to number

    expect(await config.delete("test.key")).toBe(true);
    expect(await config.delete("test.key")).toBe(false);
  });

  it("history: append, trim to cap, reset", async () => {
    const history = createPgHistoryStore({ pool, cap: 4 });
    const uid = `hist-${globalThis.crypto.randomUUID()}`;
    expect(await history.get(uid)).toEqual([]);

    for (let i = 0; i < 6; i++) {
      await history.append(uid, [{ role: "user", content: `m${i}` }]);
    }
    const msgs = (await history.get(uid)) as Array<{ content: string }>;
    expect(msgs).toHaveLength(4); // trimmed to cap
    expect(msgs[msgs.length - 1]?.content).toBe("m5");

    await history.reset(uid);
    expect(await history.get(uid)).toEqual([]);
  });

  it("users: create/get/getByEmail (case-insensitive)/list/update", async () => {
    const users = createPgUserStore({ pool });
    const u = await users.create(mkUser({ email: "Case-Test@Acme.IO" }));

    expect((await users.get(u.id))?.email).toBe("Case-Test@Acme.IO");
    expect((await users.getByEmail("case-test@acme.io"))?.id).toBe(u.id);

    const updated = await users.update(u.id, { status: "suspended", slackUserId: "U123" });
    expect(updated.status).toBe("suspended");
    expect(updated.slackUserId).toBe("U123");
    expect(typeof updated.createdAt).toBe("number");

    await expect(users.update("nope", { status: "active" })).rejects.toThrow(/not found/);
  });

  it("identities: resolve, link, duplicate → IdentityLinkConflictError", async () => {
    const users = createPgUserStore({ pool });
    const identities = createPgIdentityStore({ pool });
    const u = await users.create(mkUser());

    expect(await identities.resolve("slack", "U_PGTEST")).toBeNull();
    await identities.link({ provider: "slack", externalId: "U_PGTEST", tinoUserId: u.id, linkedAt: Date.now() });
    expect(await identities.resolve("slack", "U_PGTEST")).toBe(u.id);

    await expect(
      identities.link({ provider: "slack", externalId: "U_PGTEST", tinoUserId: u.id, linkedAt: Date.now() }),
    ).rejects.toThrow(IdentityLinkConflictError);

    const linked = await identities.listForUser(u.id);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.externalId).toBe("U_PGTEST");
  });

  it("user capabilities: encrypted round trip, cross-user isolation, list/delete", async () => {
    const caps = createPgUserCapabilityStore({ pool, cryptoAdapter: crypto });
    const uidA = `capA-${globalThis.crypto.randomUUID()}`;
    const uidB = `capB-${globalThis.crypto.randomUUID()}`;

    await caps.set(uidA, "gmail", { enabled: true, credentials: { refreshToken: "secret-a" }, settings: { x: 1 } });
    const got = await caps.get(uidA, "gmail");
    expect(got?.enabled).toBe(true);
    expect(got?.credentials.refreshToken).toBe("secret-a"); // decrypted
    expect(got?.settings).toEqual({ x: 1 });

    // Stored ciphertext, not plaintext.
    const raw = await pool.query<{ credentials_json: Record<string, { ciphertext: string }> }>(
      "SELECT credentials_json FROM user_capability WHERE tino_user_id = $1",
      [uidA],
    );
    expect(JSON.stringify(raw.rows[0]?.credentials_json)).not.toContain("secret-a");

    expect(await caps.get(uidB, "gmail")).toBeNull();

    expect(await caps.list(uidA)).toEqual([{ capabilityId: "gmail", enabled: true }]);
    expect(await caps.delete(uidA, "gmail")).toBe(true);
    expect(await caps.delete(uidA, "gmail")).toBe(false);
  });

  it("getGoogleRefreshTokenPg returns null when better-auth tables don't exist", async () => {
    expect(await getGoogleRefreshTokenPg(pool, "whoever")).toBeNull();
  });

  it("schema bootstrap is idempotent", async () => {
    await ensureSchema(pool, noopLogger);
    await ensureSchema(pool, noopLogger);
  });
});
