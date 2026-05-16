import { describe, expect, it, vi } from "vitest";
import type { Task, TaskStore } from "../../src/persistence/tasks.js";
import { cancelTaskTool, listTasksTool, scheduleTaskTool } from "../../src/tools/tasks.js";

// ---------------------------------------------------------------------------
// Mock store factory
// ---------------------------------------------------------------------------

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-uuid-1",
  userId: "U1",
  description: "do something useful",
  scheduledAt: 1747000000,
  status: "pending",
  result: null,
  createdAt: 1746990000,
  updatedAt: 1746990000,
  ...overrides,
});

const makeStore = (overrides: Partial<TaskStore> = {}): TaskStore => ({
  create: vi.fn().mockReturnValue(makeTask()),
  getById: vi.fn().mockReturnValue(null),
  listByUser: vi.fn().mockReturnValue([]),
  listPending: vi.fn().mockReturnValue([]),
  updateStatus: vi.fn(),
  cancel: vi.fn().mockReturnValue(true),
  ...overrides,
});

// ---------------------------------------------------------------------------
// schedule_task tests
// ---------------------------------------------------------------------------

describe("scheduleTaskTool", () => {
  // 1. schedule_task → calls taskStore.create with correct args
  it("calls taskStore.create with userId, description, and epoch seconds", async () => {
    const store = makeStore();
    const tool = scheduleTaskTool(store, "U1");

    const result = await tool.execute(
      { description: "prep for standup", scheduledAtIso: "2026-05-13T09:00:00Z" },
      {} as never,
    );

    expect(store.create).toHaveBeenCalledOnce();
    const [calledUserId, calledDesc, calledEpoch] = (store.create as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      number,
    ];
    expect(calledUserId).toBe("U1");
    expect(calledDesc).toBe("prep for standup");
    // 2026-05-13T09:00:00Z = 1747126800 epoch seconds
    expect(calledEpoch).toBe(Math.floor(new Date("2026-05-13T09:00:00Z").getTime() / 1000));

    expect(result).toMatchObject({ taskId: "task-uuid-1", status: "pending" });
  });

  // 2. schedule_task with invalid date → returns error
  it("returns an error object when scheduledAtIso is not a valid date", async () => {
    const store = makeStore();
    const tool = scheduleTaskTool(store, "U1");

    const result = await tool.execute({ description: "do something", scheduledAtIso: "not-a-date" }, {} as never);

    expect(store.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: "invalid_date" });
  });
});

// ---------------------------------------------------------------------------
// list_tasks tests
// ---------------------------------------------------------------------------

describe("listTasksTool", () => {
  // 3. list_tasks → returns tasks from store
  it("returns tasks from taskStore.listByUser", async () => {
    const tasks = [
      makeTask({ id: "task-1", description: "first task" }),
      makeTask({ id: "task-2", description: "second task", status: "completed", result: "done" }),
    ];
    const store = makeStore({ listByUser: vi.fn().mockReturnValue(tasks) });
    const tool = listTasksTool(store, "U1");

    const result = await tool.execute({}, {} as never);

    expect(store.listByUser).toHaveBeenCalledOnce();
    expect(store.listByUser).toHaveBeenCalledWith("U1", undefined);
    expect(result).toMatchObject({ count: 2 });
    expect((result as { tasks: unknown[] }).tasks).toHaveLength(2);
  });

  it("passes status filter to taskStore.listByUser", async () => {
    const store = makeStore({ listByUser: vi.fn().mockReturnValue([]) });
    const tool = listTasksTool(store, "U1");

    await tool.execute({ status: "pending" }, {} as never);

    expect(store.listByUser).toHaveBeenCalledWith("U1", "pending");
  });
});

// ---------------------------------------------------------------------------
// cancel_task tests
// ---------------------------------------------------------------------------

describe("cancelTaskTool", () => {
  // 4. cancel_task → calls taskStore.cancel, returns result
  it("returns { cancelled: true } when taskStore.cancel returns true", async () => {
    const store = makeStore({ cancel: vi.fn().mockReturnValue(true) });
    const tool = cancelTaskTool(store);

    const result = await tool.execute({ taskId: "task-uuid-1" }, {} as never);

    expect(store.cancel).toHaveBeenCalledOnce();
    expect(store.cancel).toHaveBeenCalledWith("task-uuid-1");
    expect(result).toEqual({ cancelled: true });
  });

  it('returns { error: "not_found_or_not_pending" } when taskStore.cancel returns false', async () => {
    const store = makeStore({ cancel: vi.fn().mockReturnValue(false) });
    const tool = cancelTaskTool(store);

    const result = await tool.execute({ taskId: "nonexistent" }, {} as never);

    expect(result).toEqual({ error: "not_found_or_not_pending" });
  });
});
