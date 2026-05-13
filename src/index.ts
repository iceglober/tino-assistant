import 'dotenv/config';
import { loadEnv } from './env.js';
import { createLogger } from './logging/logger.js';
import { createSlackApp, type DmHandler } from './slack/app.js';
import { createBedrockModel } from './agent/bedrock.js';
import { createSqliteHistoryStore } from './persistence/sqlite.js';
import { createHistoryStore } from './agent/history.js';
import { runAgent } from './agent/run.js';
import { buildTools } from './tools/index.js';
import { createTaskStore } from './persistence/tasks.js';
import { createConfigStore } from './persistence/config.js';
import { startScheduler } from './scheduler/index.js';
import { createProactiveDm } from './slack/proactive.js';
import { startConsole } from './console/server.js';

const env = loadEnv();
const logger = createLogger(env);
const model = createBedrockModel(env);
const dbPath = env.DB_PATH ?? './tino.db';
const history = createSqliteHistoryStore({ dbPath, cap: 40 });
const taskStore = createTaskStore({ dbPath });
const configStore = createConfigStore({ dbPath });
logger.info({ dbPath }, 'persistence: sqlite');
const tools = await buildTools(env, logger, taskStore, configStore);

// 9g: Log tool-definition token count estimate at startup.
// Rough estimate: count characters in all tool descriptions + schema JSON,
// then divide by 4 (average chars per token). This is a heuristic, not exact.
const toolTokenEstimate = Math.ceil(
  Object.values(tools)
    .map(t => {
      const desc = (t as { description?: string }).description ?? '';
      const schema = JSON.stringify((t as { inputSchema?: unknown }).inputSchema ?? {});
      return desc.length + schema.length;
    })
    .reduce((a, b) => a + b, 0) / 4,
);
logger.info({ toolCount: Object.keys(tools).length, estimatedTokens: toolTokenEstimate }, 'tool definitions loaded');

const handler: DmHandler = async (userId, text) => {
  return runAgent({ model, history, logger, tools, userId, text });
};

const app = createSlackApp(env, handler, logger, history);

await app.start();
logger.info({ nodeVersion: process.version, pid: process.pid }, 'tino starting (slack connected)');

// Proactive DM — resolve owner's DM channel after app is started
const postDm = await createProactiveDm(app, env.ALLOWED_SLACK_USER_ID, logger);

// Config console — localhost only, port 3001
const consoleServer = startConsole(configStore, logger, tools);

// Scheduler — runs every 60s, executes pending tasks through the agent loop
const stopScheduler = startScheduler({
  taskStore,
  logger,
  runTask: async (task) => {
    // Run the task through the agent loop with a fresh in-memory history.
    // Tasks are independent: the description must be self-contained.
    // Fresh history avoids stale-context bugs from hours/days-old conversations.
    const taskHistory = createHistoryStore({ cap: 40 });
    const taskPrompt = [
      'You are executing a scheduled task. Your response will be posted directly to the owner\'s Slack DM — you do not need a tool to send it.',
      'Do not explain that you are a bot or that you cannot send messages. Just produce the content the task asks for.',
      '',
      `Task: ${task.description}`,
    ].join('\n');
    return runAgent({
      model,
      history: taskHistory,
      logger,
      tools,
      userId: task.userId,
      text: taskPrompt,
    });
  },
  postResult: postDm,
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'tino stopping');
  stopScheduler();
  consoleServer.close();
  try {
    await app.stop();
  } catch (err) {
    logger.error({ err }, 'error stopping slack app');
  }
  process.exit(0);
};

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
