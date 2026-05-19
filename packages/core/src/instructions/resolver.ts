import type { Instruction, InstructionLevel, ResolvedInstructions } from "./types.js";

const LEVEL_ORDER: InstructionLevel[] = ["base", "org", "cap-type", "cap-instance", "user"];

export function resolveInstructions(instructions: Instruction[]): ResolvedInstructions {
  const permissions = { write: true, delete: true, crossContextShare: true };
  const conflicts: ResolvedInstructions["conflicts"] = [];
  const behaviorChunks: ResolvedInstructions["behaviorChunks"] = [];

  const sorted = [...instructions].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
  );

  // Detect same-level permission conflicts at cap-instance level
  const byLevel = new Map<InstructionLevel, Instruction[]>();
  for (const inst of sorted) {
    const arr = byLevel.get(inst.level) ?? [];
    arr.push(inst);
    byLevel.set(inst.level, arr);
  }

  for (const [level, group] of byLevel) {
    if (level !== "cap-instance" || group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        for (const field of ["write", "delete", "crossContextShare"] as const) {
          const aVal = a.permissions?.[field];
          const bVal = b.permissions?.[field];
          if (aVal !== undefined && bVal !== undefined && aVal !== bVal) {
            conflicts.push({ a, b, field });
          }
        }
      }
    }
  }

  // Most-restrictive-wins: any false overrides
  for (const inst of sorted) {
    if (!inst.permissions) continue;
    for (const field of ["write", "delete", "crossContextShare"] as const) {
      if (inst.permissions[field] === false) {
        permissions[field] = false;
      }
    }
  }

  // Behavior: ordered by level, later-overrides-earlier (implicit via append order)
  for (const inst of sorted) {
    if (inst.text) {
      behaviorChunks.push({ source: inst.source, text: inst.text });
    }
  }

  return { permissions, behaviorChunks, conflicts };
}
