export type InstructionLevel = "base" | "org" | "cap-type" | "cap-instance" | "user";

export interface Instruction {
  level: InstructionLevel;
  source: string;
  text?: string;
  permissions?: Partial<{
    write: boolean;
    delete: boolean;
    crossContextShare: boolean;
  }>;
}

export interface ResolvedInstructions {
  permissions: { write: boolean; delete: boolean; crossContextShare: boolean };
  behaviorChunks: Array<{ source: string; text: string }>;
  conflicts: Array<{ a: Instruction; b: Instruction; field: string }>;
}
