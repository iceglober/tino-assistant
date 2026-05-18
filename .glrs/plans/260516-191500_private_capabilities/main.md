# tino — private capabilities (single-tenant, multi-user)

## what this is

tino is OSS. anyone at company ABC can install the npm package, deploy the docker container or the pulumi component, and stand up tino for their team. today the deployment behaves as if there is exactly one human: the bot owner. the slack DM handler hard-rejects any sender other than `ALLOWED_SLACK_USER_ID`; every capability credential (xoxp slack user token, gmail refresh token, github PAT, linear token) lives in one global `capability.<id>` blob; every `runAgent` call passes the bot owner's slack ID as `userId`. if the slack gate were widened so a teammate could DM tino, that teammate's question would execute under the bot owner's tokens — they could ask "summarize my latest gmail thread" and tino would dutifully read the bot owner's gmail. that is the bug.

this plan does two things together. **first**, it converts the single-user assumption into a privacy-respecting single-tenant deployment that supports a team of N humans. each capability declares `scope: 'shared' | 'private'`. shared capabilities (public slack channels, github repos, linear workspace, cloudwatch log groups) keep one centrally-configured credential and any authorized user can call them. private capabilities (private slack DMs, gmail, calendar) require per-user credentials and only the user who configured them can have tino act on their behalf. the data model in `docs/plans/product.md` lands: better-auth-managed UUIDs as the canonical user identity, an identity table that maps `slack_user_id` and `google_email` to that UUID, role-based admin/member separation, dynamodb partition isolation under `USER#<tinoUserId>#*`, and KMS envelope encryption with user-id `EncryptionContext` for all personal tokens.

**second**, it adds the load-bearing privacy guarantee for the personal data tino persists on each user's behalf: **source-respecting privacy** (wave 3.5). tino uses each capability's own sensitivity semantics where they exist (calendar's `visibility` flag, gmail labels, slack — which has none, so a user-managed deny-list), falls back to user-managed deny-lists where they don't, and treats tino as an active participant in helping the user configure both. the per-capability privacy filter sits at the history-writer seam — the single function through which tool results enter `HISTORY#<userId>` — so adding a new capability that needs gating is a single filter module, and tightening privacy later is changing the default decision, not refactoring the writer.

`PROBLEM.md` (in this directory) is the strategic framing: the threat model (Threat A = privileged operator, B = lower-privileged IAM principal, C = data-at-rest exfiltration), the five options considered, and the recommendation. this plan delivers **Answer 2-with-vault** from PROBLEM.md as the kayn posture: per-user envelope encryption (wave 2) defends Threats B and C; source-respecting privacy (wave 3.5) is the load-bearing privacy guarantee against operator-readable history bodies; the cold-path vault from PROBLEM.md option 3 is demoted to an opt-in future upgrade for users wanting cryptographic Threat-A defense.

`wave_3_5.md` is the canonical design doc for source-respecting privacy. principle 7, decision D7, gaps 21–26, open questions 6–7, and the wave-3.5 row of the table all point at it.

the architecture is also explicitly designed so that a future managed-multi-tenant offering is a natural extension — tenant-id becomes another partition-key prefix, not a rewrite. this plan does NOT ship multi-tenant; it ships the foundation that makes multi-tenant a small additive change.

## what was already designed (and what's left)

`docs/plans/product.md` (lines 153-264, 269-389, 395-446) already lays out the full multi-user architecture: the user table extension, the identity table, the shared-vs-personal capability classification, the per-user `xoxp-` slack token model, the dynamodb partition key scheme, the threat model (with the exact threat "user A reads user B's email/calendar/DMs"), the KMS envelope-encryption design with user-id encryption context, the credential storage matrix, the admin-vs-member roles, and the instruction-precedence rules.

`docs/plans/v2.md:10` and `docs/plans/v2_2/main.md` deliberately deferred all of this — the v2.x plans explicitly state "single-user, multi-user not in scope." nothing has been built. this plan converts the deferred design into shippable waves.

`docs/security.md:10` confirms the current state: "Slack DMs filtered to a single admin user ID."

source-respecting privacy is NOT in `product.md`. `product.md` enumerates per-user partitioning + envelope encryption (which becomes wave 2) but treats persistence as opaque "store the tool result." `PROBLEM.md` and `wave_3_5.md` are the new layer this plan introduces beyond `product.md`.

## principles

1. **security-first, default-deny.** every credential read path is specified end-to-end: who reads it, what IAM action, what KMS encryption context, what audit log entry, what failure mode. when a private capability has no per-user credential, the tool MUST NOT be in the user's toolset (not "in the toolset but throws") — a missing credential is "you haven't connected gmail yet," not a stack trace.
2. **the user identity in `runAgent` is the requesting user's tino-UUID.** today it's the bot owner's slack id; after this plan it's the requesting user's tino-UUID resolved from their slack id via the identity table. every call site changes. existing per-user data (history, preferences, tasks) currently keyed by slack id is migrated to be keyed by tino-UUID.
3. **capabilities split cleanly into shared and private.** the `CapabilityModule` interface gains a `scope: 'shared' | 'private'` discriminator. shared modules register tools once at startup using credentials from `ORG#CAP#<capId>`. private modules expose a `buildToolsForUser(userId, userCredentials)` factory that runs lazily per `runAgent` call using credentials from `USER#<tinoUserId>#CAP#<capId>`. the global toolset goes away.
4. **personal tokens are envelope-encrypted with user-id encryption context.** `kms:GenerateDataKey` + AES-256-GCM at write, `kms:Decrypt` with `EncryptionContext={ userId: <tinoUserId>, capabilityId: <capId> }` at read. even if application code reads another user's encrypted attribute, KMS refuses to decrypt without the right encryption context. this is the guarantee that makes "user A reads user B's gmail" require both an application bug AND a KMS-policy bypass.
5. **OSS-friendly + future-multi-tenant-ready.** every design choice supports three deployment shapes simultaneously: (a) austin's deployment with austin + 1-3 teammates; (b) an OSS adopter at company ABC deploying for 20 teammates; (c) a future hosted-tino offering that becomes multi-tenant by prefixing every partition key with `TENANT#<tenantId>#`. waves call out where a choice enables (or precludes) (c).
6. **backwards compatible at every wave boundary.** the bot owner (austin) is currently the sole user; every wave must leave austin's deployment working. data migrations are copy-then-leave for one release before any delete. each wave has an explicit rollback story.
7. **source-respecting privacy.** *use each capability's own sensitivity semantics where they exist, fall back to a user-managed deny-list where they don't, and treat tino as an active participant in helping the user configure both.* calendar has `visibility: private`; gmail has labels and recipient addresses; slack has neither, so it gets a deny-list. tino doesn't invent its own sensitivity flag and ignore the user's source-side configuration. tino doesn't passively accept whatever the source-side defaults happen to be. the executor, the data subject, and the operator share one mental model: if the user marks something private at the source, tino respects that; if there's no source-side flag, the user controls a deny-list; tino actively helps the user configure both via the assisted-setup tools (wave 3.5). full design in `wave_3_5.md`.

## decisions made (frozen for this plan)

these are the foundational design decisions that affect every wave. they are decided here so each wave doesn't re-litigate them.

### D1 — `runAgent` user identity is the tino-UUID, not the slack id

every `runAgent` call site accepts a `tinoUserId: string` (UUID) and is responsible for resolving it from whatever upstream identity triggered the call. resolution lives in a new `identity` module (`packages/core/src/identity/resolver.ts`) that takes `{ provider: 'slack' | 'google', externalId: string }` and returns `tinoUserId | null`. existing call sites:

- slack DM handler (`packages/core/src/slack/app.ts:47`): looks up `IDENTITY#slack#<m.user>`. if found → tino-UUID is used. if not found in `allowlist` mode → reject with "ask your admin." if not found in `org-domain` mode → auto-provision (look up email via `users.info`, check domain, create user + identity).
- scheduler (`packages/core/src/index.ts:84`, `packages/core/src/scheduler/run.ts`): tasks are stored with `userId: tinoUserId` (post-migration). the scheduler passes `task.userId` straight through.
- find-work callback (`packages/core/src/index.ts:74`): findWork pollers for shared capabilities have no inherent "user" — they're a system event. these calls pass a synthetic `tinoUserId: SYSTEM` and use only shared tools (private tools refuse to register for `SYSTEM`). this preserves the current poll-and-DM-the-owner behavior in a multi-user world: the owner remains the recipient, but the agent run itself uses no private capabilities.

### D2 — toolset materialization: shared once at startup, private lazily per call

the registry today builds one global `tools: ToolSet` at startup. this becomes:

- `registry.sharedTools: ToolSet` — built once at startup from `ORG#CAP#<capId>` blobs. immutable per-process until `reload()`. these are the tools that DON'T need a user identity: github_search, linear_search, cloudwatch_query, slack_search_public_channels.
- `registry.buildPrivateTools(tinoUserId): Promise<ToolSet>` — per-`runAgent` call. walks every private-scoped capability, reads the user's `USER#<tinoUserId>#CAP#<capId>` blob, decrypts each credential via KMS with `EncryptionContext={ userId: tinoUserId, capabilityId: capId }`, calls the module's `buildToolsForUser(decrypted, ...)` factory.
- `runAgent` receives both: `tools = { ...sharedTools, ...privateTools }`. the system prompt is built from `activeCapabilities = sharedIds.concat(privateIds-where-user-has-creds)`.

cost: the per-call private-tool build does up to N KMS Decrypt calls (N = number of personal capabilities the user has connected). at $0.03 per 10,000 calls and ~5 personal credentials per user, this is well under $0.001 per agent run. acceptable.

### D3 — bootstrap admin via `ALLOWED_SLACK_USER_ID` for one release

for one release after this plan lands, `ALLOWED_SLACK_USER_ID` continues to function as a bootstrap mechanism: at first startup, if the user table is empty, the slack user with that id is auto-provisioned as the initial admin. after that, admins are promoted via the console and `ALLOWED_SLACK_USER_ID` becomes a no-op (still parsed for env-var compatibility, but logged as deprecated). the var is removed in the release after.

### D4 — sessions move from sqlite-`/tmp` to dynamodb in wave 3

`packages/core/src/server/middleware/auth.ts:18-21` justifies the `/tmp/tino-auth.db` session store with "single-user, re-login is fine." that justification dies the moment we go multi-user. wave 3 (which flips on multi-user DM handling) replaces the sqlite session store with a better-auth dynamodb `secondaryStorage` adapter so N teammates don't get force-logged-out on every ECS restart. this is "while you're there" work, not a separate wave.

### D5 — findWork pollers stay shared-only in this plan

a per-user gmail findWork poller would multiply API quota usage by N users. the design space (per-user findWork, opt-in by user, rate-limited by org) is real but out of scope here. for this plan: only shared-scope capabilities can have `findWork`. the private branch ignores the `findWork` config field. wave 1 makes this an enforced invariant in the type system; wave 2 adds a console warning if a user tries to enable findWork on a private capability.

### D6 — copy-then-leave migration; delete in a follow-up wave

the bot owner's existing per-user data (history, preferences, tasks) is currently keyed by their slack user id. wave 0 backfills: create a tino user for the bot owner, link the slack identity, and **copy** every `<slackUserId>#*`-prefixed record to a new `USER#<tinoUserId>#*` partition. the old records stay in place for one release as a safety net. a follow-up wave (out of scope for this plan) deletes the old records. the read path during the transition prefers tino-UUID-keyed records and falls back to slack-id-keyed only for the bot owner — gated by a feature flag that is on by default.

### D7 — the history-writer is the privacy seam

the agent loop produces tool results. before the history writer persists a tool result to `HISTORY#<userId>`, it consults a per-capability privacy filter that returns `Decision = { persist: true } | { persist: false, placeholder: ToolResultPlaceholder }`. if `persist: true`, the body is encrypted and stored as today. if `persist: false`, a metadata-only placeholder is encrypted and stored in the body's place — enough for the agent on a later turn to know the event/thread/message exists without reading content.

four properties this seam guarantees:

1. **adding a new capability that needs gating is a single filter module.** the orchestrator routes by capability id; each per-capability filter is pure `(args, result, userPrivacyConfig) → Decision`. no I/O.
2. **tightening privacy later is changing the default.** "persist nothing by default; opt-in to persist" is a one-line change in `gmailFilter`. it doesn't refactor the writer.
3. **the seam is the only path through which tool results enter history.** the history module exports only the helper, not the underlying store mutations. enforced by module boundaries; lint rule blocks raw history writes from anywhere else.
4. **the seam ships in wave 2** with a default-allow filter. **wave 3.5 replaces it** with the real per-capability implementation. an OSS adopter who skips wave 3.5 still has a working tino — the filter defaults to `persist: true` and tino persists everything to history. that's a weaker posture but not broken.

`wave_3_5.md` defines the filter shape, per-capability rules (calendar / gmail / slack), and placeholder formats. wave 2's file-level changes introduce the seam.

## waves

| #   | name | what ships | independently shippable? |
|-----|------|------------|--------------------------|
| 0   | user + identity foundation | better-auth schema extension (custom fields `role`, `status`, `slackUserId`); `IDENTITY#<provider>#<externalId>` table; identity-resolver module; one-shot migration that creates the bot-owner's tino user, links their slack identity, and copies slack-id-keyed data to tino-UUID-keyed partitions. no behavior change for any user; the bot owner still gates DMs through `ALLOWED_SLACK_USER_ID`. | yes — bot still works as before, just with a richer data model behind the scenes |
| 1   | capability scope split (shape only) | add `scope: 'shared' \| 'private'` to `CapabilityModule`; classify each existing module (gmail/slack-personal/calendar are private; github/linear/cloudwatch/slack-public are shared); refactor registry into `sharedTools` + `buildPrivateTools(userId)` factory; agent runtime calls the factory per run. private capabilities still read from the global `capability.<id>` blob (just like today) — the per-user storage layer arrives in wave 2. dead/disabled paths for the private-per-user branch. | yes — bot-owner continues to be the sole user; everything works; the structural refactor lands without behavior change |
| 2   | per-user private credentials + KMS + history-writer seam | dynamodb partition `USER#<tinoUserId>#CAP#<capId>` with envelope encryption (user-id encryption context); per-user gmail OAuth flow in console; per-user slack `xoxp-` token UI; bot-owner's existing global gmail/slack-personal credentials migrate into a per-user record under their tino-UUID; console gets a "your capabilities" page distinct from the existing "org capabilities" page. **also: the history-writer seam is introduced** — every tool result flows through `historyAppender.appendToolResult` which consults an injected `PrivacyFilter` (defaults to `() => ({ persist: true })` in this wave). wave 3.5 replaces the filter; the seam exists here so wave 3.5 is a one-file change to the writer. | yes — bot owner moves to per-user creds; no other user yet; persistence behavior unchanged (default-allow filter) |
| 3   | multi-user slack DM + per-user agent dispatch | drop `ALLOWED_SLACK_USER_ID` hard gate; replace with user-table check (allowlist or org-domain mode); auto-provision flow on first DM in domain mode; thread tino-UUID through every `runAgent` call site; per-user toolset materialization actually engages (each user's run gets their private tools). also moves better-auth sessions from `/tmp` sqlite to dynamodb so teammate sessions survive ECS restarts. **this is the wave that lets your teammates DM tino.** wave 3.5 makes the privacy story complete; without it, multi-user tino persists everything to history regardless of source-side sensitivity. | yes — austin + teammates can DM tino with privacy boundaries enforced (credential isolation), though source-respecting persistence gating awaits wave 3.5 |
| 3.5 | source-respecting privacy (NEW) | per-capability privacy filters (calendar / gmail / slack) replace the wave-2 default-allow filter at the history-writer seam; per-user `USER#<tinoUserId>#PRIVACY_CONFIG` row with envelope encryption; required onboarding flow with pre-population from existing source data; 5 tino-assisted setup tools (`gmail_create_privacy_filter`, `gmail_audit_filters`, `calendar_check_defaults`, `calendar_suggest_private`, `slack_audit_dms`); retroactive scrub on additive deny-list saves; periodic re-prompts in console; CloudWatch lockdown enforced by mandatory CI test; writable `docs/privacy.md` page. **mandatory for kayn deployment**; OSS adopters who skip it get a working multi-user tino with a weaker (default-allow) privacy posture. | yes — additive on top of wave 3; four feature flags allow rolling back to wave-3 behavior without code revert |
| 4   | admin/member roles + audit visibility | role-based UI gates: admin sees org capabilities + audit logs (including wave 3.5's `privacy_config_change` and `privacy_scrub` events) + user management; member sees their own personal capabilities, their own usage, no admin-scoped audit view. server-side enforcement on every API route (route-level `requireAdmin` middleware). audit log queries scoped to admin role only. | yes — multi-user is already working from wave 3; this layers on access control |
| 5 (deferred-friendly) | instruction precedence + per-instance isolation | implement the precedence rules from `product.md:401-424` (most-restrictive-wins for permissions, later-overrides for behavior); per-capability-instance "canShareWith" labels; foundation for the future managed-multi-tenant tenant-id partition prefix (a one-line constant changes from `""` to `TENANT#<tenantId>#`); interactive approval mechanism that wave 3.5's `gmail_create_privacy_filter` consumes. | yes — purely additive; can be deferred indefinitely without breaking waves 0-4 (and 3.5) |

waves 0-3, 3.5, and 4 are the must-ship set for the kayn deployment. wave 5 is the "ready for multi-tenant" wave and can land later.

## execution order

ship in order. each wave depends on the previous:

- **0 → 1 → 2 → 3 → 3.5 → 4 → 5**

key dependencies:

- **3.5 follows 3** because (a) per-user privacy config is per-user — only meaningful once each user is a real tino-UUID (wave 0) with their own credentials (wave 2) and their own dispatched runAgent run (wave 3); (b) the history-writer seam is added in wave 2 so 3.5's filter is the only thing wired in, not the seam *and* the filter together; (c) wave 4's admin role gates portions of the audit-log visibility that 3.5 produces (privacy config changes, scrub events) — so 3.5 should land before 4 to give the audit viewer the right entry types from day one.
- **3.5 is mandatory for the kayn deployment** but the seam in wave 2 means an OSS adopter who skips 3.5 still has a working tino — they just don't get source-respecting privacy. operationally: between waves 3 and 3.5 the deployed state is multi-user DM with default-allow persistence — flag this transitional state in deployment notes; it's deliberate (wave 3 is a useful checkpoint) but should not linger in production.
- merging or splitting any other adjacent waves is not safe: the toolset refactor in wave 1 assumes the identity resolver from wave 0; the per-user storage in wave 2 assumes the scope split from wave 1; the multi-user dispatch in wave 3 assumes per-user credentials from wave 2; role enforcement in wave 4 assumes the multi-user dispatch from wave 3.

within a wave, items are usually parallelizable — see each `wave_N.md` for per-item dependencies.

## known gaps (complete inventory)

### critical (blocks the design)

| # | gap | impact | wave |
|---|-----|--------|------|
| 1 | **no user table beyond better-auth's default schema** — better-auth has its own `user` table but it isn't extended with tino-specific fields (`role`, `status`, `slackUserId`) and isn't used as the source-of-truth for tino userIds | can't tell who anyone is; no role-based access control possible | 0 |
| 2 | **no identity table** — there's no `IDENTITY#<provider>#<externalId> → tinoUserId` mapping, so a slack user id can't be resolved to a tino user | can't even start to widen the slack DM gate | 0 |
| 3 | **slack DM gate is a single env-derived constant** (`packages/core/src/slack/app.ts:47`) — `m.user !== env.ALLOWED_SLACK_USER_ID` is the entire access check | only one human ever talks to tino; teammates literally can't DM | 3 |
| 4 | **capability registry is one global toolset built at startup** (`packages/core/src/capabilities/registry.ts:127`) — there is no per-user concept anywhere in the registry; `tools` is a single `ToolSet` shared across all calls | can't ship per-user creds because there's nothing user-scoped to put them in | 1 |
| 5 | **personal tokens stored unencrypted in the same global blob as org tokens** — `capability.<id>.credentials` is a flat dict, no scope distinction, no per-user partitioning, no envelope encryption | fundamental privacy boundary doesn't exist | 1 (split) + 2 (encrypt) |

### high (security / privacy)

| # | gap | impact | wave |
|---|-----|--------|------|
| 6 | **no envelope encryption on credentials in dynamodb** — the dynamodb table uses a CMK at the table level (`packages/aws/src/pulumi/tino-service.ts:386`) but every `dynamodb:GetItem` reader can read the plaintext credentials. application-level partition isolation is enforced by code, not IAM/KMS | a bug or prompt-injection that tricks tino into querying another user's partition leaks tokens. for a security-first project, unacceptable | 2 |
| 7 | **no `kms:EncryptionContext` use anywhere** — KMS is provisioned but the application doesn't pass `EncryptionContext` to any encrypt/decrypt call. the `product.md:389` defense ("decryption only works when the correct user ID is in the context") doesn't actually exist | even with envelope encryption, there's no per-user crypto binding | 2 |
| 8 | **`runAgent` `userId` is the bot owner's slack id at every call site** — `packages/core/src/index.ts:89,184,222` all pass `userId: allowedUserId`. there is no path for "the requesting user's identity" because there is no requesting user concept | every audit log entry, every history record, every preference write attributes to the bot owner regardless of who actually triggered the run. once we widen the slack gate, this attribution is lying | 3 |
| 9 | **better-auth session store at `/tmp/tino-auth.db`** — wiped on ECS restart. `auth.ts:18-21` justifies it with "single-user, re-login is fine"; that justification dies in wave 3 | force-logout on every restart for N teammates is bad UX. for a security-first project, also forces frequent re-auth which trains users to click through OAuth prompts | 3 |

### medium (data model / migration)

| # | gap | impact | wave |
|---|-----|--------|------|
| 10 | **existing per-user data keyed by slack user id, not tino-UUID** — history (`packages/core/src/agent/history.ts`), preferences (`packages/core/src/persistence/preferences.ts`), tasks (`packages/core/src/persistence/tasks.ts`) all use `userId: string` but the value passed in is the slack id | post-migration, partition keys must be `USER#<tinoUserId>#*`; old records stranded if we don't migrate | 0 |
| 11 | **no per-user capability storage** — `USER#<tinoUserId>#CAP#<capId>` partition does not exist | wave 1 ships the type-system split but private capabilities still read from the global blob; wave 2 must add this | 2 |
| 12 | **scheduler's `task.userId` is currently a slack id** — `packages/core/src/persistence/tasks.ts` writes whatever the caller passes; today that's `allowedUserId` (slack id). schedule-task tool also uses slack id | post-migration tasks need to be tino-UUID-keyed; pre-existing tasks need backfill | 0 |
| 13 | **no `IDENTITY#*` query path on read** — the slack DM handler currently doesn't look up anything; the console auth middleware reads better-auth's session but doesn't resolve it to a tino-UUID | every read path that needs "who is this user in tino's terms" must be added | 0 |

### medium (console UX)

| # | gap | impact | wave |
|---|-----|--------|------|
| 14 | **console has no "personal capabilities" page** — only the existing admin-style global capability config page. there's no per-user OAuth-connect button for gmail, no per-user `xoxp-` token field, no "your connected accounts" view | wave 2 needs to add this whole UX surface | 2 |
| 15 | **console has no admin-vs-member distinction** — every authenticated user sees the same console (right now, the only authenticated user is the bot owner so it doesn't matter) | once teammates can sign in, the global capability config page must be admin-only | 4 |
| 16 | **no user-management UI** — admins can't see or manage users; there's no "promote to admin" button | wave 4 needs this | 4 |

### low (correctness / cleanup)

| # | gap | impact | wave |
|---|-----|--------|------|
| 17 | **`packages/core/src/index.ts:45` reads `slack.adminUserId` config OR `ALLOWED_SLACK_USER_ID` env** as both DM gate and runAgent userId — these two semantics are conflated | post-multi-user, the DM gate is "is this user in the user table?" and the runAgent userId is the resolved tino-UUID. the two roles must split. | 3 |
| 18 | **`auth.ts` says "single-user" in a comment that becomes false after wave 3** | stale comment misleads future contributors | 3 |
| 19 | **`docs/security.md:10` says "Slack DMs filtered to a single admin user ID"** | doc claim becomes false after wave 3 | 3 |
| 20 | **find-work pollers are registered globally at startup** — they're shared by definition (single set of pollers per deployment), but the design doesn't currently model "shared vs private" so the implicit invariant isn't enforced | in wave 1 we should make it a type error to declare findWork on a private capability | 1 |

### source-respecting privacy gaps (motivate wave 3.5)

| # | gap | impact | wave |
|---|-----|--------|------|
| 21 | **no per-capability privacy filter** — the history writer persists every tool result body unconditionally. calendar `private` events, gmail labels, and the very concept of a slack deny-list are not represented anywhere in the persistence path | this IS the privacy boundary. without it, every persisted history row is operator-readable regardless of source-side sensitivity. **severity: critical.** | 3.5 |
| 22 | **no privacy config schema** — there's no `USER#<userId>#PRIVACY_CONFIG` row, no `gmail_private_labels`, no `slack_deny_list`, no `gmail_deny_list`, no `calendar_visibility_gating` toggle. the user has nowhere to express "anything labeled `Private` in gmail should not be persisted" | the user's privacy posture is not representable in the data model. wave 3.5 introduces the row + schema. | 3.5 |
| 23 | **no privacy onboarding flow** — new users currently get dropped straight into the main console. there's no "before you start, let's configure privacy" step | new users start producing persisted history before they've configured what should and shouldn't be persisted — first-conversation-persistence-window leak. wave 3.5 adds the gate + pre-population. | 3.5 |
| 24 | **no tino-assisted privacy setup tools** — the agent has no `gmail_create_privacy_filter`, `gmail_audit_filters`, `calendar_check_defaults`, `calendar_suggest_private`, `slack_audit_dms` | tino can't actively help the user configure source-side privacy; the user has to know to do it on their own. wave 3.5 adds these 5 tools. | 3.5 |
| 25 | **no retroactive scrub mechanism** — adding a new entry to the deny-list later does nothing to prior persisted data. the user adds `therapist@example.com` to the gmail deny-list after a year of usage; that year of therapy emails stays persisted | additive deny-list saves are useless for prior data. wave 3.5 ships the scrub job; additive saves trigger an in-place rewrite to placeholders. | 3.5 |
| 26 | **CloudWatch logs may contain private content** — the pino redaction config is generic; there's no positive assertion that tool results from private-tagged capabilities are never logged. a future refactor that adds `logger.info(..., { result })` in the wrong place leaks body content to log retention that survives long after the dynamodb history row is scrubbed | silent failure mode with long-tail consequences. wave 3.5 makes this an enforced acceptance test (mandatory CI on every PR touching tool execution or logging). | 3.5 |

## not in scope

- **managed multi-tenant offering.** waves 0-4 (plus 3.5) enable a single-deployment, multi-user, privacy-respecting tino. multi-tenant (one deployment serving multiple unrelated organizations) is a separate plan. this plan calls out where each design choice enables future-multi-tenant but does not implement it.
- **the cold-path vault from PROBLEM.md option 3** — this is now demoted from "optional core posture" to a future opt-in upgrade for users wanting cryptographic Threat-A defense (defense against the privileged operator on cold data). source-respecting privacy (wave 3.5) is the load-bearing privacy mechanism in this plan; the vault becomes a separate, future, opt-in layer that composes on top. an OSS adopter or kayn user who wants Threat-A defense layers it on later without re-architecting waves 0–4.
- **per-field isolation within a tool result** (e.g., "share titles across contexts but not descriptions") — `product.md:430` defers to v3. wave 3.5's placeholder is whole-body.
- **per-user findWork pollers** — see D5.
- **MCP server lifecycle tiers** (`product.md:448-469`) — orthogonal to private capabilities; can land in any wave or none.
- **role beyond admin/member** (e.g., custom roles, per-capability ACLs) — wave 4 ships admin/member only.
- **slack-side surfacing of periodic re-prompts** — wave 3.5 ships the console surface; slack DM surfacing is a follow-up. (open question 6.)
- **cross-user "ask user X for permission to read their data" flows** (PROBLEM.md variant 3) — out of scope; future feature.
- **deploy logistics** — the pulumi component will accept new config; the deployer runs `pulumi up`. no docs work in this plan.

## open questions

these are resolvable during implementation; flagging them so the executor doesn't get stuck.

1. **bidirectional bootstrap** — what happens when a user signs in to the console via google but has never DM'd tino? wave 0 creates them as a tino user (via the google-identity link from better-auth's session) but their `slackUserId` field stays null. when they later DM tino, the slack DM handler looks up `IDENTITY#slack#<id>` and finds nothing — but their email might match a `IDENTITY#google#<email>` already. wave 0 includes a "merge identities" step in the resolver: if the slack user's email matches an existing google-identity-linked tino user, link the slack identity to that user instead of creating a new one. wave 0 specifies this; wave 3 verifies it end-to-end.
2. **what does "no per-user gmail token" feel like to a user?** when alice asks tino "summarize my latest email" and she hasn't connected gmail, the response should be "you haven't connected gmail yet — visit the console to set it up." this is a system-prompt addition, not a tool — wave 2 specifies the prompt change and the missing-credential surface.
3. **encryption-context schema** — `EncryptionContext` is a flat string map. wave 2 fixes the schema as `{ userId: <tinoUserId>, capabilityId: <capId>, fieldName: <credKey> }` and bakes that into both the encryption helper and the KMS key policy condition. any change to this schema is a breaking change to existing encrypted data. wave 3.5's `PRIVACY_CONFIG` row uses the same schema with `capabilityId: 'privacy_config', fieldName: 'config'`.
4. **SYSTEM as a synthetic user** — D1 introduces `tinoUserId: SYSTEM` for find-work-poller agent runs. this is a reserved value; it must NOT clash with any real UUID. wave 0 fixes it as the literal string `"SYSTEM"` (UUIDs are 36 chars; this is 6) and adds an assertion that real tino-UUIDs never equal `"SYSTEM"`. wave 3.5's privacy filter short-circuits SYSTEM to `{ persist: true }` — SYSTEM runs use only shared tools and have no per-user privacy config.
5. **better-auth `secondaryStorage` for sessions in dynamodb** — wave 3 specifies a thin adapter. the better-auth interface is documented; if it changes shape between now and implementation, the wave-3 file may need a minor update. this is flagged but not a blocker.
6. **periodic re-prompt cadence and surface.** wave 3.5 proposes weekly summary surfaced as dismissable cards in the console. should it ALSO surface in slack on a configurable cadence (e.g., a "tino has noticed N new contacts" DM the user can opt into)? wave 3.5 ships the console surface; the slack surface is a follow-up after wave 3.5 has bedded in.
7. **heuristic regexes for `calendar_suggest_private`, `slack_audit_dms`, and onboarding pre-checks.** wave 3.5 ships `/private|personal|hr|legal|medical|doctor|therapy|family|finance|tax/i` as the initial English-language default. the executor confirms this isn't culturally narrow for the kayn-team users. long-term a public default-list lives in `docs/privacy.md` and the user can extend via console. wave 3.5 ships the initial set; expansion is iterative.
