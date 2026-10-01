/**
 * The org runtime's credential view: Google credentials come back with the
 * client that minted them, and lose it when that client is gone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrgRuntime, type OrgRuntime } from "../../src/bootstrap/org-runtime.js";
import { createMcpClientPool } from "../../src/infrastructure/driven/mcp/client-pool.js";
import { noopLogger, testDb } from "../_db.js";

let db: Awaited<ReturnType<typeof testDb>>;
let rt: OrgRuntime;

beforeAll(async () => {
  db = await testDb();
  const org = await db.makeOrg("runtime-co");
  rt = await createOrgRuntime(org, db.forOrg(org.id), {
    pool: db.pool,
    logger: noopLogger,
    baseUrl: "http://localhost",
    mcpPool: createMcpClientPool({ logger: noopLogger }),
    platformClients: { google: null, slack: null },
    platformEmbedder: null,
    platformUsers: async () => 0,
    kbAvailable: true,
    slackConnectLink: () => "",
  });
});
afterAll(async () => {
  await db.pool.end();
});

describe("org runtime credentials", () => {
  it("joins the org client's secret into Google credentials, and drops it when the client changes", async () => {
    const { config, userCapabilities } = rt.stores;
    await config.set("google.oauth.clientId", "cid");
    await config.set("google.oauth.clientSecret", "csecret");
    await userCapabilities.set("u1", "gmail", {
      enabled: true,
      credentials: { refreshToken: "rt" },
      settings: { client: { owner: "org", clientId: "cid" } },
    });
    expect((await userCapabilities.get("u1", "gmail"))?.credentials).toEqual({
      refreshToken: "rt",
      clientId: "cid",
      clientSecret: "csecret",
    });

    await config.set("google.oauth.clientId", "rotated-to-another-client");
    expect((await userCapabilities.get("u1", "gmail"))?.credentials).toEqual({ refreshToken: "rt" });
  });

  it("reports why the knowledge base is off", async () => {
    expect((await rt.status()).kb).toMatchObject({ enabled: false, reason: expect.stringContaining("embedding") });
  });
});
