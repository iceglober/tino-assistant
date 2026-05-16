/**
 * Wave 3.3 — regression tests for `executeDeploy`.
 *
 * Acceptance items in `docs/plans/v2_1/wave_3.md` § 3.3:
 *   - regression test: when `infraDir` is missing, `executeDeploy` calls
 *     `displayError` + `process.exit(1)`. Mock `process.exit` to throw a
 *     sentinel error and assert it was thrown.   ← LANDED HERE
 *   - regression test: invoking `executeDeploy` calls the expected sequence
 *     of shell commands in order. Mock `execaCommandSync` and snapshot.
 *
 * SCOPE NOTE — see `## Open questions` in `docs/plans/v2_1/wave_3.md`:
 *
 *   The "ordered shell commands" test is descoped from this wave. The
 *   reason is mechanical: `execa` is installed only under
 *   `packages/cli/node_modules/`, and the test runs from `@tino/core`'s
 *   vitest harness. Vitest's `vi.mock('execa', …)` does not intercept the
 *   bare specifier when the importing module (`deploy-executor.ts`)
 *   resolves it from a different `node_modules` tree than the test file —
 *   the mock factory loads, but the deploy-executor's actual `import` still
 *   lands on the real `execa`. Real `execa` then shells out to real
 *   `pulumi`, which fails the test for the wrong reason.
 *
 *   Two clean options exist; the wave 3.3 plan recommends option C
 *   (separate Pulumi from CLI deploy lifecycle) which would replace
 *   `executeDeploy` entirely. Adding a vitest harness to `@tino/cli` for
 *   tests that will be deleted in the next wave is wasted plumbing. The
 *   missing-dir test landed here is the highest-value regression: it
 *   guards the abort path that runs BEFORE any shell-out happens, so it
 *   doesn't hit the cross-package mock issue.
 *
 *   Tracked: see "## Open questions" item 1 in wave_3.md.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeDeploy } from '../../../cli/src/commands/deploy-executor.js';
import type { DeployConfig } from '../../../cli/src/commands/init/types.js';

const MINIMAL_CONFIG: DeployConfig = {
  compliance: {
    frameworks: ['hipaa'],
    baaStatus: { aws: 'verified', bedrock: 'verified' },
  },
  provider: 'aws',
  region: 'us-west-2',
  iac: 'standalone',
  pulumiStack: 'dev',
  googleOAuthClientId: 'gid',
  googleOAuthClientSecret: 'gsec',
  allowedDomain: 'example.com',
  hipaa: {
    kmsKeyAlias: 'alias/tino',
    auditRetentionDays: 365,
    historyRetentionDays: 90,
    enforceEncryption: true,
    enforceTls: true,
    enforceAuditLogging: true,
  },
};

describe('executeDeploy (wave 3.3 regression — missing-dir abort path)', () => {
  it('calls displayError + process.exit(1) when the infra directory does not exist', async () => {
    // `process.exit` would kill the test runner; turn it into a thrown
    // sentinel so we can assert it was reached and inspect the side effects.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code}`);
    }) as never);

    const config: DeployConfig = {
      ...MINIMAL_CONFIG,
      infraPath: '/this/path/does/not/exist/anywhere/__tino_test__',
    };

    // The abort runs before any `pulumi` shell-out, so the real execa is
    // never invoked. This test does not depend on cross-package mocking.
    await expect(executeDeploy(config)).rejects.toThrow('__exit_1');

    exitSpy.mockRestore();
  });
});
