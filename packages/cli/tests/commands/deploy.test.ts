/**
 * Wave 3 (v2.2) — § 3.4 CLI smoke test for `tino deploy`.
 *
 * Covers the missing-config path: when `tino.deploy.json` does not exist
 * in cwd, the handler must call `displayError(...)` and then
 * `process.exit(1)` instead of attempting a deploy. That's the only path
 * we exercise — `executeDeploy` itself talks to AWS and is not part of
 * this smoke test (it's covered separately).
 *
 * Mocks:
 *   - `../utils/display.js` so we can assert `displayError` was called
 *     with the right message.
 *   - `./deploy-executor.js` so a stray import doesn't pull in the AWS
 *     SDK at load time.
 *   - `process.exit` is replaced with a `vi.spyOn` impl that records the
 *     code and throws — without the throw, the handler would continue
 *     past the existsSync check and try to JSON.parse a non-existent
 *     file. The throw mirrors the real exit's "stop the world" effect.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/display.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/display.js")>("../../src/utils/display.js");
  return {
    ...actual,
    displayError: vi.fn(),
  };
});

vi.mock("../../src/commands/deploy-executor.js", () => ({
  executeDeploy: vi.fn().mockResolvedValue(undefined),
}));

import { deploy } from "../../src/commands/deploy.js";
import { displayError } from "../../src/utils/display.js";

describe("tino deploy — missing tino.deploy.json", () => {
  let tmp: string;
  let originalCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "tino-deploy-test-"));
    originalCwd = process.cwd();
    process.chdir(tmp);
    // Throwing from the spy short-circuits the handler so it doesn't
    // continue past the existsSync check (real process.exit never returns).
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__test_exit__ ${code ?? 0}`);
    }) as never);
    vi.mocked(displayError).mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
    exitSpy.mockRestore();
  });

  it("calls displayError + process.exit(1) when tino.deploy.json is missing", async () => {
    const cmd = deploy as unknown as { handler: (args: Record<string, never>) => Promise<unknown> };

    // Handler throws because our spy throws — we want to assert *what*
    // happened before the exit, not the exit itself.
    await expect(cmd.handler({})).rejects.toThrow(/__test_exit__ 1/);

    expect(displayError).toHaveBeenCalledTimes(1);
    expect(displayError).toHaveBeenCalledWith(expect.stringContaining("tino.deploy.json"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("tino deploy — command shape", () => {
  it("exports a cmd-ts command with the expected metadata", () => {
    const meta = deploy as unknown as { name: string; description: string };
    expect(meta.name).toBe("deploy");
    expect(meta.description).toMatch(/Deploy tino/);
  });
});
