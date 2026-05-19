import type { ConfigStore } from "../persistence/config.js";
import { resolveInstructions } from "./resolver.js";
import type { Instruction, ResolvedInstructions } from "./types.js";

export async function resolveInstructionsForUser(opts: {
  tinoUserId: string;
  configStore: ConfigStore;
}): Promise<ResolvedInstructions> {
  const { tinoUserId, configStore } = opts;
  const all: Instruction[] = [];

  const orgRaw = await configStore.get("org.instructions");
  if (orgRaw) {
    try {
      const orgInstructions = JSON.parse(orgRaw) as Instruction[];
      for (const inst of orgInstructions) {
        all.push({ ...inst, level: inst.level ?? "org" });
      }
    } catch {
      // malformed — skip
    }
  }

  const userRaw = await configStore.get(`user.${tinoUserId}.instructions`);
  if (userRaw) {
    try {
      const userInstructions = JSON.parse(userRaw) as Instruction[];
      for (const inst of userInstructions) {
        all.push({ ...inst, level: inst.level ?? "user" });
      }
    } catch {
      // malformed — skip
    }
  }

  return resolveInstructions(all);
}
