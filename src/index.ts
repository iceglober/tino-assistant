import 'dotenv/config';
import { loadEnv } from './env.js';
import { createLogger } from './logging/logger.js';
import { createSlackApp, type DmHandler } from './slack/app.js';
import { createBedrockModel } from './agent/bedrock.js';
import { createSqliteHistoryStore } from './persistence/sqlite.js';
import { runAgent } from './agent/run.js';
import { buildTools } from './tools/index.js';

const env = loadEnv();
const logger = createLogger(env);
const model = createBedrockModel(env);
const dbPath = env.DB_PATH ?? './tino.db';
const history = createSqliteHistoryStore({ dbPath, cap: 40 });
logger.info({ dbPath }, 'history store: sqlite');
const tools = buildTools(env, logger);

const handler: DmHandler = async (userId, text) => {
  return runAgent({ model, history, logger, tools, userId, text });
};

const app = createSlackApp(env, handler, logger, history);

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'tino stopping');
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
logger.info({ nodeVersion: process.version, pid: process.pid }, 'tino starting (slack connected)');
