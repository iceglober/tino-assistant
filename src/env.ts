import { z } from 'zod';

const EnvSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_APP_TOKEN: z.string().min(1),
  ALLOWED_SLACK_USER_ID: z.string().min(1),
  AWS_REGION: z.string().min(1),
  BEDROCK_MODEL_ID: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().min(1),
  AWS_PROFILE: z.string().optional(),
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
