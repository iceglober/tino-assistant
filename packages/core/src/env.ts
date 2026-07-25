import { z } from "zod";

/**
 * Bootstrap-only environment schema.
 *
 * Philosophy: Only the minimum required to start the process lives here.
 * - Persistence config tells the process where to store data.
 * - All credentials (Slack tokens, GitHub PAT, Google OAuth, Linear token,
 *   etc.) live in the DynamoDB config store and are read at startup.
 *   Use the web console at localhost:3001 to manage credentials.
 *
 * On first startup, if the old env vars (SLACK_BOT_TOKEN, GITHUB_TOKEN, etc.)
 * are still set, they are auto-migrated to the config store and can then be
 * removed from .env.
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

  // HTTP port for the console server. Default: 3001. Cloud Run sets PORT.
  PORT: z.coerce.number().int().positive().optional(),

  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  NODE_ENV: z.string().optional(),

  // Master key for AES-256-GCM envelope encryption of per-user credentials
  // (scrypt-derived). In production this comes from Secret Manager.
  // WARNING: Changing this key invalidates all existing encrypted payloads.
  LOCAL_DEV_CRYPTO_KEY: z.string().min(1).optional(),

  // ── Legacy migration vars (optional) ──────────────────────────────────────
  // These are read during the one-time migration from env vars to the config
  // store. After migration, they can be removed from .env.
  // They are kept here so loadEnv() doesn't throw on first startup.
  SLACK_BOT_TOKEN: z.string().min(1).optional(),
  SLACK_APP_TOKEN: z.string().min(1).optional(),
  ALLOWED_SLACK_USER_ID: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_DEFAULT_REPO: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, 'GITHUB_DEFAULT_REPO must be in "owner/repo" format')
    .optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().min(1).optional(),
  SLACK_USER_TOKEN: z.string().min(1).optional(),
  LINEAR_DEVELOPER_TOKEN: z.string().min(1).optional(),
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
