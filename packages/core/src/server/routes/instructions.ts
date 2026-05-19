import { Hono } from "hono";
import type { Instruction } from "../../instructions/types.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/require-admin.js";

export interface InstructionRoutesOpts {
  config: ConfigStore;
  logger: AppLogger;
}

export function createInstructionRoutes(opts: InstructionRoutesOpts): Hono<{ Variables: AuthVariables }> {
  const { config, logger } = opts;
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/org", requireAdmin(), async (c) => {
    const raw = await config.get("org.instructions");
    const instructions: Instruction[] = raw ? (JSON.parse(raw) as Instruction[]) : [];
    return c.json({ instructions });
  });

  app.put("/org", requireAdmin(), async (c) => {
    const body = await c.req.json<{ instructions: Instruction[] }>();
    if (!Array.isArray(body.instructions)) {
      return c.json({ error: "instructions must be an array" }, 400);
    }
    await config.set("org.instructions", body.instructions);
    logger.info({ by: c.get("user").id }, "org instructions updated");
    return c.json({ ok: true });
  });

  app.get("/me", async (c) => {
    const user = c.get("user");
    const raw = await config.get(`user.${user.id}.instructions`);
    const instructions: Instruction[] = raw ? (JSON.parse(raw) as Instruction[]) : [];
    return c.json({ instructions });
  });

  app.put("/me", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ instructions: Instruction[] }>();
    if (!Array.isArray(body.instructions)) {
      return c.json({ error: "instructions must be an array" }, 400);
    }
    await config.set(`user.${user.id}.instructions`, body.instructions);
    logger.info({ userId: user.id }, "user instructions updated");
    return c.json({ ok: true });
  });

  return app;
}
