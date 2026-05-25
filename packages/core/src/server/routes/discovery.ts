import type { LanguageModel } from "ai";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { CalendarPort } from "../../discovery/calendar-port.js";
import { runDiscovery } from "../../discovery/service.js";
import type { SlackDiscoveryPort } from "../../discovery/slack-port.js";
import type { DiscoveryStore } from "../../discovery/store.js";
import { createMockDiscoveryResult } from "../../privacy/adapters/mock.js";
import type { EmailPort } from "../../privacy/ports.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

export interface DiscoveryRouteDeps {
  discoveryStore: DiscoveryStore;
  logger: AppLogger;
  email?: EmailPort;
  calendar?: CalendarPort;
  slack?: SlackDiscoveryPort;
  model?: LanguageModel;
  mockMode?: boolean;
}

export function createDiscoveryRoutes(deps: DiscoveryRouteDeps): Hono<{ Variables: AuthVariables }> {
  const { discoveryStore, logger } = deps;
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/result", async (c) => {
    const user = c.get("user");
    const result = await discoveryStore.get(user.id);
    if (!result) return c.json({ result: null });
    return c.json({ result });
  });

  app.post("/run", async (c) => {
    const user = c.get("user");
    logger.info({ userId: user.id }, "discovery run started");

    if (deps.mockMode && !deps.model) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({ phase: "email", pct: 20, message: "Fetching email data..." }),
        });
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({ phase: "calendar", pct: 45, message: "Fetching calendar data..." }),
        });
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({ phase: "analysis", pct: 65, message: "Analyzing patterns..." }),
        });
        const result = createMockDiscoveryResult();
        await discoveryStore.set(user.id, result);
        await stream.writeSSE({ event: "result", data: JSON.stringify(result) });
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({ phase: "done", pct: 100, message: "Discovery complete" }),
        });
      });
    }

    if (!deps.model) {
      return c.json({ error: "discovery unavailable — no LLM model configured" }, 503);
    }

    return streamSSE(c, async (stream) => {
      try {
        const result = await runDiscovery(user.id, {
          model: deps.model!,
          email: deps.email,
          calendar: deps.calendar,
          slack: deps.slack,
          logger,
          onProgress: async (p) => {
            await stream.writeSSE({ event: "progress", data: JSON.stringify(p) });
          },
        });
        await discoveryStore.set(user.id, result);
        await stream.writeSSE({ event: "result", data: JSON.stringify(result) });
      } catch (err) {
        logger.error({ userId: user.id, err: (err as Error).message }, "discovery run failed");
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: (err as Error).message }) });
      }
    });
  });

  return app;
}
