import { Database } from 'bun:sqlite';

/**
 * Simple key-value preference store backed by SQLite.
 *
 * Uses the same database file as conversation history (pass the same dbPath).
 * New table: preferences (user_id, key, value, updated_at).
 *
 * Schema is created on first use (CREATE TABLE IF NOT EXISTS).
 * No migrations — blow the file away if schema changes.
 */
export interface PreferencesStore {
  get(userId: string, key: string): Promise<string | null>;
  set(userId: string, key: string, value: string): Promise<void>;
  list(userId: string): Promise<Array<{ key: string; value: string }>>;
  delete(userId: string, key: string): Promise<void>;
}

export function createPreferencesStore({ dbPath }: { dbPath: string }): PreferencesStore {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS preferences (
      user_id    TEXT    NOT NULL,
      key        TEXT    NOT NULL,
      value      TEXT    NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    )
  `);

  const stmtGet = db.query(
    'SELECT value FROM preferences WHERE user_id = ? AND key = ?',
  );

  const stmtUpsert = db.query(
    `INSERT INTO preferences (user_id, key, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET
       value      = excluded.value,
       updated_at = excluded.updated_at`,
  );

  const stmtList = db.query(
    'SELECT key, value FROM preferences WHERE user_id = ? ORDER BY key',
  );

  const stmtDelete = db.query(
    'DELETE FROM preferences WHERE user_id = ? AND key = ?',
  );

  return {
    get(userId: string, key: string): Promise<string | null> {
      const row = stmtGet.get(userId, key) as { value: string } | null;
      return Promise.resolve(row?.value ?? null);
    },

    set(userId: string, key: string, value: string): Promise<void> {
      stmtUpsert.run(userId, key, value, Date.now());
      return Promise.resolve();
    },

    list(userId: string): Promise<Array<{ key: string; value: string }>> {
      return Promise.resolve(stmtList.all(userId) as Array<{ key: string; value: string }>);
    },

    delete(userId: string, key: string): Promise<void> {
      stmtDelete.run(userId, key);
      return Promise.resolve();
    },
  };
}
