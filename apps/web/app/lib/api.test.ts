import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, accountApi, orgApi, signinUrl } from "./api";

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(body === undefined ? "" : JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns parsed JSON and sends credentials", async () => {
    const fetch = respond(200, { slug: "acme", available: true });
    vi.stubGlobal("fetch", fetch);
    await expect(accountApi.slugAvailable("acme")).resolves.toEqual({ slug: "acme", available: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/orgs/slug-available?slug=acme");
    expect(init.credentials).toBe("include");
  });

  it("puts org calls under /api/orgs/:slug and sends JSON bodies", async () => {
    const fetch = respond(200, { reply: "hi" });
    vi.stubGlobal("fetch", fetch);
    await orgApi("acme co").chat("hello");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/orgs/acme%20co/chat");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ text: "hello" }));
  });

  it("turns error bodies into ApiError", async () => {
    vi.stubGlobal("fetch", respond(403, { error: "verify_email", message: "confirm first" }));
    const err = await orgApi("acme")
      .overview()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, error: "verify_email", message: "confirm first" });
  });

  it("reports 401 from /api/me without redirecting", async () => {
    vi.stubGlobal("fetch", respond(401, { error: "unauthorized" }));
    await expect(accountApi.me()).rejects.toMatchObject({ status: 401 });
  });

  it("reports network failures as status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("failed to fetch");
      }),
    );
    await expect(accountApi.platform()).rejects.toMatchObject({ status: 0, error: "network" });
  });

  it("builds sign-in links that come back", () => {
    expect(signinUrl("/acme/team")).toBe("/signin?next=%2Facme%2Fteam");
    expect(signinUrl("/")).toBe("/signin");
  });
});
