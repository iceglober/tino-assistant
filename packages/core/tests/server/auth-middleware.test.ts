import type { Auth } from "better-auth";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type AuthVariables, buildAuthMiddleware } from "../../src/server/middleware/auth.js";
import type { AppLogger } from "../../src/slack/app.js";

/**
 * Regression test for wave 1, item 1.1 (gap #2):
 * the auth middleware MUST return JSON 401 (not HTML) for missing-session
 * `/api/*` requests. The console SPA's fetch() helpers expect JSON; an HTML
 * payload makes them throw `<!DOCTYPE …>` parse errors.
 *
 * The previous raw-http implementation in `console/server.ts` short-circuited
 * to the login HTML before this branch ran. Wave 0's Hono rewrite fixed it.
 * This test locks the fix in.
 */

function noopLogger(): AppLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/** Stub the `Auth` shape we touch — only `api.getSession`. */
function stubAuth(session: unknown): Auth {
  return {
    api: {
      getSession: async () => session,
    },
    // The middleware never touches anything else on this object.
    // biome-ignore lint/suspicious/noExplicitAny: test stub does not need full Auth type
  } as any as Auth;
}

function buildApp(auth: Auth | null, allowedDomain?: string) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", buildAuthMiddleware({ auth, allowedDomain, logger: noopLogger() }));
  // Downstream handlers — let us tell "passed through" from "401'd".
  app.get("/api/config", (c) => c.json([{ key: "k", value: "v" }]));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/", (c) => c.html("<!DOCTYPE html><html></html>"));
  app.get("/assets/tino-logo.png", (c) => c.body(new Uint8Array([0x89, 0x50])));
  return app;
}

describe("auth middleware — 401 JSON for unauthenticated /api/* (gap #2)", () => {
  it("returns 401 JSON for /api/config when no session", async () => {
    const app = buildApp(stubAuth(null));
    const res = await app.request("/api/config");

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("unauthorized");
    expect(body.message).toBe("sign in required");
  });

  it("returns 401 JSON (not HTML) for /api/capabilities when no session", async () => {
    const app = buildApp(stubAuth(null));
    // Mount a stub /api/capabilities so the middleware is exercised before SPA fallback.
    app.get("/api/capabilities", (c) => c.json([]));

    const res = await app.request("/api/capabilities");

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const text = await res.text();
    expect(text.startsWith("<")).toBe(false);
  });

  it("passes /api/config through to the route when session exists", async () => {
    const app = buildApp(stubAuth({ user: { id: "u1", email: "a@example.com", name: "A" } }));
    const res = await app.request("/api/config");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ key: string; value: string }>;
    expect(body).toEqual([{ key: "k", value: "v" }]);
  });

  it("exempts /api/health from auth (ALB liveness check)", async () => {
    const app = buildApp(stubAuth(null));
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("exempts /assets/* from auth (logo on login page)", async () => {
    const app = buildApp(stubAuth(null));
    const res = await app.request("/assets/tino-logo.png");

    expect(res.status).toBe(200);
  });

  it("lets non-API requests fall through to SPA when no session (React Login renders)", async () => {
    const app = buildApp(stubAuth(null));
    const res = await app.request("/");

    // Falls through — SPA serves index.html, React app then asks /api/auth/get-session
    // and shows <Login> on null. Important: NO redirect / no HTML 401.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("is a no-op when auth is null (local dev, no GOOGLE_OAUTH_CLIENT_ID)", async () => {
    const app = buildApp(null);
    const res = await app.request("/api/config");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ key: string; value: string }>;
    expect(body).toEqual([{ key: "k", value: "v" }]);
  });

  it("returns 403 JSON when session email is outside allowedDomain", async () => {
    const app = buildApp(stubAuth({ user: { id: "u1", email: "evil@other.com", name: "A" } }), "example.com");
    const res = await app.request("/api/config");

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("admits session whose email matches allowedDomain", async () => {
    const app = buildApp(stubAuth({ user: { id: "u1", email: "ok@example.com", name: "A" } }), "example.com");
    const res = await app.request("/api/config");

    expect(res.status).toBe(200);
  });
});
