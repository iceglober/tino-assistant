import 'dotenv/config';
import pino from 'pino';
import { loadEnv } from './env.js';
import { createSlackApp, type DmHandler } from './slack/app.js';
import { createBedrockModel } from './agent/bedrock.js';
import { createHistoryStore } from './agent/history.js';
import { runAgent } from './agent/run.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: process.env['NODE_ENV'] === 'production'
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true } },
});

const env = loadEnv();
const model = createBedrockModel(env);
const history = createHistoryStore({ cap: 40 });

const handler: DmHandler = async (userId, text) => {
  return runAgent({ model, history, logger, userId, text });
};

const app = createSlackApp(env, handler, logger);

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
