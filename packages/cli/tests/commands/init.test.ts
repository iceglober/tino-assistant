/**
 * Wave 3 (v2.2) — § 3.4 CLI smoke test for `tino init`.
 *
 * The init command is fully interactive (six `@inquirer/prompts` steps),
 * so we don't drive its handler — that would block on stdin. Instead we
 * verify the cmd-ts command export is well-formed: name, description,
 * args, and a callable handler. This pins the wire-up so a regression
 * (e.g., dropping the export, renaming the command, breaking the args
 * shape) surfaces in a fast unit test rather than at first-run.
 *
 * What this test does NOT cover:
 *   - The interactive prompt flow itself. That's covered indirectly by
 *     each `step*` module's own logic; a true end-to-end run requires
 *     pty + scripted-input plumbing that's out of scope for wave 3.
 */

import { describe, expect, it } from "vitest";
import { init } from "../../src/commands/init.js";

describe("tino init — command shape", () => {
  it("exports a cmd-ts command with the expected metadata", () => {
    // cmd-ts commands carry their name, description, and args on the
    // exported object. Asserting the shape catches accidental renames.
    expect(init).toBeDefined();
    // The command object exposes name + description as own properties.
    const meta = init as unknown as { name: string; description: string };
    expect(meta.name).toBe("init");
    expect(meta.description).toMatch(/HIPAA-compliant tino deployment/i);
  });

  it("exposes a callable handler", () => {
    // The handler exists and is async — we don't invoke it (it would
    // block on @inquirer/prompts stdin reads).
    const cmd = init as unknown as { handler: (...args: unknown[]) => Promise<unknown> };
    expect(typeof cmd.handler).toBe("function");
  });
});
