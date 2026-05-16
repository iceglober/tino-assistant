import { describe, expect, it, vi } from "vitest";
import type { PreferencesStore } from "../../src/persistence/preferences.js";
import { getPreferencesTool, setPreferenceTool } from "../../src/tools/preferences.js";

// ---------------------------------------------------------------------------
// Mock store factory
// ---------------------------------------------------------------------------

const makeStore = (overrides: Partial<PreferencesStore> = {}): PreferencesStore => ({
  get: vi.fn().mockReturnValue(null),
  set: vi.fn(),
  list: vi.fn().mockReturnValue([]),
  delete: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// set_preference tests
// ---------------------------------------------------------------------------

describe("setPreferenceTool", () => {
  // 1. set_preference → store.set called with correct args
  it("calls store.set with userId, key, and value", async () => {
    const store = makeStore();
    const tool = setPreferenceTool(store, "U1");

    // The AI SDK tool wraps execute — call it directly
    const result = await tool.execute({ key: "timezone", value: "America/Chicago" }, {} as never);

    expect(store.set).toHaveBeenCalledOnce();
    expect(store.set).toHaveBeenCalledWith("U1", "timezone", "America/Chicago");
    expect(result).toMatchObject({ saved: true, key: "timezone", value: "America/Chicago" });
  });
});

// ---------------------------------------------------------------------------
// get_preferences tests
// ---------------------------------------------------------------------------

describe("getPreferencesTool", () => {
  // 2. get_preferences → returns all preferences
  it("returns all preferences from store.list", async () => {
    const prefs = [
      { key: "summary_style", value: "bullet points" },
      { key: "timezone", value: "UTC" },
    ];
    const store = makeStore({ list: vi.fn().mockReturnValue(prefs) });
    const tool = getPreferencesTool(store, "U1");

    const result = await tool.execute({}, {} as never);

    expect(store.list).toHaveBeenCalledOnce();
    expect(store.list).toHaveBeenCalledWith("U1");
    expect(result).toMatchObject({ preferences: prefs, count: 2 });
  });
});
