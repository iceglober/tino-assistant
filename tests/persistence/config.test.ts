import { describe, it, expect, afterEach } from 'vitest';
import { createConfigStore } from '../../src/persistence/config.js';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// ─── Temp-file management ─────────────────────────────────────────────────────

const tempFiles: string[] = [];

function tempDbPath(): string {
  const p = path.join(
    os.tmpdir(),
    `tino-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

describe('createConfigStore', () => {
  // 1. get on empty store → null
  it('returns null for a key that has never been set', () => {
    const store = createConfigStore({ dbPath: tempDbPath() });
    expect(store.get('github.repos')).toBeNull();
  });

  // 2. set then get → returns value
  it('returns the raw JSON string after set', () => {
    const store = createConfigStore({ dbPath: tempDbPath() });
    store.set('github.repos', ['kn-eng/kn-eng']);
    const raw = store.get('github.repos');
    expect(raw).toBe(JSON.stringify(['kn-eng/kn-eng']));
  });

  // 3. getTyped with fallback → returns parsed JSON
  it('getTyped returns parsed JSON value when key exists', () => {
    const store = createConfigStore({ dbPath: tempDbPath() });
    store.set('github.repos', ['kn-eng/kn-eng', 'kn-eng/other']);
    const repos = store.getTyped<string[]>('github.repos', []);
    expect(repos).toEqual(['kn-eng/kn-eng', 'kn-eng/other']);
  });

  // 4. getTyped on missing key → returns fallback
  it('getTyped returns fallback when key is missing', () => {
    const store = createConfigStore({ dbPath: tempDbPath() });
    const repos = store.getTyped<string[]>('github.repos', ['default/repo']);
    expect(repos).toEqual(['default/repo']);
  });

  // 5. set overwrites existing
  it('set overwrites an existing key', () => {
    const store = createConfigStore({ dbPath: tempDbPath() });
    store.set('cloudwatch.region', 'us-east-1');
    store.set('cloudwatch.region', 'us-west-2');
    expect(store.get('cloudwatch.region')).toBe(JSON.stringify('us-west-2'));
  });

  // 6. list returns all entries sorted by key
  it('list returns all entries sorted by key', () => {
    const store = createConfigStore({ dbPath: tempDbPath() });
    store.set('github.repos', ['kn-eng/kn-eng']);
    store.set('cloudwatch.region', 'us-east-1');
    store.set('github.default_repo', 'kn-eng/kn-eng');

    const entries = store.list();
    expect(entries).toHaveLength(3);
    expect(entries[0]?.key).toBe('cloudwatch.region');
    expect(entries[1]?.key).toBe('github.default_repo');
    expect(entries[2]?.key).toBe('github.repos');
  });

  // 7. delete removes entry, returns true
  it('delete removes the entry and returns true', () => {
    const store = createConfigStore({ dbPath: tempDbPath() });
    store.set('github.repos', ['kn-eng/kn-eng']);
    const removed = store.delete('github.repos');
    expect(removed).toBe(true);
    expect(store.get('github.repos')).toBeNull();
  });

  // 8. delete on missing key → returns false
  it('delete on a missing key returns false', () => {
    const store = createConfigStore({ dbPath: tempDbPath() });
    const removed = store.delete('nonexistent.key');
    expect(removed).toBe(false);
  });
});
