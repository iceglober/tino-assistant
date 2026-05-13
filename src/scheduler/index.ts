import type { TaskStore, Task } from '../persistence/tasks.js';
import type { AppLogger } from '../slack/app.js';

export interface SchedulerDeps {
  taskStore: TaskStore;
  logger: AppLogger;
  runTask: (task: Task) => Promise<string>; // returns the agent's response text
  postResult: (text: string) => Promise<void>; // posts to the owner's DM
  intervalMs?: number; // default 60_000
}

/**
 * Start the scheduler loop. Returns a cleanup function that stops the interval.
 *
 * Every tick:
 * 1. Query taskStore.listPending(nowEpochSec)
 * 2. For each pending task (processed sequentially to avoid overwhelming Bedrock):
 *    a. updateStatus(id, 'running')
 *    b. const result = await runTask(task)
 *    c. updateStatus(id, 'completed', result)
 *    d. await postResult with success message
 *    e. On error: updateStatus(id, 'failed', error.message), postResult with error
 */
export function startScheduler(deps: SchedulerDeps): () => void {
  const { taskStore, logger, runTask, postResult, intervalMs = 60_000 } = deps;

  const tick = async () => {
    const now = Math.floor(Date.now() / 1000);
    const pending = taskStore.listPending(now);

    if (pending.length === 0) {
      logger.debug({ now }, 'scheduler tick: no pending tasks');
    }

    for (const task of pending) {
      logger.info({ taskId: task.id, description: task.description }, 'executing scheduled task');
      taskStore.updateStatus(task.id, 'running');

      try {
        const result = await runTask(task);
        taskStore.updateStatus(task.id, 'completed', result);
        await postResult(`📋 *Scheduled task completed:*\n\n_${task.description}_\n\n${result}`);
        logger.info({ taskId: task.id }, 'scheduled task completed');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        taskStore.updateStatus(task.id, 'failed', msg);
        await postResult(`⚠️ *Scheduled task failed:*\n\n_${task.description}_\n\nError: ${msg}`);
        logger.error({ taskId: task.id, err: msg }, 'scheduled task failed');
      }
    }
  };

  // Run immediately on start (catch any overdue tasks), then on interval
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);

  return () => clearInterval(handle);
}
