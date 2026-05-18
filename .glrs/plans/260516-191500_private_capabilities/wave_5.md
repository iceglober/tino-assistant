# wave 5: instruction precedence + per-instance isolation + multi-tenant foundation

implement the instruction-precedence rules from `docs/plans/product.md:401-424` (most-restrictive-wins for permissions, later-overrides-earlier for behavior). add per-capability-instance "canShareWith" labels so two instances of the same capability type (e.g., "internal Linear" and "customer Linear") can be isolated from each other within an agent run. extract the partition-key prefix into a single constant so a future managed-multi-tenant offering can swap `""` for `TENANT#<tenantId>#` in one place. **this wave is purely additive and can be deferred indefinitely** — waves 0-4 already deliver the privacy boundary; wave 5 adds the next-layer features.

## why this comes last (and is optional)

waves 0-4 are required to ship multi-user tino. wave 5 is "ready for the next thing." it's the wave that:
- formalizes how org-level instructions interact with user-level preferences when they conflict
- enables one tino deployment to safely connect to multiple customer-isolated linear/jira workspaces
- lays the multi-tenant groundwork without actually shipping multi-tenant

skipping wave 5 doesn't break anything. the instruction-precedence rules are nice-to-have today (admin and user instructions don't conflict in practice for a 3-person team). per-instance isolation is a feature for users who connect to multiple instances of the same capability type — most won't. the multi-tenant constant is a one-line change today; doing it now just means it's already done when the managed offering ships.

## constraints

- **the precedence rules from product.md:401-424 are the spec.** both the order (base → org → cap-type → cap-instance → user) and the conflict-resolution strategies (most-restrictive-wins for permissions, later-overrides-earlier for behavior) are taken as given.
- **per-instance isolation is per-instance, NOT per-field.** product.md:430-446 explicitly defers per-field to a future v3. wave 5 ships per-instance only.
- **the multi-tenant constant is a no-op today.** `TENANT_PREFIX = ""` (empty string) means partition keys stay as `USER#...` etc. a future plan changes the constant to `TENANT#<tenantId>#`. wave 5 just makes it a single point of edit.
- **instruction-precedence applies to the system prompt.** today's prompt is built in `packages/core/src/agent/systemPrompt.ts` from a few inputs. wave 5 extends `buildSystemPrompt` to take an `instructions: ResolvedInstructions` arg and to assemble the prompt according to the precedence rules.

## file-level changes

### `packages/core/src/instructions/types.ts` (NEW)

```ts
export type InstructionLevel = 'base' | 'org' | 'cap-type' | 'cap-instance' | 'user';

/** A single instruction. May contain permission flags AND/OR behavioral text. */
export interface Instruction {
  level: InstructionLevel;
  /** identifier for conflict-flagging (e.g. 'jira-revenuewell' for cap-instance) */
  source: string;
  /** behavioral text — appended to the prompt; later-overrides-earlier */
  text?: string;
  /** permission flags — most-restrictive-wins (false beats true) */
  permissions?: Partial<{
    write: boolean;
    delete: boolean;
    crossContextShare: boolean;
  }>;
}

/** Resolved instructions, ready to consume. */
export interface ResolvedInstructions {
  /** Final permission set after most-restrictive-wins. */
  permissions: { write: boolean; delete: boolean; crossContextShare: boolean };
  /** Ordered behavioral text from each level, prefixed with source. */
  behaviorChunks: Array<{ source: string; text: string }>;
  /** Any conflicts the resolver detected (e.g., two instances disagree on permissions). */
  conflicts: Array<{ a: Instruction; b: Instruction; field: string }>;
}
```

### `packages/core/src/instructions/resolver.ts` (NEW)

pure function that takes an `Instruction[]` and returns `ResolvedInstructions`. tested in isolation (no I/O).

```ts
export function resolveInstructions(instructions: Instruction[]): ResolvedInstructions {
  // 1. permissions: scan all, default ALLOW; flip to DENY on any false. flag conflicts where
  //    two same-level instructions disagree but the most-restrictive still wins.
  // 2. behavior: order by level (base → org → cap-type → cap-instance → user), each level's
  //    text is appended in order. later-overrides-earlier is implicit because later text appears
  //    later in the prompt and the model treats later context as more recent / stronger.
  //    (The "override" is by appending; we don't try to detect-and-replace.)
  // 3. conflicts: at the cap-instance level, if two instances of the same type have different
  //    permission flags, record a conflict (admin-visible warning, not a block).
}
```

### `packages/core/src/agent/systemPrompt.ts` (MODIFIED)

extend `buildSystemPrompt` to accept `instructions: ResolvedInstructions` and to render:
- the base system prompt (unchanged)
- the active capabilities list (unchanged)
- a new "Instructions" section that lists `behaviorChunks` in order, prefixed by source
- a new "Permissions" section that summarizes the resolved permissions ("write: false; this agent must not modify external systems")

### `packages/core/src/server/routes/instructions.ts` (NEW)

CRUD for instructions:
- `GET /api/org/instructions` — admin-only; returns org-level instructions (an array of `Instruction` with `level: 'org'`)
- `PUT /api/org/instructions` — admin-only; sets org-level instructions
- `GET /api/me/instructions` — returns the requesting user's user-level instructions
- `PUT /api/me/instructions` — sets the requesting user's user-level instructions

cap-type and cap-instance instructions live on the capability config (existing routes); wave 5 just teaches the resolver to read them.

### `packages/core/src/capabilities/types.ts` (MODIFIED — small)

extend `CapabilityConfig` with optional `instructions?: { text?: string; permissions?: ...; canShareWith?: string[] }`. `canShareWith` is the per-instance isolation field — array of capability instance ids that this instance allows data to flow to.

### `packages/core/src/agent/run.ts` (MODIFIED)

every `runAgent` call resolves instructions before building the system prompt:

```ts
const instructions = await resolveInstructionsForUser({
  tinoUserId: userId,
  activeCapabilities,
  configStore,
  userCapStore,
  userStore,
});
const systemPrompt = buildSystemPrompt({
  activeCapabilities,
  toolNames: Object.keys(tools ?? {}),
  instructions,
});
```

### `packages/core/src/instructions/per-instance-isolation.ts` (NEW)

helper that filters tool results based on per-instance `canShareWith` config. when an agent run involves multiple capability instances and the active context is "instance A," tool results from "instance B" are filtered out unless `B.canShareWith` includes A's id. wave 5 ships this as a wrapping layer around `runAgent`'s tool-call loop — but only for capabilities that declare `canShareWith` on their config; capabilities without it are unaffected.

### `packages/core/src/persistence/keys.ts` (NEW)

central key-prefix module:

```ts
/**
 * Tenant prefix for all partition keys.
 *
 * Single-tenant deployments: empty string (no prefix). All keys look like 'USER#<id>...'.
 * Future managed-multi-tenant: 'TENANT#<tenantId>#'. All keys become 'TENANT#<tid>#USER#<id>...'.
 *
 * The prefix is read from `org.tenantId` config at startup; if unset, it's "".
 * No code path should construct partition keys without going through this module.
 */
export function tenantPrefix(): string {
  return ""; // wave 5: still empty by design
}

export function userKey(tinoUserId: string): string {
  return `${tenantPrefix()}USER#${tinoUserId}`;
}

export function userHistoryKey(tinoUserId: string): string {
  return `${userKey(tinoUserId)}#HISTORY`;
}

// ... etc, one helper per partition key shape
```

every existing `pk = 'USER#...'` literal across the codebase is replaced with a call to one of these helpers. this is the multi-tenant-readiness change — touching every key construction site to route through one module. tedious but mechanical.

note: the helpers are pure functions over a constant; the JIT will inline them. zero runtime cost.

### `tests/instructions/resolver.test.ts` (NEW)

unit tests:
- empty input → default permissions (write/delete/share = true), empty behaviorChunks, empty conflicts
- single org-level write:false → resolved write:false
- org write:false + user write:true → resolved write:false (most-restrictive)
- org "summarize in 5 bullets" + user "summarize in 3 sentences" → behaviorChunks contains both in order; user is last
- two cap-instance instructions on the same capability with different permissions → conflict recorded
- per-level ordering: base → org → cap-type → cap-instance → user

### `tests/agent/system-prompt.test.ts` (MODIFIED)

extend existing tests to cover the new instructions section.

### `tests/instructions/isolation.test.ts` (NEW)

per-instance isolation tests:
- a tool call returning data from instance A is visible when active context is A
- a tool call returning data from instance B is filtered when active context is A and B.canShareWith=[]
- a tool call returning data from instance B is visible when active context is A and B.canShareWith includes A
- conflict warning appears when two instances disagree on permissions

### `tests/persistence/keys.test.ts` (NEW)

unit tests for the key helpers. covers: tenantPrefix returns "" by default; userKey, userHistoryKey, etc. produce the expected strings; round-trip through the helpers in dynamo store reads/writes.

## acceptance criteria

```plan-state
- [ ] id: a1
  intent: The instruction resolver implements the precedence rules from product.md — permissions resolve via most-restrictive-wins regardless of level; behavioral text resolves via later-overrides-earlier ordered by level (base → org → cap-type → cap-instance → user).
  tests:
    - tests/instructions/resolver.test.ts::"empty input returns default permissions"
    - tests/instructions/resolver.test.ts::"org write:false beats user write:true (most-restrictive)"
    - tests/instructions/resolver.test.ts::"behavior chunks are ordered base to user"
    - tests/instructions/resolver.test.ts::"two cap-instance instructions with disagreeing permissions record a conflict"
  verify: bun run test tests/instructions/resolver.test.ts

- [ ] id: a2
  intent: The system prompt includes the resolved instructions in a structured Instructions section. Permissions appear in a Permissions section.
  tests:
    - tests/agent/system-prompt.test.ts::"system prompt includes Instructions section"
    - tests/agent/system-prompt.test.ts::"system prompt includes Permissions section"
  verify: bun run test tests/agent/system-prompt.test.ts

- [ ] id: a3
  intent: Per-instance isolation prevents data from one capability instance leaking into a context that shouldn't see it. canShareWith is the explicit allow-list.
  tests:
    - tests/instructions/isolation.test.ts::"tool result from instance A is visible in context A"
    - tests/instructions/isolation.test.ts::"tool result from instance B is filtered when canShareWith excludes A"
    - tests/instructions/isolation.test.ts::"tool result from instance B is visible when canShareWith includes A"
  verify: bun run test tests/instructions/isolation.test.ts

- [ ] id: a4
  intent: All partition keys are constructed via the keys module. The tenant prefix is currently empty string but is the single point of change for a future multi-tenant offering.
  tests:
    - tests/persistence/keys.test.ts::"tenantPrefix returns empty string by default"
    - tests/persistence/keys.test.ts::"userKey produces USER#<id> with no prefix"
    - tests/persistence/keys.test.ts::"changing tenantPrefix changes all derived keys"
  verify: bun run test tests/persistence/keys.test.ts

- [ ] id: a5
  intent: Admin and user instruction APIs work end-to-end. An admin can set org-level instructions; a member can set their own user-level instructions; the system prompt for a member's run includes both with the user-level appended last.
  tests:
    - tests/server/instructions-routes.test.ts::"admin can set org instructions"
    - tests/server/instructions-routes.test.ts::"member can set their own instructions"
    - tests/server/instructions-routes.test.ts::"member cannot set org instructions"
    - tests/integration/wave5-instruction-resolution.test.ts::"agent run for member includes org and user instructions in order"
  verify: bun run test tests/server/instructions-routes.test.ts tests/integration/wave5-instruction-resolution.test.ts

- [ ] id: a6
  intent: All existing tests continue to pass.
  tests:
    - "*"
  verify: bun run test
```

## test plan

- pure-function unit tests for the resolver (covers all combinations of precedence and conflict).
- system-prompt assertions that the new sections render correctly.
- per-instance isolation unit tests.
- key-helper unit tests.
- integration tests for end-to-end instruction resolution in a real agent run.
- existing 314+-test suite passes.
- **manual verification:** set an org-level instruction "respond only in Spanish" via admin console; have any user DM tino — they should get a Spanish response. set a user-level instruction "respond in French" — that user gets French. demote them and remove the user instruction — they get Spanish again. set org-level "write: false" on github — verify github_create_issue refuses with "permission denied by org policy."

## non-goals

- Do NOT ship per-field isolation. that's product.md:430-446's deferred v3 work.
- Do NOT actually ship multi-tenancy. wave 5 only routes keys through the helper; the helper returns "" today.
- Do NOT add a UI for cap-instance instructions in this wave (admins edit them via the existing capability config form's free-text field). a polished UI is follow-up work.
- Do NOT change audit-log retention or schema.
- Do NOT change KMS key policy.

## rollback story

wave 5 is purely additive:

1. **resolver bugs:** revert just the call to `resolveInstructionsForUser` in `agent/run.ts`. system prompt falls back to its pre-wave-5 shape (no Instructions or Permissions section). configured instructions sit dormant; no data corruption.
2. **per-instance isolation bugs:** revert the wrapping layer in `agent/run.ts`. tool results flow unfiltered as in waves 0-4.
3. **keys-module bugs:** revert is harder because every persistence file imports from the keys module. mitigation: ship wave 5 in two PRs — first PR is just the keys-module refactor (every key-construction site routes through helpers; helpers return literals identical to before); second PR adds the instruction work. PR 1 is mechanical and easy to revert without touching application logic.

## open questions

- **conflict UI surface.** the resolver records `conflicts` but wave 5 doesn't display them anywhere. flag for the executor: add a banner to the relevant capability config page, "this instance conflicts with <other> on permission.write — both are configured, most-restrictive wins." not blocking; nice-to-have.
- **how aggressive is the isolation filter?** product.md doesn't fully specify. wave 5's implementation: when a tool returns from instance B and `B.canShareWith` doesn't include the active instance, the tool result is replaced with `{ filtered: true, reason: 'isolated by canShareWith' }`. the model sees this and adapts. flag if this turns out to confuse the model; alternative is to drop the result entirely (silent filter) — less informative but cleaner.
- **multi-tenant constant: env var or config store?** wave 5 ships it as a function returning a hardcoded "". a future managed offering needs to read tenant id from somewhere. flag: when that day comes, the tenant id should come from request context (per-request tenant) not from env (per-deployment tenant). wave 5's helper signature should accept a tenant id explicitly OR read from request-scoped context. for now, the no-arg version is fine.
