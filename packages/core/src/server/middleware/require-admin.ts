import type { MiddlewareHandler } from "hono";
import type { AuthVariables } from "./auth.js";

export function requireAdmin(): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user || user.role !== "admin") {
      return c.json({ error: "forbidden", message: "admin role required" }, 403);
    }
    await next();
  };
}
