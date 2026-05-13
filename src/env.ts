import { z } from 'zod';

/**
 * Environment schema.
 *
 * Philosophy: Slack credentials are required — without them, the bot literally
 * cannot start. Everything else is optional, because the agent should degrade
 * gracefully: a missing GITHUB_TOKEN disables the GitHub tools, it does NOT
 * crash the whole process. Each tool validates its own required fields at
 * construction time (see `src/tools/*`).
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

  // Optional: each tool/provider validates its own fields at construction time.
  AWS_REGION: z.string().min(1).optional(),
  AWS_PROFILE: z.string().optional(),
  BEDROCK_MODEL_ID: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_DEFAULT_REPO: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, 'GITHUB_DEFAULT_REPO must be in "owner/repo" format')
    .optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().min(1).optional(),

  // Optional: Slack user token (xoxp-) for reading channels as the owner.
  // Required for slack_search_messages and slack_read_thread tools.
  // Obtain via Slack OAuth with user scopes: search:read, channels:history, groups:history.
  SLACK_USER_TOKEN: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Optional: path to the SQLite database file for conversation history.
  // Default applied at consumption time: './tino.db'.
  DB_PATH: z.string().min(1).optional(),

  // Persistence adapter selection. Default: 'sqlite' (local dev).
  // Set to 'dynamodb' in production (requires DYNAMODB_TABLE_NAME).
  PERSISTENCE_ADAPTER: z.enum(['sqlite', 'dynamodb']).optional(),

  // DynamoDB table name. Required when PERSISTENCE_ADAPTER=dynamodb.
  DYNAMODB_TABLE_NAME: z.string().min(1).optional(),
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
