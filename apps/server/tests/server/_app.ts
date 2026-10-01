/**
 * The whole HTTP app wired as main.ts wires it — real better-auth, real stores,
 * an in-memory PGlite — plus a tiny cookie-jar client per person.
 */

import { createOrgRegistry } from "../../src/bootstrap/org-registry.js";
import { LocalAdapter } from "../../src/infrastructure/driven/crypto/local-adapter.js";
import type { Email } from "../../src/infrastructure/driven/email/sender.js";
import { createMcpClientPool } from "../../src/infrastructure/driven/mcp/client-pool.js";
import { createPglitePool } from "../../src/infrastructure/driven/persistence/db.js";
import { createPersistence } from "../../src/infrastructure/driven/persistence/postgres/index.js";
import { createAuth } from "../../src/infrastructure/driving/http/auth.js";
import { slackConnectLink } from "../../src/infrastructure/driving/http/routes/connections.js";
import { createHttpApp } from "../../src/infrastructure/driving/http/server.js";
import { createSignedState } from "../../src/infrastructure/security/signed-state.js";
import { noopLogger } from "../_db.js";

export const BASE = "http://localhost:3001";

export async function testApp(
  opts: { signups?: "open" | "closed"; trustUnverified?: boolean; canCreateOrg?: (email: string) => boolean } = {},
) {
  const pool = await createPglitePool();
  const persistence = await createPersistence(pool, noopLogger, new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "k" }));
  const state = createSignedState("test-auth-secret-test-auth-secret!!");
  const sent: Email[] = [];
  const email = { delivers: false, send: async (e: Email) => void sent.push(e) };
  const mcpPool = createMcpClientPool({ logger: noopLogger });
  const platformClients = { google: null, slack: null };
  const registry = createOrgRegistry(
    persistence,
    {
      pool,
      logger: noopLogger,
      baseUrl: BASE,
      mcpPool,
      platformClients,
      platformEmbedder: null,
      platformUsers: async () => 0,
      kbAvailable: persistence.kbAvailable,
      slackConnectLink: (orgId, userId) => slackConnectLink(state, BASE, orgId, userId),
    },
    noopLogger,
  );
  const auth = await createAuth({
    baseUrl: BASE,
    secret: "test-auth-secret-test-auth-secret!!",
    database: pool,
    email,
    requireEmailVerification: false,
    logger: noopLogger,
  });
  const app = createHttpApp({
    auth,
    persistence,
    registry,
    connections: { baseUrl: BASE, state, platformClients },
    platformInfo: () => ({
      baseUrl: BASE,
      signups: opts.signups ?? "open",
      signIn: { email: true, google: false },
      emailVerification: false,
      managed: { google: { calendar: false, gmail: false, pilot: false }, slack: false },
      platformEmbeddings: false,
    }),
    mcpPool,
    trustUnverified: opts.trustUnverified ?? true,
    canCreateOrg: opts.canCreateOrg ?? (() => true),
    onInvite: async (i) => void sent.push({ to: i.email, subject: `invite to ${i.orgSlug}`, text: "" }),
    logger: noopLogger,
  });

  /** A browser for one person: keeps their session cookie. */
  const person = () => {
    let cookie = "";
    const request = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await app.request(`${BASE}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          origin: BASE,
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
        redirect: "manual",
      });
      const set = res.headers.getSetCookie?.() ?? [];
      for (const c of set) {
        const [pair] = c.split(";");
        if (pair?.startsWith("better-auth.session_token=")) cookie = pair;
      }
      return res;
    };
    return {
      request,
      json: async <T = unknown>(method: string, path: string, body?: unknown) => {
        const res = await request(method, path, body);
        return { status: res.status, body: (await res.json().catch(() => null)) as T };
      },
      async signUp(address: string, name = "Pat") {
        const res = await request("POST", "/api/auth/sign-up/email", {
          email: address,
          password: "correct-horse-1",
          name,
        });
        if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
      },
    };
  };

  return { app, pool, persistence, registry, sent, person, state, close: () => pool.end() };
}
