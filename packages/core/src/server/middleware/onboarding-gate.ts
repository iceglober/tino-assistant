import type { MiddlewareHandler } from "hono";
import type { PrivacyConfigStore } from "../../privacy/config-store.js";
import type { AuthVariables } from "./auth.js";

const BYPASS_PREFIXES = ["/onboarding", "/api/onboarding", "/api/auth", "/api/health", "/assets"];

export function onboardingGate(opts: {
  enabled?: boolean;
  privacyConfigStore?: PrivacyConfigStore;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  const enabled = opts.enabled ?? true;

  return async (c, next) => {
    if (!enabled || !opts.privacyConfigStore) return next();

    for (const prefix of BYPASS_PREFIXES) {
      if (c.req.path.startsWith(prefix)) return next();
    }

    const user = c.get("user");
    if (!user) return next();

    const config = await opts.privacyConfigStore.get(user.id);
    if (config != null) return next();

    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "onboarding_required" }, 403);
    }

    return c.redirect("/onboarding");
  };
}
