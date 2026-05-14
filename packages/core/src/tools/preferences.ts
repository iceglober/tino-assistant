import { tool } from 'ai';
import { z } from 'zod';
import type { PreferencesStore } from '../persistence/preferences.js';

// ---------------------------------------------------------------------------
// set_preference
// ---------------------------------------------------------------------------

const setInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .describe(
      'Preference key, e.g. "timezone", "summary_style", "default_branch"',
    ),
  value: z
    .string()
    .min(1)
    .max(1000)
    .describe('Preference value'),
});

export function setPreferenceTool(store: PreferencesStore, userId: string) {
  return tool({
    description:
      'Save a preference for the current user. ' +
      'Use for timezone, formatting preferences, default settings, etc. ' +
      'Examples: key="timezone" value="America/Chicago", key="summary_style" value="bullet points".',
    inputSchema: setInputSchema,
    execute: async ({ key, value }) => {
      await store.set(userId, key, value);
      return { saved: true, key, value };
    },
  });
}

// ---------------------------------------------------------------------------
// get_preferences (plural — returns all at once)
// ---------------------------------------------------------------------------

const getInputSchema = z.object({});

export function getPreferencesTool(store: PreferencesStore, userId: string) {
  return tool({
    description:
      'Get all saved preferences for the current user. ' +
      'Check this before making assumptions about timezone, formatting, etc. ' +
      'Returns an array of { key, value } pairs.',
    inputSchema: getInputSchema,
    execute: async () => {
      const prefs = await store.list(userId);
      return { preferences: prefs, count: prefs.length };
    },
  });
}
