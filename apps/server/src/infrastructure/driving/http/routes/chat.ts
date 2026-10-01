import { Hono } from "hono";
import type { Assistant } from "@tino/core/ports/inbound";
import type { Logger } from "@tino/core/ports/outbound";
import type { AuthVariables } from "../auth.js";

/**
 * POST /api/chat — message Tino from the browser.
 * Auth-gated; drives the same Assistant port as Slack, keyed to the signed-in
 * user (so it shares that user's tools + conversation history).
 */
export function createChatRoutes(opts: {
  assistant: Assistant;
  logger: Logger;
}): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { assistant, logger } = opts;

  app.post("/", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);

    let body: { text?: string };
    try {
      body = (await c.req.json()) as { text?: string };
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const text = (body.text ?? "").trim();
    if (!text) return c.json({ error: "empty message" }, 400);

    try {
      const reply = await assistant.handleMessage(user.id, text, { kind: "web_chat" });
      return c.json({ reply });
    } catch (err) {
      logger.error({ err: (err as Error).message, userId: user.id }, "chat request failed");
      return c.json(
        { error: "chat_failed", message: "tino couldn't reply — the model returned an error. The details are in the server logs." },
        500,
      );
    }
  });

  return app;
}
