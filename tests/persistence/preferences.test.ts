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
  it('returns null for a key that has never been set', async () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    expect(await store.get('U1', 'timezone')).toBeNull();
  });

  // 2. set then get → returns value
  it('returns the value after set', async () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    await store.set('U1', 'timezone', 'America/Chicago');
    expect(await store.get('U1', 'timezone')).toBe('America/Chicago');
  });

  // 3. set overwrites existing key
  it('overwrites an existing key on second set', async () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    await store.set('U1', 'timezone', 'America/Chicago');
    await store.set('U1', 'timezone', 'America/New_York');
    expect(await store.get('U1', 'timezone')).toBe('America/New_York');
  });

  // 4. list returns all for user, sorted by key
  it('list returns all preferences sorted by key', async () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    await store.set('U1', 'timezone', 'UTC');
    await store.set('U1', 'summary_style', 'bullet points');
    await store.set('U1', 'default_branch', 'main');

    const prefs = await store.list('U1');
    expect(prefs).toHaveLength(3);
    // Sorted by key alphabetically
    expect(prefs[0]).toEqual({ key: 'default_branch', value: 'main' });
    expect(prefs[1]).toEqual({ key: 'summary_style', value: 'bullet points' });
    expect(prefs[2]).toEqual({ key: 'timezone', value: 'UTC' });
  });

  // 5. delete removes key, others remain
  it('delete removes the specified key but leaves others', async () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    await store.set('U1', 'timezone', 'UTC');
    await store.set('U1', 'summary_style', 'prose');

    await store.delete('U1', 'timezone');

    expect(await store.get('U1', 'timezone')).toBeNull();
    expect(await store.get('U1', 'summary_style')).toBe('prose');
    expect(await store.list('U1')).toHaveLength(1);
  });

  // 6. different users are isolated
  it('preferences for different users are isolated', async () => {
    const store = createPreferencesStore({ dbPath: tempDbPath() });
    await store.set('U1', 'timezone', 'America/Chicago');
    await store.set('U2', 'timezone', 'Europe/London');

    expect(await store.get('U1', 'timezone')).toBe('America/Chicago');
    expect(await store.get('U2', 'timezone')).toBe('Europe/London');

    expect(await store.list('U1')).toHaveLength(1);
    expect(await store.list('U2')).toHaveLength(1);
  });
});
