import { Hono } from "hono";
import { validateBedrockModel } from "../../agent/bedrock.js";
import type { AppLogger } from "../../slack/app.js";

/**
 * /api/bedrock — Bedrock-related operations.
 *
 * Routes:
 *   POST /api/bedrock/validate  → { modelId, region? } → { ok, error? }
 *
 * The console calls this before saving `bedrock.modelId` so a typo or an
 * unavailable model surfaces as a clear UI error instead of a runtime crash
 * on the first agent message.
 */
export function createBedrockRoutes(opts: { logger: AppLogger }): Hono {
  const app = new Hono();
  const { logger } = opts;

  app.post("/validate", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Request body must be valid JSON" }, 400);
    }
    if (!body || typeof body !== "object") {
      return c.json({ ok: false, error: "Body must be an object with a `modelId` string" }, 400);
    }
    const obj = body as Record<string, unknown>;
    const modelId = typeof obj.modelId === "string" ? (obj.modelId as string).trim() : "";
    if (!modelId) {
      return c.json({ ok: false, error: "modelId is required" }, 400);
    }
    const region = typeof obj.region === "string" && obj.region ? (obj.region as string) : process.env.AWS_REGION;

    const result = await validateBedrockModel(modelId, region);
    if (!result.ok) {
      logger.warn({ modelId, err: result.error }, "bedrock model validation failed");
    }
    return c.json(result);
  });

  return app;
}
