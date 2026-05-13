import 'dotenv/config';
import { loadEnv } from './env.js';
import { createLogger } from './logging/logger.js';
import { createSlackApp, type DmHandler } from './slack/app.js';
import { createBedrockModel } from './agent/bedrock.js';
import { createHistoryStore } from './agent/history.js';
import { runAgent } from './agent/run.js';
import { buildTools } from './tools/index.js';
import { startScheduler } from './scheduler/index.js';
import { startLinearPoller } from './scheduler/linear-poller.js';
import { createProactiveDm } from './slack/proactive.js';
import { startConsole } from './console/server.js';
import { createPersistence } from './persistence/factory.js';
import { createLinearClient } from './tools/linear/client.js';

const env = loadEnv();
const logger = createLogger(env);
const model = createBedrockModel(env);
const { history, tasks: taskStore, config: configStore } = await createPersistence(env, logger);
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
    });
  },
  postResult: postDm,
});

// Linear poller — checks for issues assigned to tino every 15 min
let stopLinearPoller: (() => void) | undefined;
try {
  const linearClient = createLinearClient(env);
  stopLinearPoller = startLinearPoller({
    linearClient,
    logger,
    onNewIssue: async (issue) => {
      logger.info({ issueId: issue.id, identifier: issue.identifier }, 'linear: picked up assigned issue');

      const taskHistory = createHistoryStore({ cap: 40 });
      const prompt = [
        'You are executing a scheduled task. Your response will be posted directly to the owner\'s Slack DM.',
        'Do not explain that you are a bot. Just produce the content.',
        '',
        `A Linear issue has been assigned to you:`,
        `- Identifier: ${issue.identifier}`,
        `- Title: ${issue.title}`,
        `- URL: ${issue.url}`,
        issue.description ? `- Description: ${issue.description}` : '',
        '',
        'Investigate this issue using your available tools (code search, Slack, email, etc.).',
        'Post your findings as a comment on the issue using linear_add_comment.',
        'Then update the issue status to "In Progress" using linear_update_issue.',
        'Finally, summarize what you found for the owner.',
      ].filter(Boolean).join('\n');

      const result = await runAgent({
        model,
        history: taskHistory,
        logger,
        tools,
        userId: env.ALLOWED_SLACK_USER_ID,
        text: prompt,
      });

      await postDm(`🔖 *picked up ${issue.identifier}:* ${issue.title}\n\n${result}\n\n${issue.url}`);
    },
  });
  logger.info('linear poller started (checking every 15 min)');
} catch (err) {
  logger.warn({ err: (err as Error).message }, 'linear poller disabled');
}

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'tino stopping');
  stopScheduler();
  stopLinearPoller?.();
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
