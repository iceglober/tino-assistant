import { Hono } from "hono";
import type { AuthVariables } from "../auth.js";

export interface SetupStatus {
  /** Slack bot + app tokens are set. */
  slack: boolean;
  /** The selected model provider has everything it needs. */
  model: boolean;
  /** Per-user Slack connect is possible (Slack OAuth client configured). */
  slackConnect: boolean;
  /** Per-user Google connect is possible (Google OAuth client configured). */
  googleConnect: boolean;
  /** The knowledge base is running. */
  kb: boolean;
  /** Setup keys the deployment provides via env vars (names only). */
  fromEnvironment: string[];
}

/**
 * GET /api/status — what's configured, as booleans, for any signed-in user.
 * The SPA uses it to route admins to Setup and to tell members what they can
 * connect, without handing members the config (which holds every secret).
 */
export function createStatusRoutes(opts: { status: () => Promise<SetupStatus> }): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.get("/", async (c) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    return c.json(await opts.status());
  });
  return app;
}
