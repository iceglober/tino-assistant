import { z } from "zod";

/**
 * Bootstrap-only environment schema: where to store data and how to serve.
 * Everything else (Slack tokens, model keys, Google OAuth client) is set in the
 * console Setup screen and lives in the config store; the few env vars that
 * remain as fallbacks are listed at the bottom.
 */
const EnvSchema = z.object({
  // Persistence adapter selection. Default: 'sqlite' (local dev).
  // Set to 'postgres' in production (requires DATABASE_URL).
  PERSISTENCE_ADAPTER: z.enum(["sqlite", "postgres"]).optional(),

  // Optional: path to the SQLite database file for conversation history.
  // Default applied at consumption time: './tino.db'.
  DB_PATH: z.string().min(1).optional(),

  // Postgres connection string. Required when PERSISTENCE_ADAPTER=postgres.
  // Cloud SQL unix socket: postgresql://tino:PW@/tino?host=/cloudsql/PROJECT:REGION:INSTANCE
  DATABASE_URL: z.string().min(1).optional(),

  // better-auth sqlite file path (sqlite adapter only). Default: /tmp/tino-auth.db.
  AUTH_DB_PATH: z.string().min(1).optional(),

  // HTTP port for the console server. Default: 3001 locally; the Helm chart sets 8080.
  PORT: z.coerce.number().int().positive().optional(),

  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  NODE_ENV: z.string().optional(),

  // Master key for AES-256-GCM envelope encryption of per-user credentials
  // (scrypt-derived). In production this comes from Secret Manager.
  // WARNING: Changing this key invalidates all existing encrypted payloads.
  LOCAL_DEV_CRYPTO_KEY: z.string().min(1).optional(),

  // Fallbacks for config-store values (the config store wins when both are set).
  SLACK_BOT_TOKEN: z.string().min(1).optional(),
  SLACK_APP_TOKEN: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Strip empty strings from the env bag before validation. dotenv parses
 * `FOO=` as `process.env.FOO = ""`, which is neither undefined nor a real
 * value — and `z.string().min(1).optional()` still runs `.min(1)` against
 * empty strings, so they fail "required" validation even though the field
 * is optional. Treating `""` as "field is absent" matches what a human
 * editing .env.example meant when they left the placeholder blank.
 */
function stripEmpty(bag: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(bag)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

export function loadEnv(): Env {
  const result = EnvSchema.safeParse(stripEmpty(process.env));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Environment validation failed:\n${issues}\n\nSee .env.example for required variables.`);
  }
  return result.data;
}
