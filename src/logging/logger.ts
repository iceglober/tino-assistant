import pino from 'pino';
import type { Env } from '../env.js';

/**
 * Create the application logger with PHI-safe redaction.
 *
 * Redacted paths: any log field whose key matches these names will have its
 * value replaced with '[Redacted]' in the output. This prevents tool output
 * bodies (which may contain calendar events, email snippets, code content,
 * or CloudWatch query results) from leaking into terminal logs or log files.
 *
 * What IS logged per tool call: { toolName, durationMs, status, inputShape }.
 * What is NOT logged: the actual content/output/body/snippet returned by the tool.
 */
export function createLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'output',
        'body',
        'content',
        'snippet',
        'messages',
        'messages[*].content',
        'authorization',
        'cookie',
        'refresh_token',
        'access_token',
      ],
      censor: '[Redacted]',
    },
    transport:
      process.env['NODE_ENV'] === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true } },
  });
}
