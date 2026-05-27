import { tool } from "ai";
import { z } from "zod";
import type { TaskStore } from "../persistence/tasks.js";

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
  intervalMinutes: z
    .number()
    .min(1)
    .max(1440)
    .optional()
    .describe(
      "For recurring tasks: how often to repeat, in minutes. " +
        "Example: 5 means run every 5 minutes. Must also set forHours.",
    ),
  forHours: z
    .number()
    .min(0.1)
    .max(72)
    .optional()
    .describe(
      "For recurring tasks: how long to keep recurring, in hours. " +
        "Example: 3 means repeat for 3 hours then stop. Must also set intervalMinutes.",
    ),
});

export function scheduleTaskTool(taskStore: TaskStore, userId: string) {
  return tool({
    description:
      "Schedule a task for tino to execute at a future time. " +
      "The description should be a complete, self-contained prompt — when the task fires, tino runs it with fresh context (no conversation history from now). " +
      "Be specific: include all context needed to complete the task without referring back to this conversation. " +
      "For recurring tasks, set intervalMinutes and forHours — the task will repeat at that interval until the duration expires or the user cancels.",
    inputSchema: scheduleInputSchema,
    execute: async ({ description, scheduledAtIso, intervalMinutes, forHours }) => {
      const ms = new Date(scheduledAtIso).getTime();
      if (Number.isNaN(ms)) {
        return { error: "invalid_date", message: `Could not parse scheduledAtIso: ${scheduledAtIso}` };
      }
      if ((intervalMinutes && !forHours) || (!intervalMinutes && forHours)) {
        return { error: "invalid_recurring", message: "Both intervalMinutes and forHours must be set for recurring tasks." };
      }
      const scheduledAtEpochSec = Math.floor(ms / 1000);
      const recurring = intervalMinutes && forHours
        ? { intervalSec: Math.round(intervalMinutes * 60), expiresAt: scheduledAtEpochSec + Math.round(forHours * 3600) }
        : undefined;
      const task = await taskStore.create(userId, description, scheduledAtEpochSec, recurring);
      const nowSec = Math.floor(Date.now() / 1000);
      const deltaSec = scheduledAtEpochSec - nowSec;
      return {
        taskId: task.id,
        description: task.description,
        scheduledAt: new Date(task.scheduledAt * 1000).toISOString(),
        scheduledInMinutes: Math.round(deltaSec / 60),
        status: task.status,
        ...(recurring ? {
          recurring: true,
          intervalMinutes: intervalMinutes,
          forHours: forHours,
          expiresAt: new Date(recurring.expiresAt * 1000).toISOString(),
        } : {}),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// list_tasks
// ---------------------------------------------------------------------------

const listInputSchema = z.object({
  status: z
    .enum(["pending", "running", "completed", "failed", "cancelled"])
    .optional()
    .describe("Filter by status. Omit to see all tasks."),
});

export function listTasksTool(taskStore: TaskStore, userId: string) {
  return tool({
    description:
      "List scheduled tasks for the current user. " +
      "Returns tasks sorted by scheduled time. " +
      'Use status filter to narrow results: "pending" shows upcoming tasks, "completed" shows finished ones.',
    inputSchema: listInputSchema,
    execute: async ({ status }) => {
      const tasks = await taskStore.listByUser(userId, status);
      return {
        tasks: tasks.map((t) => ({
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
  taskId: z.string().min(1).describe("Task ID to cancel (from list_tasks or schedule_task results)"),
});

export function cancelTaskTool(taskStore: TaskStore) {
  return tool({
    description:
      "Cancel a pending task before it fires. " +
      "Only pending tasks can be cancelled — completed, failed, or already-cancelled tasks cannot be changed.",
    inputSchema: cancelInputSchema,
    execute: async ({ taskId }) => {
      const cancelled = await taskStore.cancel(taskId);
      if (!cancelled) {
        return { error: "not_found_or_not_pending" };
      }
      return { cancelled: true };
    },
  });
}
