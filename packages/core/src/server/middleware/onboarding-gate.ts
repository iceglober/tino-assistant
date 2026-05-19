import type { MiddlewareHandler } from "hono";
import type { AuthVariables } from "./auth.js";

const BYPASS_PREFIXES = ["/onboarding", "/api/onboarding", "/api/auth", "/api/health", "/assets"];

export function onboardingGate(opts?: { enabled?: boolean }): MiddlewareHandler<{ Variables: AuthVariables & { privacySetupCompletedAt?: number | null } }> {
  const enabled = opts?.enabled ?? true;

  return async (c, next) => {
    if (!enabled) return next();

    for (const prefix of BYPASS_PREFIXES) {
      if (c.req.path.startsWith(prefix)) return next();
    }

    const completedAt = c.get("privacySetupCompletedAt" as any);
    if (completedAt != null) return next();

    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "onboarding_required" }, 403);
    }

    return c.redirect("/onboarding");
  };
}
