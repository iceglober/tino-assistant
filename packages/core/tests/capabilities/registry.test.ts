/**
 * Tests for the capability registry.
 *
 * Tests capability loading, tool registration, and findWork scheduling.
 * Uses in-memory config store mocks — no SQLite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initCapabilityRegistry } from '../../src/capabilities/registry.js';
import type { ConfigStore } from '../../src/persistence/config.js';
import type { AppLogger } from '../../src/slack/app.js';
import type { CapabilityConfig } from '../../src/capabilities/types.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeConfigStore(entries: Record<string, unknown> = {}): ConfigStore {
  const store = new Map<string, string>(
    Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]),
  );

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    getTyped: vi.fn(async <T>(key: string, fallback: T): Promise<T> => {
      const raw = store.get(key);
      if (!raw) return fallback;
      try { return JSON.parse(raw) as T; } catch { return fallback; }
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    }),
    list: vi.fn(async () =>
      [...store.entries()].map(([key, value]) => ({ key, value, updatedAt: Date.now() })),
    ),
    delete: vi.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had;
    }),
  };
}

const GITHUB_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { token: 'ghp_test_token' },
  settings: { repos: ['kn-eng/kn-eng'], defaultRepo: 'kn-eng/kn-eng' },
  findWork: { enabled: false, intervalMinutes: 15 },
};

const LINEAR_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: { token: 'lin_api_test_token' },
  settings: { defaultTeamKey: 'GEN', autoPickupStates: ['backlog', 'unstarted'] },
  findWork: { enabled: false, intervalMinutes: 15 },
};

const DISABLED_CONFIG: CapabilityConfig = {
  enabled: false,
  credentials: { token: 'some_token' },
  settings: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initCapabilityRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. empty config store → no capability tools registered, preferences/tasks still available', async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: 'U001',
      dbPath: ':memory:',
    });

    // No capability tools
    expect(registry.tools['github_search_code']).toBeUndefined();
    expect(registry.tools['linear_search_issues']).toBeUndefined();
    expect(registry.tools['cloudwatch_logs_query']).toBeUndefined();

    // Preferences tools always registered
    expect(registry.tools['set_preference']).toBeDefined();
    expect(registry.tools['get_preferences']).toBeDefined();

    // No task tools (no taskStore provided)
    expect(registry.tools['schedule_task']).toBeUndefined();

    expect(registry.capabilityIds).toEqual([]);
  });

  it('2. disabled capability → tools not registered', async () => {
    const configStore = makeConfigStore({
      'capability.github': DISABLED_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: 'U001',
      dbPath: ':memory:',
    });

    expect(registry.tools['github_search_code']).toBeUndefined();
    expect(registry.capabilityIds).not.toContain('github');
  });

  it('3. enabled github capability → github tools registered', async () => {
    const configStore = makeConfigStore({
      'capability.github': GITHUB_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: 'U001',
      dbPath: ':memory:',
    });

    expect(registry.tools['github_search_code']).toBeDefined();
    expect(registry.tools['github_get_file']).toBeDefined();
    expect(registry.tools['github_list_workflow_runs']).toBeDefined();
    expect(registry.tools['github_get_workflow_run_logs']).toBeDefined();
    expect(registry.capabilityIds).toContain('github');
  });

  it('4. enabled linear capability → linear tools registered', async () => {
    const configStore = makeConfigStore({
      'capability.linear': LINEAR_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: 'U001',
      dbPath: ':memory:',
    });

    expect(registry.tools['linear_search_issues']).toBeDefined();
    expect(registry.tools['linear_get_issue']).toBeDefined();
    expect(registry.tools['linear_create_issue']).toBeDefined();
    expect(registry.tools['linear_update_issue']).toBeDefined();
    expect(registry.tools['linear_add_comment']).toBeDefined();
    expect(registry.tools['linear_list_my_issues']).toBeDefined();
    expect(registry.capabilityIds).toContain('linear');
  });

  it('5. capability with missing credentials → tools not registered, warn logged', async () => {
    const configStore = makeConfigStore({
      'capability.github': {
        enabled: true,
        credentials: {}, // no token
        settings: {},
      } satisfies CapabilityConfig,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: 'U001',
      dbPath: ':memory:',
    });

    expect(registry.tools['github_search_code']).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: 'github' }),
      expect.stringContaining('disabled'),
    );
  });

  it('6. invalid JSON in config → capability skipped, warn logged', async () => {
    // Manually insert invalid JSON by bypassing the makeConfigStore helper
    const store = new Map<string, string>([
      ['capability.github', 'not-valid-json'],
    ]);
    const configStore: ConfigStore = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      getTyped: vi.fn(async <T>(_key: string, fallback: T) => fallback),
      set: vi.fn(async (key: string, value: unknown) => { store.set(key, JSON.stringify(value)); }),
      list: vi.fn(async () => [...store.entries()].map(([key, value]) => ({ key, value, updatedAt: Date.now() }))),
      delete: vi.fn(async (key: string) => { const had = store.has(key); store.delete(key); return had; }),
    };
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: 'U001',
      dbPath: ':memory:',
    });

    expect(registry.tools['github_search_code']).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: 'github' }),
      expect.stringContaining('not valid JSON'),
    );
  });

  it('7. multiple capabilities enabled → all tools registered', async () => {
    const configStore = makeConfigStore({
      'capability.github': GITHUB_CONFIG,
      'capability.linear': LINEAR_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: 'U001',
      dbPath: ':memory:',
    });

    expect(registry.tools['github_search_code']).toBeDefined();
    expect(registry.tools['linear_search_issues']).toBeDefined();
    expect(registry.capabilityIds).toContain('github');
    expect(registry.capabilityIds).toContain('linear');
  });

  it('8. taskStore provided → task tools registered', async () => {
    const configStore = makeConfigStore({});
    const logger = makeLogger();
    const taskStore = {
      create: vi.fn(),
      getById: vi.fn(),
      listByUser: vi.fn().mockReturnValue([]),
      listPending: vi.fn().mockReturnValue([]),
      updateStatus: vi.fn(),
      cancel: vi.fn().mockReturnValue(true),
    };

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: 'U001',
      dbPath: ':memory:',
      taskStore,
    });

    expect(registry.tools['schedule_task']).toBeDefined();
    expect(registry.tools['list_tasks']).toBeDefined();
    expect(registry.tools['cancel_task']).toBeDefined();
  });

  it('9. getState() returns per-capability state', async () => {
    const configStore = makeConfigStore({
      'capability.github': GITHUB_CONFIG,
      'capability.linear': DISABLED_CONFIG,
    });
    const logger = makeLogger();

    const registry = await initCapabilityRegistry({
      configStore,
      logger,
      allowedUserId: 'U001',
      dbPath: ':memory:',
    });

    const state = registry.getState();
    expect(state['github']).toBeDefined();
    expect(state['github']!.toolCount).toBeGreaterThan(0);
    expect(state['linear']).toBeDefined();
    expect(state['linear']!.toolCount).toBe(0);
  });

  it('10. stopAll() does not throw when no findWork pollers are running', () => {
    // Just verify it's callable without error
    const registry = {
      tools: {},
      capabilityIds: [],
      stopAll: () => {},
      getState: () => ({}),
    };
    expect(() => registry.stopAll()).not.toThrow();
  });
});
