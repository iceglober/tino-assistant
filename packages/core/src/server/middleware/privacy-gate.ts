import type { MiddlewareHandler } from "hono";
import type { PrivacyConfigStore } from "../../privacy/config-store.js";
import type { AuthVariables } from "./auth.js";

const BYPASS_PREFIXES = ["/privacy", "/api/privacy", "/api/auth", "/api/health", "/assets"];

export function privacyGate(opts: {
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

    if (user.role === "admin") return next();

    const config = await opts.privacyConfigStore.get(user.id);
    if (config != null) return next();

    // Only block API calls that require privacy config — no navigation redirects
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "privacy_config_required" }, 403);
    }

    return next();
  };
}
