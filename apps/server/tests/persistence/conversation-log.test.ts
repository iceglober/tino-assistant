import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { everyoneInWorkspace, membersOfChannel, onlyUser, onlyUserInChannel } from "@tino/core/domain/who-can-see";
import { createSqliteConversationLog } from "../../src/infrastructure/driven/persistence/sqlite-conversation-log.js";
import type { LoggedMessage } from "@tino/core/ports/outbound";

const tempDb = (): string => join(mkdtempSync(join(tmpdir(), "tino-log-")), "tino.db");

let seq = 0;
const msg = (over: Partial<LoggedMessage> = {}): LoggedMessage => ({
  threadKey: "direct:u1",
  turnId: "t1",
  askedBy: "u1",
  askedWhere: "slack_dm",
  whoCanSee: onlyUser("u1"),
  role: "user",
  text: `hello ${seq}`,
  message: { role: "user", content: `hello ${seq++}` },
  createdAt: Date.now(),
  ...over,
});

describe("sqlite conversation log", () => {
  it("returns a thread's latest messages oldest-first, with labels intact", async () => {
    const log = createSqliteConversationLog({ dbPath: tempDb() });
    const labels = [
      onlyUser("u1"),
      membersOfChannel("C1", { insidersOnly: true }),
      onlyUserInChannel("u1", "C1"),
      everyoneInWorkspace,
    ];
    await log.append(labels.map((whoCanSee, i) => msg({ whoCanSee, text: `m${i}` })));
    const rows = await log.recentInThread("direct:u1", 3);
    expect(rows.map((r) => r.text)).toEqual(["m1", "m2", "m3"]);
    expect(rows.map((r) => r.whoCanSee)).toEqual(labels.slice(1));
    expect(rows[0]?.message).toEqual({ role: "user", content: expect.any(String) });
  });

  it("keeps threads apart but finds everything one person asked", async () => {
    const log = createSqliteConversationLog({ dbPath: tempDb() });
    await log.append([msg({ threadKey: "direct:u1", text: "dm" })]);
    await log.append([msg({ threadKey: "channel:C1:1.0", askedWhere: "channel", text: "in channel" })]);
    await log.append([msg({ threadKey: "channel:C1:1.0", askedBy: "u2", text: "someone else" })]);

    expect((await log.recentInThread("direct:u1", 10)).map((r) => r.text)).toEqual(["dm"]);
    expect((await log.recentInThread("channel:C1:1.0", 10)).map((r) => r.text)).toEqual(["in channel", "someone else"]);
    expect((await log.recentAskedBy("u1", 10)).map((r) => r.text)).toEqual(["dm", "in channel"]);
  });

  it("trims each thread to its newest messages", async () => {
    const log = createSqliteConversationLog({ dbPath: tempDb(), keepPerThread: 3 });
    for (let i = 0; i < 5; i++) await log.append([msg({ text: `m${i}` })]);
    await log.append([msg({ threadKey: "direct:u2", askedBy: "u2", text: "other" })]);
    expect((await log.recentInThread("direct:u1", 10)).map((r) => r.text)).toEqual(["m2", "m3", "m4"]);
    expect((await log.recentInThread("direct:u2", 10)).map((r) => r.text)).toEqual(["other"]);
  });

  it("clears one thread only", async () => {
    const log = createSqliteConversationLog({ dbPath: tempDb() });
    await log.append([msg({ threadKey: "direct:u1" }), msg({ threadKey: "channel:C1:1.0" })]);
    await log.clearThread("direct:u1");
    expect(await log.recentInThread("direct:u1", 10)).toEqual([]);
    expect(await log.recentInThread("channel:C1:1.0", 10)).toHaveLength(1);
  });

  it("survives a restart", async () => {
    const dbPath = tempDb();
    await createSqliteConversationLog({ dbPath }).append([msg({ text: "persisted" })]);
    expect((await createSqliteConversationLog({ dbPath }).recentInThread("direct:u1", 10))[0]?.text).toBe("persisted");
  });

  it("imports the old per-user history once, labelled by where it came from", async () => {
    const dbPath = tempDb();
    const old = new Database(dbPath);
    old.exec(
      "CREATE TABLE conversations (user_id TEXT PRIMARY KEY, messages_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    );
    const insert = old.query("INSERT INTO conversations VALUES (?, ?, ?)");
    insert.run(
      "u1",
      JSON.stringify([
        { role: "user", content: "old question" },
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "x", toolName: "t", input: {} }] },
        { role: "tool", content: [] },
        { role: "assistant", content: [{ type: "text", text: "old answer" }] },
      ]),
      1_000_000,
    );
    insert.run("channel:C1:5.0", JSON.stringify([{ role: "user", content: "thread question" }]), 1_000_000);
    old.close();

    const log = createSqliteConversationLog({ dbPath });
    const dm = await log.recentInThread("direct:u1", 10);
    expect(dm.map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(dm.every((r) => r.askedBy === "u1" && r.whoCanSee.kind === "onlyUser")).toBe(true);
    // Imported rows continue their thread but aren't recalled elsewhere.
    expect(dm.every((r) => r.text === null)).toBe(true);

    const thread = await log.recentInThread("channel:C1:5.0", 10);
    expect(thread[0]?.whoCanSee).toEqual(membersOfChannel("C1"));

    // Opening again doesn't import twice; the old table is kept under a new name.
    const again = createSqliteConversationLog({ dbPath });
    expect(await again.recentInThread("direct:u1", 10)).toHaveLength(4);
    const tables = new Database(dbPath).query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
      name: string;
    }>;
    expect(tables.map((t) => t.name)).toContain("conversations_before_log");
    expect(tables.map((t) => t.name)).not.toContain("conversations");
  });
});
