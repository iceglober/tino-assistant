import { z } from 'zod';

/**
 * Bootstrap-only environment schema.
 *
 * Philosophy: Only the minimum required to start the process lives here.
 * - Slack credentials are required — without them, the bot cannot start.
 * - Persistence config is required to know where to store data.
 * - Everything else (GitHub token, Linear token, Google OAuth, Slack user
 *   token) lives in the capability configs stored in the config table.
 *   Use the web console at localhost:3001 to manage capability credentials.
 *
 * On first startup, if the old env vars (GITHUB_TOKEN, LINEAR_DEVELOPER_TOKEN,
 * etc.) are still set, they are auto-migrated to capability configs and can
 * then be removed from .env.
 *
 * AWS_REGION is intentionally optional — the AWS SDK's default credential
 * chain resolves region from ~/.aws/config, AWS_DEFAULT_REGION, SSO configs,
 * or IMDS. Setting it here would force duplication for users whose profile
 * already has it.
 */
const EnvSchema = z.object({
  // Required: the Slack bot cannot start without these.
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_APP_TOKEN: z.string().min(1),
  ALLOWED_SLACK_USER_ID: z.string().min(1),

  // Optional: AWS config for Bedrock (model inference).
  AWS_REGION: z.string().min(1).optional(),
  AWS_PROFILE: z.string().optional(),
  BEDROCK_MODEL_ID: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Optional: path to the SQLite database file for conversation history.
  // Default applied at consumption time: './tino.db'.
  DB_PATH: z.string().min(1).optional(),

  // Persistence adapter selection. Default: 'sqlite' (local dev).
  // Set to 'dynamodb' in production (requires DYNAMODB_TABLE_NAME).
  PERSISTENCE_ADAPTER: z.enum(['sqlite', 'dynamodb']).optional(),

  // DynamoDB table name. Required when PERSISTENCE_ADAPTER=dynamodb.
  DYNAMODB_TABLE_NAME: z.string().min(1).optional(),

  // DynamoDB endpoint override. Set to http://localhost:8000 for DynamoDB Local.
  // When set, the table is auto-created if it doesn't exist (zero-setup local dev).
  // When unset, the SDK connects to AWS (table must already exist via CDK).
  DYNAMODB_ENDPOINT: z.string().url().optional(),

  // ── Legacy migration vars (optional) ──────────────────────────────────────
  // These are read during the one-time migration from env vars to capability
  // configs. After migration, they can be removed from .env.
  // They are kept here so loadEnv() doesn't throw on first startup.
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
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

export function loadEnv(): Env {
  const result = EnvSchema.safeParse(stripEmpty(process.env));
  if (!result.success) {
    const issues = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${issues}\n\nSee .env.example for required variables.`);
  }
  return result.data;
}
