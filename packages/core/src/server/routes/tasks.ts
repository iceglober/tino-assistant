import { Hono } from "hono";
import type { TaskStore } from "../../persistence/tasks.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

export interface TaskRoutesOpts {
  taskStore: TaskStore;
  logger: AppLogger;
}

export function createTaskRoutes(opts: TaskRoutesOpts): Hono<{ Variables: AuthVariables }> {
  const { taskStore } = opts;
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const user = c.get("user");
    const status = c.req.query("status") ?? undefined;
    const tasks = await taskStore.listByUser(user.id, status);
    return c.json({ tasks });
  });

  app.get("/:id", async (c) => {
    const user = c.get("user");
    const task = await taskStore.getById(c.req.param("id"));
    if (!task || task.userId !== user.id) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task);
  });

  app.post("/:id/cancel", async (c) => {
    const user = c.get("user");
    const task = await taskStore.getById(c.req.param("id"));
    if (!task || task.userId !== user.id) {
      return c.json({ error: "not found" }, 404);
    }
    const cancelled = await taskStore.cancel(task.id);
    if (!cancelled) {
      return c.json({ error: "task is not cancellable (not pending)" }, 409);
    }
    return c.json({ ok: true });
  });

  return app;
}
