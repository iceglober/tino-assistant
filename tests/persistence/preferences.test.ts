import { describe, it, expect, afterEach } from 'vitest';
import { createPreferencesStore } from '../../src/persistence/preferences.js';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// ─── Temp-file management ─────────────────────────────────────────────────────

const tempFiles: string[] = [];

function tempDbPath(): string {
  const p = path.join(
    os.tmpdir(),
    `tino-prefs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

describe('createPreferencesStore', () => {
  // 1. get on empty store → null
  it('returns null for a key that has never been set', () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    expect(store.get('U1', 'timezone')).toBeNull();
  });

  // 2. set then get → returns value
  it('returns the value after set', () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    store.set('U1', 'timezone', 'America/Chicago');
    expect(store.get('U1', 'timezone')).toBe('America/Chicago');
  });

  // 3. set overwrites existing key
  it('overwrites an existing key on second set', () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    store.set('U1', 'timezone', 'America/Chicago');
    store.set('U1', 'timezone', 'America/New_York');
    expect(store.get('U1', 'timezone')).toBe('America/New_York');
  });

  // 4. list returns all for user, sorted by key
  it('list returns all preferences sorted by key', () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    store.set('U1', 'timezone', 'UTC');
    store.set('U1', 'summary_style', 'bullet points');
    store.set('U1', 'default_branch', 'main');

    const prefs = store.list('U1');
    expect(prefs).toHaveLength(3);
    // Sorted by key alphabetically
    expect(prefs[0]).toEqual({ key: 'default_branch', value: 'main' });
    expect(prefs[1]).toEqual({ key: 'summary_style', value: 'bullet points' });
    expect(prefs[2]).toEqual({ key: 'timezone', value: 'UTC' });
  });

  // 5. delete removes key, others remain
  it('delete removes the specified key but leaves others', () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    store.set('U1', 'timezone', 'UTC');
    store.set('U1', 'summary_style', 'prose');

    store.delete('U1', 'timezone');

    expect(store.get('U1', 'timezone')).toBeNull();
    expect(store.get('U1', 'summary_style')).toBe('prose');
    expect(store.list('U1')).toHaveLength(1);
  });

  // 6. different users are isolated
  it('preferences for different users are isolated', () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    store.set('U1', 'timezone', 'America/Chicago');
    store.set('U2', 'timezone', 'Europe/London');

    expect(store.get('U1', 'timezone')).toBe('America/Chicago');
    expect(store.get('U2', 'timezone')).toBe('Europe/London');

    expect(store.list('U1')).toHaveLength(1);
    expect(store.list('U2')).toHaveLength(1);
  });
});
