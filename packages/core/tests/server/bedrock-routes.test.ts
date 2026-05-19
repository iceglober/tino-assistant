/**
 * Wave 3 (v2.2) — § 3.1 server route tests for POST /api/bedrock/validate.
 *
 * The route validates a Bedrock model id by delegating to
 * `validateBedrockModel`, which would normally hit AWS Bedrock. We mock
 * that module so the test stays pure: no AWS credentials, no network.
 *
 * The route's responsibility is request-shape validation (modelId
 * required, body must be JSON) and pass-through of the validation
 * result. We exercise both error and happy paths.
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBedrockRoutes } from "../../src/server/routes/bedrock.js";
import { fakeAdmin, noopLogger } from "./_helpers.js";

vi.mock("../../src/agent/bedrock.js", () => ({
  validateBedrockModel: vi.fn(),
}));

// Re-import after vi.mock so the test sees the mocked symbol.
import { validateBedrockModel } from "../../src/agent/bedrock.js";

function mountBedrock(opts: Parameters<typeof createBedrockRoutes>[0]): Hono {
  const app = new Hono();
  app.use("*", fakeAdmin());
  app.route("/api/bedrock", createBedrockRoutes(opts));
  return app;
}

describe("POST /api/bedrock/validate", () => {
  beforeEach(() => {
    vi.mocked(validateBedrockModel).mockReset();
  });

  it("returns { ok: true } when validation succeeds", async () => {
    vi.mocked(validateBedrockModel).mockResolvedValue({ ok: true });
    const app = mountBedrock({ logger: noopLogger() });

    const res = await app.request("/api/bedrock/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: "claude-3-5-sonnet" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Second arg is `region` from process.env.AWS_REGION (may be undefined in CI).
    expect(validateBedrockModel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(validateBedrockModel).mock.calls[0]?.[0]).toBe("claude-3-5-sonnet");
  });

  it("returns { ok: false, error } when validation fails", async () => {
    vi.mocked(validateBedrockModel).mockResolvedValue({ ok: false, error: "no such model" });
    const app = mountBedrock({ logger: noopLogger() });

    const res = await app.request("/api/bedrock/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: "garbage" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "no such model" });
  });

  it("returns 400 when modelId is missing or empty", async () => {
    const app = mountBedrock({ logger: noopLogger() });

    const res = await app.request("/api/bedrock/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region: "us-east-1" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/modelId/);
    // Validation is not even attempted when the request shape is wrong.
    expect(validateBedrockModel).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const app = mountBedrock({ logger: noopLogger() });

    const res = await app.request("/api/bedrock/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/JSON/);
    expect(validateBedrockModel).not.toHaveBeenCalled();
  });
});
