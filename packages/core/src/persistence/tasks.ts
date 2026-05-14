import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/**
 * SQLite-backed task store for scheduled tasks.
 *
 * Schema: tasks (id, user_id, description, scheduled_at, status, result, created_at, updated_at)
 *
 * Uses better-sqlite3 (synchronous API) — matches the synchronous store pattern
 * used by preferences.ts and sqlite.ts.
 */

export interface Task {
  id: string;
  userId: string;
  description: string;
  scheduledAt: number; // epoch seconds UTC
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskStore {
  create(userId: string, description: string, scheduledAtEpochSec: number): Promise<Task>;
  getById(id: string): Promise<Task | null>;
  listByUser(userId: string, status?: string): Promise<Task[]>;
  listPending(nowEpochSec: number): Promise<Task[]>; // scheduled_at <= now AND status = 'pending'
  updateStatus(id: string, status: Task['status'], result?: string): Promise<void>;
  cancel(id: string): Promise<boolean>; // returns false if task not found or not pending
}

// Row shape returned by better-sqlite3 (snake_case columns)
interface TaskRow {
  id: string;
  user_id: string;
  description: string;
  scheduled_at: number;
  status: string;
  result: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    description: row.description,
    scheduledAt: row.scheduled_at,
    status: row.status as Task['status'],
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTaskStore({ dbPath }: { dbPath: string }): TaskStore {
  const db = new Database(dbPath);

  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    description TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  // Recover tasks that were mid-execution when the process was killed.
  // 'running' status means the scheduler picked them up but never got to
  // mark them 'completed' or 'failed' — the process died in between.
  // Reset them to 'pending' so the next scheduler tick retries them.
  const recovered = db.prepare(
    `UPDATE tasks SET status = 'pending', updated_at = ? WHERE status = 'running'`,
  ).run(Math.floor(Date.now() / 1000));
  if (recovered.changes > 0) {
    // Caller's logger isn't available here, but the count is visible in
    // the returned TaskStore — the scheduler will log when it picks them up.
  }

  const stmtInsert = db.prepare<[string, string, string, number, number, number]>(
    `INSERT INTO tasks (id, user_id, description, scheduled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const stmtGetById = db.prepare<[string], TaskRow>(
    'SELECT * FROM tasks WHERE id = ?',
  );

  const stmtListByUser = db.prepare<[string], TaskRow>(
    'SELECT * FROM tasks WHERE user_id = ? ORDER BY scheduled_at ASC',
  );

  const stmtListByUserAndStatus = db.prepare<[string, string], TaskRow>(
    'SELECT * FROM tasks WHERE user_id = ? AND status = ? ORDER BY scheduled_at ASC',
  );

  const stmtListPending = db.prepare<[number], TaskRow>(
    `SELECT * FROM tasks WHERE scheduled_at <= ? AND status = 'pending' ORDER BY scheduled_at ASC`,
  );

  const stmtUpdateStatus = db.prepare<[string, string | null, number, string]>(
    'UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?',
  );

  const stmtCancel = db.prepare<[number, string]>(
    `UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'`,
  );

  return {
    create(userId: string, description: string, scheduledAtEpochSec: number): Promise<Task> {
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      stmtInsert.run(id, userId, description, scheduledAtEpochSec, now, now);
      return Promise.resolve({
        id,
        userId,
        description,
        scheduledAt: scheduledAtEpochSec,
        status: 'pending',
        result: null,
        createdAt: now,
        updatedAt: now,
      });
    },

    getById(id: string): Promise<Task | null> {
      const row = stmtGetById.get(id);
      return Promise.resolve(row ? rowToTask(row) : null);
    },

    listByUser(userId: string, status?: string): Promise<Task[]> {
      if (status !== undefined) {
        return Promise.resolve(stmtListByUserAndStatus.all(userId, status).map(rowToTask));
      }
      return Promise.resolve(stmtListByUser.all(userId).map(rowToTask));
    },

    listPending(nowEpochSec: number): Promise<Task[]> {
      return Promise.resolve(stmtListPending.all(nowEpochSec).map(rowToTask));
    },

    updateStatus(id: string, status: Task['status'], result?: string): Promise<void> {
      const now = Math.floor(Date.now() / 1000);
      stmtUpdateStatus.run(status, result ?? null, now, id);
      return Promise.resolve();
    },

    cancel(id: string): Promise<boolean> {
      const now = Math.floor(Date.now() / 1000);
      const info = stmtCancel.run(now, id);
      return Promise.resolve(info.changes > 0);
    },
  };
}
