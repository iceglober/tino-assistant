import 'dotenv/config';
import pino from 'pino';
import { loadEnv } from './env.js';
import { createSlackApp, type DmHandler } from './slack/app.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: process.env['NODE_ENV'] === 'production'
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true } },
});

const env = loadEnv();

// Phase 2: the "agent" is just echo. Phase 3 replaces this with runAgent(...).
const echo: DmHandler = async (_userId, text) => text;

const app = createSlackApp(env, echo, logger);

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'ausistant stopping');
  try {
    await app.stop();
  } catch (err) {
    logger.error({ err }, 'error stopping slack app');
  }
  process.exit(0);
};

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

await app.start();
logger.info({ nodeVersion: process.version, pid: process.pid }, 'ausistant starting (slack connected)');
