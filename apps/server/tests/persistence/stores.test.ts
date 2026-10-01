/**
 * Contract tests for the Postgres stores, on PGlite. The isolation block is the
 * point of the file: two orgs with colliding ids and keys must never see each
 * other's rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Org } from "@tino/core/domain/org";
import { IdentityLinkConflictError, OrgSlugTakenError, type TinoUser } from "@tino/core/domain/types";
import { membersOfChannel, onlyUser } from "@tino/core/domain/who-can-see";
import type { LoggedMessage } from "@tino/core/ports/outbound";
import { testDb } from "../_db.js";

let db: Awaited<ReturnType<typeof testDb>>;
let a: Org;
let b: Org;

beforeAll(async () => {
  db = await testDb();
  a = await db.makeOrg("acme");
  b = await db.makeOrg("globex");
});
afterAll(async () => {
  await db.pool.end();
});

const mkUser = (over: Partial<TinoUser> = {}): TinoUser => ({
  id: globalThis.crypto.randomUUID(),
  email: `p-${globalThis.crypto.randomUUID().slice(0, 8)}@acme.io`,
  name: "Pat",
  role: "member",
  status: "active",
  slackUserId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
});

const msg = (over: Partial<LoggedMessage> = {}): LoggedMessage => ({
  threadKey: "channel:C1:1.0",
  turnId: "t1",
  askedBy: "u1",
  askedWhere: "channel",
  whoCanSee: membersOfChannel("C1"),
  role: "user",
  text: "hi",
  message: { role: "user", content: "hi" },
  createdAt: Date.now(),
  ...over,
});

describe("orgs", () => {
  it("creates, finds by slug and Slack team, and refuses a taken slug", async () => {
    expect((await db.orgs.getBySlug("acme"))?.id).toBe(a.id);
    await db.orgs.update(a.id, { slackTeamId: "T1" });
    expect((await db.orgs.getBySlackTeam("T1"))?.id).toBe(a.id);
    await expect(db.makeOrg("acme")).rejects.toBeInstanceOf(OrgSlugTakenError);
  });
});

describe("config", () => {
  it("round-trips raw JSON, lists, deletes", async () => {
    const config = db.forOrg(a.id).config;
    await config.set("model.provider", "openai");
    expect(await config.get("model.provider")).toBe(JSON.stringify("openai"));
    expect(await config.getTyped("missing", 7)).toBe(7);
    expect((await config.list()).map((e) => e.key)).toContain("model.provider");
    expect(await config.delete("model.provider")).toBe(true);
    expect(await config.delete("model.provider")).toBe(false);
  });

  it("encrypts secrets at rest and decrypts them on read", async () => {
    const config = db.forOrg(a.id).config;
    await config.set("openai.apiKey", "sk-very-secret");
    const raw = await db.pool.query("SELECT value, is_secret FROM org_config WHERE org_id=$1 AND key='openai.apiKey'", [
      a.id,
    ]);
    expect(raw.rows[0].is_secret).toBe(true);
    expect(raw.rows[0].value).not.toContain("sk-very-secret");
    expect(await config.getTyped("openai.apiKey", "")).toBe("sk-very-secret");
  });

  it("can't decrypt one org's secret as another's", async () => {
    await db.forOrg(a.id).config.set("slack.botToken", "xoxb-a");
    const row = await db.pool.query("SELECT value FROM org_config WHERE org_id=$1 AND key='slack.botToken'", [a.id]);
    await db.pool.query(
      "INSERT INTO org_config (org_id, key, value, is_secret, updated_at) VALUES ($1,'slack.botToken',$2,true,0)",
      [b.id, row.rows[0].value],
    );
    await expect(db.forOrg(b.id).config.get("slack.botToken")).rejects.toThrow();
  });
});

describe("users + identities", () => {
  it("round-trips, finds by email case-insensitively, patches", async () => {
    const { users } = db.forOrg(a.id);
    const u = await users.create(mkUser({ email: "Alice@Acme.io" }));
    expect((await users.getByEmail("ALICE@acme.io"))?.id).toBe(u.id);
    const patched = await users.update(u.id, { role: "admin", slackUserId: "U1" });
    expect(patched).toMatchObject({ role: "admin", slackUserId: "U1" });
  });

  it("rejects a duplicate identity link", async () => {
    const { users, identities } = db.forOrg(a.id);
    const u = await users.create(mkUser());
    await identities.link({ provider: "slack", externalId: "U-dup", tinoUserId: u.id, linkedAt: 1 });
    await expect(
      identities.link({ provider: "slack", externalId: "U-dup", tinoUserId: u.id, linkedAt: 2 }),
    ).rejects.toBeInstanceOf(IdentityLinkConflictError);
    expect(await identities.listForUser(u.id)).toHaveLength(1);
  });
});

describe("user capabilities", () => {
  it("encrypts credentials and keeps settings readable", async () => {
    const caps = db.forOrg(a.id).userCapabilities;
    await caps.set("u-cap", "gmail", { enabled: true, credentials: { refreshToken: "rt-1" }, settings: { x: 1 } });
    expect(await caps.get("u-cap", "gmail")).toEqual({
      enabled: true,
      credentials: { refreshToken: "rt-1" },
      settings: { x: 1 },
    });
    const raw = await db.pool.query("SELECT credentials_json FROM user_capability WHERE tino_user_id='u-cap'");
    expect(JSON.stringify(raw.rows[0].credentials_json)).not.toContain("rt-1");
    expect(await caps.list("u-cap")).toEqual([{ capabilityId: "gmail", enabled: true }]);
    expect(await caps.delete("u-cap", "gmail")).toBe(true);
    expect(await caps.get("u-cap", "gmail")).toBeNull();
  });
});

describe("conversation log", () => {
  it("returns a thread oldest-first with labels, and finds what one person asked", async () => {
    const log = db.forOrg(a.id).conversations;
    await log.append([msg({ text: "one", createdAt: 1 }), msg({ text: "two", createdAt: 2, role: "assistant" })]);
    await log.append([msg({ threadKey: "direct:u1", askedWhere: "slack_dm", whoCanSee: onlyUser("u1"), text: "dm" })]);
    const thread = await log.recentInThread("channel:C1:1.0", 10);
    expect(thread.map((m) => m.text)).toEqual(["one", "two"]);
    expect(thread[0]?.whoCanSee).toEqual(membersOfChannel("C1"));
    expect((await log.recentAskedBy("u1", 10)).map((m) => m.text)).toEqual(["one", "two", "dm"]);
    await log.clearThread("direct:u1");
    expect(await log.recentInThread("direct:u1", 10)).toEqual([]);
  });

  it("trims each thread to its newest messages", async () => {
    const { createPgConversationLog } = await import(
      "../../src/infrastructure/driven/persistence/postgres/conversation-log.js"
    );
    const log = createPgConversationLog({ pool: db.pool, orgId: a.id, keepPerThread: 3 });
    await log.append([1, 2, 3, 4, 5].map((n) => msg({ threadKey: "channel:CT:1", text: String(n) })));
    expect((await log.recentInThread("channel:CT:1", 10)).map((m) => m.text)).toEqual(["3", "4", "5"]);
  });
});

describe("isolation between orgs", () => {
  it("keeps users, identities, config, capabilities and conversations apart", async () => {
    const A = db.forOrg(a.id);
    const B = db.forOrg(b.id);
    const ua = await A.users.create(mkUser({ email: "same@both.io" }));
    const ub = await B.users.create(mkUser({ email: "same@both.io" }));

    expect(await B.users.get(ua.id)).toBeNull();
    expect((await B.users.getByEmail("same@both.io"))?.id).toBe(ub.id);
    expect((await B.users.list()).map((u) => u.id)).not.toContain(ua.id);
    await expect(B.users.update(ua.id, { role: "admin" })).rejects.toThrow();

    // Slack user ids can repeat across workspaces; each org resolves its own.
    await A.identities.link({ provider: "slack", externalId: "U-SAME", tinoUserId: ua.id, linkedAt: 1 });
    await B.identities.link({ provider: "slack", externalId: "U-SAME", tinoUserId: ub.id, linkedAt: 1 });
    expect(await A.identities.resolve("slack", "U-SAME")).toBe(ua.id);
    expect(await B.identities.resolve("slack", "U-SAME")).toBe(ub.id);

    await A.config.set("org.accessControl.mode", "org-domain");
    expect(await B.config.get("org.accessControl.mode")).toBeNull();

    await A.userCapabilities.set(ua.id, "slack", { enabled: true, credentials: { userToken: "x" }, settings: {} });
    expect(await B.userCapabilities.get(ua.id, "slack")).toBeNull();
    expect(await B.userCapabilities.delete(ua.id, "slack")).toBe(false);

    // Channel ids can repeat across workspaces too.
    await A.conversations.append([msg({ threadKey: "channel:C9:1", text: "acme secret" })]);
    expect(await B.conversations.recentInThread("channel:C9:1", 10)).toEqual([]);
    await B.conversations.clearThread("channel:C9:1");
    expect(await A.conversations.recentInThread("channel:C9:1", 10)).toHaveLength(1);
  });
});

describe("membership directory", () => {
  it("finds every org an address belongs to, and orgs it may join by domain", async () => {
    const c = await db.makeOrg("initech");
    await db.forOrg(c.id).users.create(mkUser({ email: "sam@initech.com" }));
    const d = await db.makeOrg("initech-labs");
    await db.forOrg(d.id).config.set("org.accessControl.mode", "org-domain");
    await db.forOrg(d.id).config.set("org.accessControl.orgDomain", "initech.com");

    const memberships = await db.memberships.byEmail("SAM@initech.com");
    expect(memberships.map((m) => m.org.slug)).toEqual(["initech"]);
    expect((await db.memberships.joinableByDomain("sam@initech.com")).map((o) => o.slug)).toEqual(["initech-labs"]);
    expect(await db.memberships.joinableByDomain("sam@elsewhere.com")).toEqual([]);

    await db.forOrg(d.id).config.set("org.accessControl.mode", "allowlist");
    expect(await db.memberships.joinableByDomain("sam@initech.com")).toEqual([]);
  });
});
