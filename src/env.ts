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
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${issues}\n\nSee .env.example for required variables.`);
  }
  return result.data;
}
