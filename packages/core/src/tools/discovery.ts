import { tool } from "ai";
import { z } from "zod";
import type { DiscoveryResult } from "../discovery/types.js";
import type { ConfigStore } from "../persistence/config.js";

const updateSchema = z.object({
  field: z
    .enum([
      "roleSummary",
      "inferredTitle",
      "inferredDepartment",
      "orgRelationships",
      "responsibilities",
      "communicationStyle",
      "workPatterns",
      "painPoints",
    ])
    .describe("Which top-level field to update"),
  value: z.string().describe("JSON-encoded new value for the field. Must match the field's schema."),
});

export function updateDiscoveryTool(configStore: ConfigStore, userId: string) {
  return tool({
    description:
      "Update a field in the user's discovery profile (role, org relationships, responsibilities, etc.). " +
      "Use when the user shares new information about their role, team, or work patterns that should persist. " +
      "Read the current profile first via your system prompt context, then patch only the changed field. " +
      "The value must be valid JSON matching the field's type.",
    inputSchema: updateSchema,
    execute: async ({ field, value }) => {
      const key = `user.${userId}.discovery_result`;
      const raw = await configStore.get(key);
      let current: DiscoveryResult;
      if (raw) {
        try {
          current = JSON.parse(raw) as DiscoveryResult;
        } catch {
          return { error: "corrupt_discovery", message: "Current discovery data is corrupt. Run a full re-discovery from the console." };
        }
      } else {
        return { error: "no_discovery", message: "No discovery profile exists yet. The user should run discovery from the console first." };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return { error: "invalid_json", message: "The value is not valid JSON." };
      }

      (current as unknown as Record<string, unknown>)[field] = parsed;
      current.analyzedAt = Date.now();
      await configStore.set(key, JSON.stringify(current));

      return { updated: true, field };
    },
  });
}
