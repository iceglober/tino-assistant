import { tool } from 'ai';
import { z } from 'zod';
import type { TaskStore } from '../persistence/tasks.js';

// ---------------------------------------------------------------------------
// schedule_task
// ---------------------------------------------------------------------------

const scheduleInputSchema = z.object({
  description: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "What tino should do when the task fires. Be specific — this is the prompt tino will receive. " +
      "Example: 'Write prep notes for the cross-org standup at 10am using calendar events and recent emails with attendees'.",
    ),
  scheduledAtIso: z
    .string()
    .min(1)
    .describe(
      "ISO-8601 datetime for when to execute. Use the owner's timezone from preferences if known. " +
      "Example: '2026-05-13T09:00:00-05:00'.",
    ),
});

export function scheduleTaskTool(taskStore: TaskStore, userId: string) {
  return tool({
    description:
      'Schedule a task for tino to execute at a future time. ' +
      'The description should be a complete, self-contained prompt — when the task fires, tino runs it with fresh context (no conversation history from now). ' +
      'Be specific: include all context needed to complete the task without referring back to this conversation.',
    inputSchema: scheduleInputSchema,
    execute: async ({ description, scheduledAtIso }) => {
      const ms = new Date(scheduledAtIso).getTime();
      if (isNaN(ms)) {
        return { error: 'invalid_date', message: `Could not parse scheduledAtIso: ${scheduledAtIso}` };
      }
      const scheduledAtEpochSec = Math.floor(ms / 1000);
      const task = taskStore.create(userId, description, scheduledAtEpochSec);
      return {
        taskId: task.id,
        description: task.description,
        scheduledAt: new Date(task.scheduledAt * 1000).toISOString(),
        status: task.status,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// list_tasks
// ---------------------------------------------------------------------------

const listInputSchema = z.object({
  status: z
    .enum(['pending', 'running', 'completed', 'failed', 'cancelled'])
    .optional()
    .describe('Filter by status. Omit to see all tasks.'),
});

export function listTasksTool(taskStore: TaskStore, userId: string) {
  return tool({
    description:
      'List scheduled tasks for the current user. ' +
      'Returns tasks sorted by scheduled time. ' +
      'Use status filter to narrow results: "pending" shows upcoming tasks, "completed" shows finished ones.',
    inputSchema: listInputSchema,
    execute: async ({ status }) => {
      const tasks = taskStore.listByUser(userId, status);
      return {
        tasks: tasks.map(t => ({
          taskId: t.id,
          description: t.description,
          scheduledAt: new Date(t.scheduledAt * 1000).toISOString(),
          status: t.status,
          result: t.result,
        })),
        count: tasks.length,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// cancel_task
// ---------------------------------------------------------------------------

const cancelInputSchema = z.object({
  taskId: z
    .string()
    .min(1)
    .describe('Task ID to cancel (from list_tasks or schedule_task results)'),
});

export function cancelTaskTool(taskStore: TaskStore) {
  return tool({
    description:
      'Cancel a pending task before it fires. ' +
      'Only pending tasks can be cancelled — completed, failed, or already-cancelled tasks cannot be changed.',
    inputSchema: cancelInputSchema,
    execute: async ({ taskId }) => {
      const cancelled = taskStore.cancel(taskId);
      if (!cancelled) {
        return { error: 'not_found_or_not_pending' };
      }
      return { cancelled: true };
    },
  });
}
