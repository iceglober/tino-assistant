import { parseDontLearnFrom } from "@tino/core/domain/dont-learn-from";
import type { CapabilityConfig } from "@tino/core/domain/types";
import type { UserCapabilityStore } from "@tino/core/ports/outbound";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createDontLearnFromStore } from "../../src/infrastructure/driven/kb/dont-learn-from-store.js";
import type { AuthVariables } from "../../src/infrastructure/driving/http/auth.js";
import { createKbRoutes, type KbRoutesDeps } from "../../src/infrastructure/driving/http/routes/kb.js";
import { noopLogger } from "./_helpers.js";

function memCaps(): UserCapabilityStore {
  const rows = new Map<string, CapabilityConfig>();
  return {
    get: async (u, c) => rows.get(`${u}|${c}`) ?? null,
    set: async (u, c, cfg) => void rows.set(`${u}|${c}`, cfg),
    list: async () => [],
    delete: async (u, c) => rows.delete(`${u}|${c}`),
  };
}

function app(userId: string | null) {
  const store = createDontLearnFromStore(memCaps());
  const deps = {
    logger: noopLogger(),
    dontLearnFrom: {
      get: vi.fn(async (id: string) => ({ exclusions: await store.get(id), gmailConnected: false, options: null })),
      set: async (id: string, input: unknown) => {
        const parsed = parseDontLearnFrom(input);
        if (typeof parsed === "string") return { ok: false as const, error: parsed };
        await store.set(id, parsed);
        return { ok: true as const, value: { exclusions: parsed } };
      },
    },
  } as unknown as KbRoutesDeps;
  const a = new Hono<{ Variables: AuthVariables }>();
  a.use("*", async (c, next) => {
    if (userId)
      c.set("user", {
        id: userId,
        email: "u@acme.io",
        name: null,
        role: "member",
        status: "active",
        slackUserId: null,
      });
    await next();
  });
  a.route(
    "/api/kb",
    createKbRoutes(() => deps),
  );
  const call = (method: string, body?: unknown) =>
    a.request("/api/kb/dont-learn-from", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { call, deps };
}

describe("/api/kb/dont-learn-from", () => {
  it("needs a signed-in user", async () => {
    expect((await app(null).call("GET")).status).toBe(401);
  });

  it("saves and returns the caller's own list", async () => {
    const { call, deps } = app("u1");
    const put = await call("PUT", { gmail: [{ kind: "gmailLabel", labelId: "Label_W", name: "warmup" }] });
    expect(put.status).toBe(200);
    const got = (await (await call("GET")).json()) as { exclusions: { gmail: unknown[] } };
    expect(got.exclusions.gmail).toEqual([{ kind: "gmailLabel", labelId: "Label_W", name: "warmup" }]);
    expect(deps.dontLearnFrom.get).toHaveBeenCalledWith("u1");
  });

  it("rejects invalid input with a readable reason", async () => {
    const res = await app("u1").call("PUT", { gmail: [{ kind: "gmailSearch", query: "from:(x" }] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("unbalanced parentheses");
  });

  it("the store treats a corrupted saved list as nothing excluded", async () => {
    const caps = memCaps();
    await caps.set("u1", "kb.dont-learn-from", { enabled: true, credentials: {}, settings: { gmail: "nonsense" } });
    expect(await createDontLearnFromStore(caps).get("u1")).toEqual({ gmail: [] });
  });
});
