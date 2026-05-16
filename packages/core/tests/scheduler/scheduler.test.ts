import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskStore } from "../../src/persistence/tasks.js";
import { startScheduler } from "../../src/scheduler/index.js";
import type { AppLogger } from "../../src/slack/app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-uuid-1",
  userId: "U1",
  description: "do something useful",
  scheduledAt: 1000,
  status: "pending",
  result: null,
  createdAt: 900,
  updatedAt: 900,
  ...overrides,
});

const makeStore = (overrides: Partial<TaskStore> = {}): TaskStore => ({
  create: vi.fn(),
  getById: vi.fn().mockReturnValue(null),
  listByUser: vi.fn().mockReturnValue([]),
  listPending: vi.fn().mockReturnValue([]),
  updateStatus: vi.fn(),
  cancel: vi.fn().mockReturnValue(true),
  ...overrides,
});

const makeLogger = (): AppLogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

/**
 * Flush the initial tick that fires via `void tick()` in startScheduler.
 * We advance fake timers by 0ms (flushes microtasks queued by the initial
 * synchronous call) then yield to the event loop.
 */
async function flushInitialTick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. tick processes pending tasks and calls runTask + postResult
  it("processes pending tasks: calls runTask and postResult, updates status to completed", async () => {
    const task = makeTask();
    const store = makeStore({
      listPending: vi.fn().mockReturnValue([task]),
    });
    const runTask = vi.fn().mockResolvedValue("task output text");
    const postResult = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const stop = startScheduler({ taskStore: store, logger, runTask, postResult, intervalMs: 60_000 });

    await flushInitialTick();

    expect(store.listPending).toHaveBeenCalled();
    expect(store.updateStatus).toHaveBeenCalledWith(task.id, "running");
    expect(runTask).toHaveBeenCalledWith(task);
    expect(store.updateStatus).toHaveBeenCalledWith(task.id, "completed", "task output text");
    expect(postResult).toHaveBeenCalledOnce();
    expect((postResult as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("Scheduled task completed");
    expect((postResult as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("task output text");

    stop();
  });

  // 2. tick skips tasks scheduled in the future
  it("does not process tasks scheduled in the future (listPending returns empty)", async () => {
    const store = makeStore({
      listPending: vi.fn().mockReturnValue([]), // no pending tasks
    });
    const runTask = vi.fn();
    const postResult = vi.fn();
    const logger = makeLogger();

    const stop = startScheduler({ taskStore: store, logger, runTask, postResult, intervalMs: 60_000 });

    await flushInitialTick();

    expect(runTask).not.toHaveBeenCalled();
    expect(postResult).not.toHaveBeenCalled();

    stop();
  });

  // 3. failed runTask → task status set to 'failed', error posted
  it("sets task to failed and posts error message when runTask throws", async () => {
    const task = makeTask();
    const store = makeStore({
      listPending: vi.fn().mockReturnValue([task]),
    });
    const runTask = vi.fn().mockRejectedValue(new Error("bedrock timeout"));
    const postResult = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const stop = startScheduler({ taskStore: store, logger, runTask, postResult, intervalMs: 60_000 });

    await flushInitialTick();

    expect(store.updateStatus).toHaveBeenCalledWith(task.id, "running");
    expect(store.updateStatus).toHaveBeenCalledWith(task.id, "failed", "bedrock timeout");
    expect(postResult).toHaveBeenCalledOnce();
    expect((postResult as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("Scheduled task failed");
    expect((postResult as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("bedrock timeout");

    stop();
  });

  // 4. no pending tasks → tick is a no-op
  it("is a no-op when there are no pending tasks", async () => {
    const store = makeStore({
      listPending: vi.fn().mockReturnValue([]),
    });
    const runTask = vi.fn();
    const postResult = vi.fn();
    const logger = makeLogger();

    const stop = startScheduler({ taskStore: store, logger, runTask, postResult, intervalMs: 60_000 });

    await flushInitialTick();

    expect(store.updateStatus).not.toHaveBeenCalled();
    expect(runTask).not.toHaveBeenCalled();
    expect(postResult).not.toHaveBeenCalled();

    stop();
  });

  // 5. interval fires again after intervalMs
  it("fires the tick again after the interval elapses", async () => {
    const store = makeStore({
      listPending: vi.fn().mockReturnValue([]),
    });
    const runTask = vi.fn();
    const postResult = vi.fn();
    const logger = makeLogger();

    const stop = startScheduler({
      taskStore: store,
      logger,
      runTask,
      postResult,
      intervalMs: 1000,
    });

    // Initial tick
    await flushInitialTick();
    const callsAfterFirst = (store.listPending as ReturnType<typeof vi.fn>).mock.calls.length;

    // Advance by one interval and flush microtasks
    await vi.advanceTimersByTimeAsync(1000);

    const callsAfterSecond = (store.listPending as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);

    stop();
  });

  // 6. stop() clears the interval
  it("stop() prevents further ticks", async () => {
    const store = makeStore({
      listPending: vi.fn().mockReturnValue([]),
    });
    const logger = makeLogger();

    const stop = startScheduler({
      taskStore: store,
      logger,
      runTask: vi.fn(),
      postResult: vi.fn(),
      intervalMs: 1000,
    });

    await flushInitialTick();
    const callsBeforeStop = (store.listPending as ReturnType<typeof vi.fn>).mock.calls.length;

    stop();

    await vi.advanceTimersByTimeAsync(5000);

    // No additional calls after stop
    expect((store.listPending as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeStop);
  });
});
