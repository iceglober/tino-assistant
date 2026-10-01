/**
 * POST /api/reload/slack route.
 *
 * The route is a thin shell over a caller-supplied callback. It:
 *   - returns 501 when no callback was wired
 *   - returns HTTP 200 with `{ ok, error? }` when the callback resolves
 *     (user-visible failures don't escalate to 5xx)
 *   - returns HTTP 500 only when the callback itself throws
 *
 * Auth-gated by the top-level middleware; `fakeAdmin()` supplies a signed-in user.
 */

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createReloadRoutes } from "../../src/infrastructure/driving/http/routes/reload.js";
import { fakeAdmin, noopLogger } from "./_helpers.js";

function mountReload(opts: Parameters<typeof createReloadRoutes>[0]): Hono {
  const app = new Hono();
  app.use("*", fakeAdmin());
  app.route("/api/reload", createReloadRoutes(opts));
  return app;
}

describe("POST /api/reload/slack", () => {
  it("returns 501 when no reconnectSlack callback is wired", async () => {
    const app = mountReload({});
    const res = await app.request("/api/reload/slack", { method: "POST" });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it("returns 200 + { ok: true } when reconnectSlack succeeds", async () => {
    const reconnectSlack = vi.fn(async () => ({ ok: true }));
    const app = mountReload({ reconnectSlack, logger: noopLogger() });

    const res = await app.request("/api/reload/slack", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(reconnectSlack).toHaveBeenCalledTimes(1);
  });

  it("returns 200 + { ok: false, error } on user-visible failure (invalid tokens)", async () => {
    // The reconnect callback resolves cleanly with ok:false. The route MUST
    // return 200 (not 5xx) so the console can toast the error without treating
    // it as a server bug.
    const reconnectSlack = vi.fn(async () => ({ ok: false, error: "slack rejected token: invalid_auth" }));
    const app = mountReload({ reconnectSlack, logger: noopLogger() });

    const res = await app.request("/api/reload/slack", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("invalid_auth");
  });

  it("returns 500 only when the callback itself throws (server bug)", async () => {
    const reconnectSlack = vi.fn(async () => {
      throw new Error("boom");
    });
    const app = mountReload({ reconnectSlack, logger: noopLogger() });

    const res = await app.request("/api/reload/slack", { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("boom");
  });
});
