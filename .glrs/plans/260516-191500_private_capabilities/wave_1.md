# wave 1: capability scope split (shape only)

split the `CapabilityModule` interface so each capability declares whether it's `'shared'` (one credential, all users can use it) or `'private'` (per-user credential, only the configuring user can use it). refactor the registry so `sharedTools` are built once at startup and `privateTools` are built lazily per `runAgent` call via a factory. classify each existing capability. **no per-user storage yet** — private capabilities still read from the global `capability.<id>` blob (just like today). this wave is pure refactoring; no user-visible behavior change.

## why this comes second

every later wave depends on the type-system split. wave 2 needs the `scope: 'private'` discriminator to know which capabilities to migrate to per-user storage. wave 3 needs `buildPrivateTools(tinoUserId)` to materialize a per-user toolset at agent dispatch time. without this refactor first, those waves would be stacking conditionals on top of an unsplit type.

doing this BEFORE per-user storage (wave 2) is intentional: ship the structural change in isolation so the diff is easy to review, then layer the storage change on top. trying to ship "scope split + per-user storage + KMS encryption" as one wave is the kind of fat PR that masks regressions.

## constraints

- **zero user-visible behavior change.** the bot owner's experience is identical. the registry exposes a different shape internally; the `tools` reaching `runAgent` cover the same surface.
- **private capabilities still use the global blob in this wave.** `gmail.registerTools` reads `capability.gmail.credentials.refreshToken` from the same global config it reads from today. wave 2 swaps that read for the per-user store.
- **find-work pollers are shared-only by type-system invariant.** declaring `startFindWork` on a `scope: 'private'` module is a TypeScript error.
- **the registry stops exposing a single `tools: ToolSet`.** it exposes `sharedTools: ToolSet` and `buildPrivateTools(tinoUserId)`. callers that today read `registry.tools` change to `{ ...registry.sharedTools, ...await registry.buildPrivateTools(userId) }`.
- **`SYSTEM` user gets shared-only.** when `runAgent` is called with `userId: SYSTEM_USER_ID`, the private-tools factory returns `{}`. find-work pollers (which are shared-only triggers) are unaffected; their resulting agent run uses only shared tools.

## file-level changes

### `packages/core/src/capabilities/types.ts` (MODIFIED)

split the `CapabilityModule` interface into two variants via a discriminated union:

```ts
/** Common fields. */
interface BaseCapability {
  id: string;
  displayName: string;
  fieldSchema?: CapField[];
}

/**
 * Shared capability: one credential for the whole deployment, all users use it.
 * Examples: GitHub, Linear, CloudWatch, Slack public-channel search.
 */
export interface SharedCapability extends BaseCapability {
  scope: 'shared';
  /**
   * Register tools into the shared toolset. Called once at registry init from the
   * global `capability.<id>` blob. The `userId` passed to tool calls at runtime is
   * the requesting user's tino-UUID — the tool can include it in audit context but
   * MUST NOT use it for credential selection (the credential is fixed per deployment).
   */
  registerTools(config: CapabilityConfig, configStore: ConfigStore, logger: AppLogger, tools: ToolSet): Promise<void>;
  /** findWork is shared-by-definition; declared only on shared capabilities. */
  startFindWork?(
    config: CapabilityConfig,
    logger: AppLogger,
    onNewWork: (summary: string) => Promise<void>,
  ): () => void;
}

/**
 * Private capability: per-user credential, only the configuring user can have tino call it.
 * Examples: Gmail, personal Slack xoxp, Calendar.
 *
 * Wave 1 ships only the type-system split; the per-user credential storage layer arrives in wave 2.
 * Until wave 2 lands, `buildToolsForUser` reads from the SAME global `capability.<id>` blob —
 * it's a deliberate transitional state. The function signature already takes a `tinoUserId`
 * so wave 2 can swap the implementation without touching call sites.
 */
export interface PrivateCapability extends BaseCapability {
  scope: 'private';
  /**
   * Build a toolset for one user. Called lazily on every `runAgent` invocation.
   *
   * @param tinoUserId - the requesting user's UUID. In wave 1 this is unused (creds come from
   *                     the global blob); in wave 2 it's the partition key for per-user creds.
   * @param config - in wave 1, the global capability blob; in wave 2, the user's per-user blob.
   * @returns a fresh ToolSet OR `null` if the user has no credentials configured for this capability.
   *          A null return means the capability is "not connected" for this user; the agent's
   *          system prompt will list it as missing rather than as an active capability.
   */
  buildToolsForUser(
    tinoUserId: string,
    config: CapabilityConfig | null,
    configStore: ConfigStore,
    logger: AppLogger,
  ): Promise<ToolSet | null>;
}

export type CapabilityModule = SharedCapability | PrivateCapability;
```

note: `findWork` is intentionally absent from `PrivateCapability`. attempting to add it produces a TypeScript error. this enforces D5 from main.md.

### `packages/core/src/capabilities/registry.ts` (MODIFIED — substantial)

split `loadCapabilityTools` into two paths:

```ts
export interface CapabilityRegistry {
  /** Tools available to all users. Built once at init; mutated in place by reload(). */
  sharedTools: ToolSet;

  /**
   * Build the private tool set for one user. Called from `runAgent` per invocation.
   * Returns ONLY the private tools — caller spreads with `sharedTools`.
   *
   * For `tinoUserId === SYSTEM_USER_ID` returns `{}` (system runs use shared tools only).
   */
  buildPrivateTools(tinoUserId: string): Promise<ToolSet>;

  /** Active capability ids visible in the agent's system prompt for a given user. */
  getActiveCapabilities(tinoUserId: string): Promise<string[]>;

  stopAll(): void;
  getState(): Record<string, CapabilityRuntimeState>;
  reload(): Promise<{ ok: boolean; error?: string }>;
}
```

implementation:
- the init loop walks `ALL_CAPABILITIES` and switches on `cap.scope`:
  - `scope === 'shared'`: read `capability.<id>`, call `registerTools(config, ..., sharedTools)`. start findWork if configured.
  - `scope === 'private'`: do nothing at init time. private tools are deferred to `buildPrivateTools(userId)`.
- `buildPrivateTools(tinoUserId)` walks all private capabilities, reads each one's config from the global blob (wave 1 transitional), calls `buildToolsForUser`. results are merged into one `ToolSet`. capabilities returning `null` are skipped (not connected for this user).
- `getActiveCapabilities(tinoUserId)`: returns the union of (a) all enabled shared capability ids, (b) every private capability id where `buildToolsForUser` returned non-null.
- `reload()`: re-reads shared blobs (mutates `sharedTools` in place); private capabilities are stateless from the registry's perspective (the next `buildPrivateTools` call picks up new config).

### `packages/core/src/capabilities/all.ts` (MODIFIED)

each module gains a `scope` field. classification:

| capability | scope | rationale |
|------------|-------|-----------|
| `github` | shared | repo allowlist applies to whole org; PAT is org-managed |
| `linear` | shared | one workspace, one token, all users see same issues |
| `cloudwatch` | shared | log groups are infrastructure; same data for all users |
| `slack-public-channels` | shared | uses the bot token (`xoxb-`) to search public channels — already-public data |
| `gmail` | private | the canonical private-data-with-per-user-creds case |
| `slack-personal` | private | the `xoxp-` user token; reads private channels and DMs scoped to the user |
| `calendar` | private | personal calendar events |

note: `slack-public-channels` and `slack-personal` are conceptually separate capabilities, but today they both live in `capabilities/slack.ts` (with the bot token doing public-channel reads and a separate `xoxp-` token doing personal reads). wave 1 splits them into two modules: `slack.ts` (shared) keeps the public-channel + DM-handling tools, and `slack-personal.ts` (NEW, private) handles the `xoxp-`-scoped tools. modules can share helpers via a `slack-shared.ts` utility module.

### `packages/core/src/capabilities/{github,linear,cloudwatch,slack}.ts` (MODIFIED)

add `scope: 'shared'` to the module export. `registerTools` signature is unchanged. no other changes.

### `packages/core/src/capabilities/{gmail,calendar}.ts` (MODIFIED)

add `scope: 'private'`. replace `registerTools` with `buildToolsForUser`:

```ts
// before
export const gmailCapability: CapabilityModule = {
  id: 'gmail',
  displayName: 'Gmail',
  async registerTools(config, configStore, logger, tools) {
    if (!config.credentials.refreshToken) throw new Error('missing refreshToken');
    tools.gmail_search = makeGmailSearchTool(config.credentials.refreshToken, ...);
    // ...
  },
};

// after (wave 1 transitional — still reads the global blob)
export const gmailCapability: CapabilityModule = {
  id: 'gmail',
  displayName: 'Gmail',
  scope: 'private',
  async buildToolsForUser(tinoUserId, config, configStore, logger) {
    if (!config?.enabled || !config.credentials.refreshToken) return null;
    return {
      gmail_search: makeGmailSearchTool(config.credentials.refreshToken, ...),
      gmail_read: makeGmailReadTool(config.credentials.refreshToken, ...),
      // ...
    };
  },
};
```

### `packages/core/src/capabilities/slack-personal.ts` (NEW)

extracted from `capabilities/slack.ts`. ships the `xoxp-`-token-scoped tools (`slack_read_dm`, `slack_search_personal`, `slack_read_private_channel`). `scope: 'private'`. `buildToolsForUser` reads `capability.slack-personal.credentials.userToken` from the global blob (wave 1 transitional).

mirror: existing `gmail.ts` for the private-capability shape after the wave-1 edits.

### `packages/core/src/capabilities/all.ts` (MODIFIED)

add `slack-personal` to the array. classify each entry by scope. the array stays sorted by id for stable iteration.

### `packages/core/src/index.ts` (MODIFIED)

four call sites need updating where `tools: registry.tools` is currently passed to `runAgent`. each becomes:

```ts
const userId = task.userId ?? allowedUserId;  // existing logic
const privateTools = await registry.buildPrivateTools(userId);
const tools = { ...registry.sharedTools, ...privateTools };
const activeCapabilities = await registry.getActiveCapabilities(userId);

const result = await runAgent({
  model,
  history,
  logger,
  tools,
  userId,
  text,
  auditLogger,
  activeCapabilities,
});
```

specific call sites: line 84 (find-work callback — uses `SYSTEM_USER_ID`), line ~184 (slack DM handler — uses `allowedUserId`), line ~222 (scheduler tick — uses `task.userId`).

note: in wave 1, every `runAgent` call still effectively dispatches with the bot owner's identity (because the slack DM gate hasn't widened yet). but the plumbing is now per-user, ready for wave 3.

### `packages/core/src/capabilities/migration.ts` (MODIFIED)

`migrateEnvToCapabilities` writes the same global `capability.<id>` blobs as today, but for capabilities now classified as `'private'`, the blob represents "the bot owner's personal credentials." in wave 2 the bot owner's blob is moved to `USER#<botOwnerTinoUserId>#CAP#<capId>`. wave 1 doesn't change the migration; it just adds a comment to migration.ts noting that private-scoped capabilities will move in wave 2.

### `tests/capabilities/registry.test.ts` (MODIFIED)

existing tests use `registry.tools`. update to use `{ ...registry.sharedTools, ...await registry.buildPrivateTools(userId) }`. add new tests:

```
- registry exposes shared tools immediately after init
- registry does NOT include private tools in sharedTools after init
- buildPrivateTools(SYSTEM) returns {}
- buildPrivateTools(<botOwnerId>) includes gmail tools when gmail config present
- buildPrivateTools(<botOwnerId>) returns {} for gmail when config.enabled=false
- buildPrivateTools(<botOwnerId>) returns {} for gmail when refreshToken missing
- getActiveCapabilities(<botOwnerId>) returns shared ids + private ids where creds exist
- getActiveCapabilities(SYSTEM) returns shared ids only
- reload() rebuilds shared tools but doesn't affect private flow
- TypeScript: declaring startFindWork on a scope: 'private' module is a compile error (covered by tsc test)
```

### `tests/capabilities/scope-types.test-d.ts` (NEW)

type-only test file (using `vitest`'s `expectTypeOf` or a plain ts-expect-error). asserts:
- `SharedCapability` allows `startFindWork`
- `PrivateCapability` rejects `startFindWork` (`@ts-expect-error`)
- `CapabilityModule` is the union

### `packages/core/src/agent/run.ts` (MODIFIED — comment only)

update the `RunAgentParams.tools` JSDoc to clarify it's the merged shared+private toolset for the requesting user. no logic change.

## acceptance criteria

```plan-state
- [x] id: a1
  intent: CapabilityModule is a discriminated union of SharedCapability and PrivateCapability. The scope field is the discriminator. The TypeScript compiler enforces that startFindWork can only be declared on shared capabilities.
  tests:
    - tests/capabilities/scope-types.test-d.ts::"SharedCapability allows startFindWork"
    - tests/capabilities/scope-types.test-d.ts::"PrivateCapability rejects startFindWork"
  verify: bun run test tests/capabilities/scope-types.test-d.ts && bunx tsc --noEmit

- [x] id: a2
  intent: The registry exposes sharedTools (built once at init) and buildPrivateTools(userId) (called per agent run). Shared tools never include private-capability tools.
  tests:
    - tests/capabilities/registry.test.ts::"registry exposes shared tools after init"
    - tests/capabilities/registry.test.ts::"registry sharedTools does not include gmail tools"
  verify: bun run test tests/capabilities/registry.test.ts

- [x] id: a3
  intent: buildPrivateTools materializes per-user tools from the configured private capabilities. SYSTEM_USER_ID returns {} (no private tools). Missing or disabled credentials skip cleanly without throwing.
  tests:
    - tests/capabilities/registry.test.ts::"buildPrivateTools(SYSTEM) returns empty"
    - tests/capabilities/registry.test.ts::"buildPrivateTools includes gmail when configured"
    - tests/capabilities/registry.test.ts::"buildPrivateTools skips gmail when disabled"
    - tests/capabilities/registry.test.ts::"buildPrivateTools skips gmail when refreshToken missing"
  verify: bun run test tests/capabilities/registry.test.ts

- [x] id: a4
  intent: getActiveCapabilities returns the right ids for the agent system prompt — shared ids always present, private ids present only when the user has creds.
  tests:
    - tests/capabilities/registry.test.ts::"getActiveCapabilities returns shared plus connected private"
    - tests/capabilities/registry.test.ts::"getActiveCapabilities for SYSTEM returns shared only"
  verify: bun run test tests/capabilities/registry.test.ts

- [x] id: a5
  intent: All existing capabilities are correctly classified. github/linear/cloudwatch/slack are shared; gmail/slack-personal/calendar are private. Slack public-channel search and slack-personal-xoxp tools live in separate modules.
  tests:
    - tests/capabilities/all.test.ts::"all capabilities have a scope field"
    - tests/capabilities/all.test.ts::"private capabilities expose buildToolsForUser"
    - tests/capabilities/all.test.ts::"shared capabilities expose registerTools"
    - tests/capabilities/all.test.ts::"slack-personal is a separate module from slack"
  verify: bun run test tests/capabilities/all.test.ts

- [x] id: a6
  intent: The bot owner's DM behavior is unchanged. Same tools reach runAgent; same agent invocation; same audit log entries.
  tests:
    - tests/integration/wave1-no-regression.test.ts::"bot owner DM dispatches identical toolset as before wave 1"
  verify: bun run test tests/integration/wave1-no-regression.test.ts

- [x] id: a7
  intent: All existing tests continue to pass.
  tests:
    - "*"
  verify: bun run test
```

## test plan

- type-level tests via `*.test-d.ts` and `tsc --noEmit` to confirm the discriminated union enforces shape.
- registry unit tests for `sharedTools`, `buildPrivateTools`, `getActiveCapabilities`. target: 12+ new test cases.
- regression integration test: identical agent dispatch for the bot owner pre- and post-wave-1.
- existing 314+-test suite passes.

## non-goals

- Do NOT add per-user credential storage. capabilities still read from the global blob.
- Do NOT change the slack DM gate.
- Do NOT add KMS envelope encryption.
- Do NOT add a "your capabilities" console page. that's wave 2.
- Do NOT thread tinoUserId through `runAgent`'s `userId` semantics yet — `userId` still receives the bot owner's slack id at every call site (we resolve it to the bot owner's tino-UUID in wave 3 once the slack handler widens).

## rollback story

if wave 1 ships and a critical bug surfaces:

- the change is purely structural; reverting the codebase undoes everything. no data is mutated.
- the `tino_user` and `identity` tables from wave 0 stay untouched.
- the only side effect is that the global `capability.slack-personal` blob may have been written by the wave-1 migration (separating the `xoxp-` token from the bot-token-only `slack` blob). on rollback, the old `capability.slack` blob with the embedded `xoxp-` token is still in place — its presence doesn't break anything.

## open questions

- **`slack-personal` module split** — the current `capabilities/slack.ts` mixes bot-token (shared) and `xoxp-` (private) tools. wave 1 splits them; the executor should verify that `slack.ts`'s find-work and DM-handling code (which uses the bot token) is unaffected by extracting the `xoxp-` tools. flag if there's a tool that uses both tokens (e.g., something that reads with `xoxp-` then writes with `xoxb-`) — that tool needs a deliberate home.
- **type-only tests with vitest** — `*.test-d.ts` is a TypeScript-checking-only test file; vitest can be configured to run them via `tsc --noEmit` rather than the test runner. if the wave-1 executor finds friction with the test setup, `tsc --noEmit` over the source tree is sufficient signal.
