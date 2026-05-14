import 'dotenv/config';
import { loadEnv } from './env.js';
import { createLogger } from './logging/logger.js';
import { createSlackApp, type DmHandler } from './slack/app.js';
import { createBedrockModel } from './agent/bedrock.js';
import { createHistoryStore } from './agent/history.js';
import { runAgent } from './agent/run.js';
import { startScheduler } from './scheduler/index.js';
import { createProactiveDm } from './slack/proactive.js';
import { startConsole } from './console/server.js';
import { createPersistence } from './persistence/factory.js';
import { migrateEnvToCapabilities } from './capabilities/migration.js';
import { initCapabilityRegistry } from './capabilities/registry.js';
import { createMemoryAuditLogger } from './audit/memory.js';

const env = loadEnv();
const logger = createLogger(env);
const model = createBedrockModel(env);
const { history, tasks: taskStore, config: configStore } = await createPersistence(env, logger);

// Audit logger — in-memory for local dev; AWS deployment wires in DynamoDB logger
const auditLogger = createMemoryAuditLogger();

// Run one-time migration from env vars to capability configs (no-op if already done)
await migrateEnvToCapabilities(env, configStore, logger);

// Initialize capability registry — loads capabilities, registers tools, starts findWork pollers
const registry = await initCapabilityRegistry({
  configStore,
  logger,
  allowedUserId: env.ALLOWED_SLACK_USER_ID,
  dbPath: env.DB_PATH,
  taskStore,
  onNewWork: async (summary: string) => {
    // findWork callback — run the agent on the work item and post result to owner
    const taskHistory = createHistoryStore({ cap: 40 });
    const prompt = [
      'You are executing a scheduled task. Your response will be posted directly to the owner\'s Slack DM.',
      'Do not explain that you are a bot. Just produce the content.',
      '',
      summary,
    ].join('\n');

    const result = await runAgent({
      model,
      history: taskHistory,
      logger,
      tools: registry.tools,
      userId: env.ALLOWED_SLACK_USER_ID,
      text: prompt,
      auditLogger,
    });

    await postDm(result);
  },
});

const tools = registry.tools;

// 9g: Log tool-definition token count estimate at startup.
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
  return runAgent({ model, history, logger, tools, userId, text, auditLogger });
};

const app = createSlackApp(env, handler, logger, history, auditLogger);

await app.start();
logger.info({ nodeVersion: process.version, pid: process.pid }, 'tino starting (slack connected)');

// Proactive DM — resolve owner's DM channel after app is started
const postDm = await createProactiveDm(app, env.ALLOWED_SLACK_USER_ID, logger);

// Config console — localhost only, port 3001
const consoleServer = startConsole(configStore, logger, tools, registry, 3001, auditLogger);

// Scheduler — runs every 15s, executes pending tasks through the agent loop
const stopScheduler = startScheduler({
  taskStore,
  logger,
  runTask: async (task) => {
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
      auditLogger,
    });
  },
  postResult: postDm,
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'tino stopping');
  stopScheduler();
  registry.stopAll();
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
