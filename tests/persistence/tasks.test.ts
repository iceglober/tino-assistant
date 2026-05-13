import { describe, it, expect, afterEach } from 'vitest';
import { createTaskStore } from '../../src/persistence/tasks.js';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// ─── Temp-file management ─────────────────────────────────────────────────────

const tempFiles: string[] = [];

function tempDbPath(): string {
  const p = path.join(
    os.tmpdir(),
    `tino-tasks-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  tempFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tempFiles.splice(0)) {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      try {
        fs.unlinkSync(p + suffix);
      } catch {
        /* ignore */
      }
    }
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createTaskStore', () => {
  // 1. create → returns task with pending status, valid id
  it('create returns a task with pending status and a valid UUID id', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    const task = store.create('U1', 'do something', now + 3600);

    expect(task.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(task.userId).toBe('U1');
    expect(task.description).toBe('do something');
    expect(task.scheduledAt).toBe(now + 3600);
    expect(task.status).toBe('pending');
    expect(task.result).toBeNull();
    expect(task.createdAt).toBeGreaterThan(0);
    expect(task.updatedAt).toBeGreaterThan(0);
  });

  // 2. getById → returns the created task
  it('getById returns the task that was created', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    const created = store.create('U1', 'fetch emails', now + 60);

    const found = store.getById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.description).toBe('fetch emails');
    expect(found!.status).toBe('pending');
  });

  // 3. getById with nonexistent id → null
  it('getById returns null for a nonexistent id', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    expect(store.getById('nonexistent-id')).toBeNull();
  });

  // 4. listByUser → returns tasks for that user only
  it('listByUser returns only tasks for the specified user', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    store.create('U1', 'task for U1', now + 60);
    store.create('U2', 'task for U2', now + 120);

    const u1Tasks = store.listByUser('U1');
    expect(u1Tasks).toHaveLength(1);
    expect(u1Tasks[0]!.userId).toBe('U1');

    const u2Tasks = store.listByUser('U2');
    expect(u2Tasks).toHaveLength(1);
    expect(u2Tasks[0]!.userId).toBe('U2');
  });

  // 5. listByUser with status filter → returns only matching status
  it('listByUser with status filter returns only tasks with that status', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    const t1 = store.create('U1', 'pending task', now + 60);
    const t2 = store.create('U1', 'another pending task', now + 120);
    store.updateStatus(t2.id, 'completed', 'done');

    const pending = store.listByUser('U1', 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(t1.id);

    const completed = store.listByUser('U1', 'completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.id).toBe(t2.id);
  });

  // 6. listPending → returns tasks where scheduled_at <= now AND status = 'pending'
  it('listPending returns tasks scheduled at or before now with pending status', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    const t1 = store.create('U1', 'overdue task', now - 3600);
    const t2 = store.create('U1', 'due now task', now);

    const pending = store.listPending(now);
    const ids = pending.map(t => t.id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2.id);
  });

  // 7. listPending → does NOT return tasks scheduled in the future
  it('listPending does not return tasks scheduled in the future', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    store.create('U1', 'future task', now + 3600);

    const pending = store.listPending(now);
    expect(pending).toHaveLength(0);
  });

  // 8. listPending → does NOT return completed/cancelled/running tasks
  it('listPending does not return tasks with non-pending status', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    const t1 = store.create('U1', 'completed task', now - 100);
    const t2 = store.create('U1', 'cancelled task', now - 100);
    const t3 = store.create('U1', 'running task', now - 100);

    store.updateStatus(t1.id, 'completed', 'done');
    store.updateStatus(t2.id, 'cancelled');
    store.updateStatus(t3.id, 'running');

    const pending = store.listPending(now);
    expect(pending).toHaveLength(0);
  });

  // 9. updateStatus → changes status and result
  it('updateStatus changes the status and result of a task', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    const task = store.create('U1', 'some task', now + 60);

    store.updateStatus(task.id, 'completed', 'task result text');

    const updated = store.getById(task.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.result).toBe('task result text');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(task.updatedAt);
  });

  // 10. cancel → sets status to 'cancelled', returns true
  it('cancel sets status to cancelled and returns true for a pending task', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    const task = store.create('U1', 'task to cancel', now + 3600);

    const result = store.cancel(task.id);
    expect(result).toBe(true);

    const updated = store.getById(task.id);
    expect(updated!.status).toBe('cancelled');
  });

  // 11. cancel on non-pending task → returns false
  it('cancel returns false for a non-pending task', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const now = Math.floor(Date.now() / 1000);
    const task = store.create('U1', 'completed task', now - 60);
    store.updateStatus(task.id, 'completed', 'done');

    const result = store.cancel(task.id);
    expect(result).toBe(false);

    // Status should remain completed
    const updated = store.getById(task.id);
    expect(updated!.status).toBe('completed');
  });

  // 12. cancel on nonexistent task → returns false
  it('cancel returns false for a nonexistent task id', () => {
    const store = createTaskStore({ dbPath: tempDbPath() });
    const result = store.cancel('nonexistent-id');
    expect(result).toBe(false);
  });
});
