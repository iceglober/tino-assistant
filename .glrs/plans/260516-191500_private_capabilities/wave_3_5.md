# wave 3.5: source-respecting privacy

ship the load-bearing privacy guarantee for personal data. per-capability privacy filters (Calendar / Gmail / Slack) replace the wave-2 default-allow filter at the history-writer seam. a per-user `USER#<tinoUserId>#PRIVACY_CONFIG` row goes live, encrypted with the user's CMK. an onboarding flow gates the console for new users until they've set their privacy posture for each connected capability, and pre-populates that posture from existing source-side data so they're not deciding from a blank slate. five tino-assisted setup tools (`gmail_create_privacy_filter`, `gmail_audit_filters`, `calendar_check_defaults`, `calendar_suggest_private`, `slack_audit_dms`) become available so tino can help the user configure source-side privacy. retroactive scrub runs on deny-list adds. periodic re-prompts surface in the console. CloudWatch logging is locked down with a positive assertion that private-capability tool results never appear in log output. the public privacy claim becomes a writable section on the deployment's privacy page.

the principle, in one sentence: **use each capability's own sensitivity semantics where they exist, fall back to a user-managed deny-list where they don't, and treat tino as an active participant in helping the user configure both.**

this wave operationalizes that principle as concrete shipping work.

## why this comes fifth (between wave 3 and wave 4)

four reasons, in order of weight:

1. **needs the history-writer seam from wave 2.** wave 2 introduces `historyAppender.appendToolResult` as the single function through which tool results enter `HISTORY#<userId>`, and an injected `PrivacyFilter` interface defaulting to `() => ({ persist: true })`. wave 3.5 replaces that default filter with the real implementation. without the wave-2 seam, wave 3.5 would have to refactor every history-writing call site at the same time as it ships the filter logic.
2. **needs per-user runAgent dispatch from wave 3.** privacy config is per-user. a per-user privacy config row only becomes meaningful once each user is a real tino-UUID (wave 0) with their own credentials (wave 2) and their own dispatched runAgent run (wave 3) producing tool results that need filtering.
3. **comes BEFORE wave 4 because privacy events flow through the audit log.** privacy config edits and retroactive scrub completions are audit entries. wave 4 introduces the admin-only audit-log viewer that surfaces them. shipping wave 3.5 first means wave 4's viewer has the right entry types to render from day one.
4. **mandatory for kayn deployment.** an OSS adopter who skips wave 3.5 still has a working multi-user tino — the privacy filter defaults to `persist: true` and tino persists everything to history. that's a weaker posture but not broken. for kayn (with austin as an operator who can read everything from the AWS console — Threat A in PROBLEM.md) source-respecting privacy is the load-bearing mechanism that prevents austin from reading teammates' calendar private events, gmail labeled `Private`, or DMs in deny-listed conversations after the fact.

between waves 3 and 3.5 the deployed state is: multi-user DM works, all tool results persist to history regardless of source-side sensitivity. flag this transitional state in the deployment notes; it's deliberate (wave 3 is a useful checkpoint to ship and observe before wave 3.5's larger surface area lands) but it should not linger in production.

## constraints

- **filter functions are pure.** input is `(capability, args, result, userPrivacyConfig)`. output is `Decision = { persist: true } | { persist: false, placeholder: ToolResultPlaceholder }`. no side effects. no I/O. trivially testable in isolation. any I/O the filter needs (e.g., re-checking calendar settings) goes in the tool's own pre-step, not in the filter.
- **privacy config row is encrypted with the user's CMK.** the `USER#<tinoUserId>#PRIVACY_CONFIG` row uses wave 2's `CryptoAdapter` with `EncryptionContext={ userId, capabilityId: 'privacy_config', fieldName: 'config' }`. the encrypted payload is the entire JSON config. one envelope per write.
- **onboarding is REQUIRED, not skippable.** until the user submits their privacy preferences for each connected capability, every console route except `/onboarding/*` and `/api/auth/*` redirects to `/onboarding`. enforcement is server-side middleware, not just frontend routing.
- **pre-population queries are read-only.** the onboarding step that pulls "top 15 contacts" / "top 15 DMs" / "calendar default visibility" makes only `GET`-shaped calls to the source. no labels are created, no events are modified, no DMs are written. the user reviews and submits; tino's involvement in source-side mutations happens later via the assisted-setup tools, gated by approval.
- **assisted-setup tools that mutate source-side state require approval.** `gmail_create_privacy_filter` (creates a Gmail filter rule) is a mutation. by the time wave 3.5 ships, wave 5 (interactive approval) ideally also ships; if wave 5 has not landed, mutation tools require an explicit `confirm: true` parameter and surface a "tino wants to create the following filter — type CONFIRM to proceed" message in the agent transcript. `gmail_audit_filters`, `calendar_check_defaults`, `calendar_suggest_private`, `slack_audit_dms` are read-only and run without approval.
- **retroactive scrub overwrites in place.** when the user adds a new entry to the deny-list, the scrub job scans `HISTORY#<userId>` for tool results that the new config would have filtered, decrypts them, replaces the body with the metadata-only placeholder, re-encrypts, and writes back to the same row. no soft-delete. no separate "scrubbed" partition. the row's new content IS the new truth.
- **scrub completion is an audit entry.** action: `'privacy_scrub'`, fields: `{ userId, capability, configDelta, rowsScrubbed, durationMs }`. wave 4's audit viewer surfaces it.
- **the CloudWatch lockdown test is mandatory CI.** every PR touching tool execution, the history writer, the privacy filter, or any logging code must run the lockdown test. fail-closed: if the test breaks (e.g., a refactor changes log-line format), the PR is blocked until the test is fixed and verified.
- **`SYSTEM` synthetic user has no privacy config.** find-work poller agent runs (D1) use `tinoUserId: SYSTEM` and only shared tools. shared tools' results are not gated by per-capability privacy filters because shared capabilities are public-by-construction (github repos, linear workspace, public slack channels, cloudwatch). the filter orchestrator returns `{ persist: true }` unconditionally for shared capabilities and for `SYSTEM` runs.

## architecture overview — the seam and the filter

```
runAgent → tool call → tool returns ToolResult
                                   ↓
                      historyAppender.appendToolResult(userId, capability, args, result)
                                   ↓
                      privacyFilter.evaluate(capability, args, result, userPrivacyConfig)
                                   ↓
                      Decision: { persist: true }   OR   { persist: false, placeholder: { ... } }
                                   ↓
                      HISTORY#<userId> — encrypted body OR encrypted placeholder
```

the seam ships in wave 2 with a default `() => ({ persist: true })` filter. wave 3.5 replaces it with `createPrivacyFilter({ configStore, capabilities: [calendarFilter, gmailFilter, slackFilter] })`.

the filter dispatches by capability id. each per-capability filter is a small module: input shape, decision shape, branches and rationale. adding a new capability that needs gating is a single new filter module + one line in the orchestrator's capability list. tightening privacy later (e.g., "Gmail: persist nothing by default, opt-in to persist") is changing the default decision in `gmailFilter`, not refactoring the writer.

placeholder shape (persisted in lieu of the body when the filter says don't):

```ts
type ToolResultPlaceholder = {
  type: 'redacted';
  reason: 'private_event' | 'private_label' | 'deny_listed_thread' | 'deny_listed_dm' | 'address_deny_listed';
  // metadata that's safe to keep — the agent on a future turn can still see "you had a calendar event at 3pm, marked private; i don't have the details"
  metadata: {
    // calendar
    eventId?: string; startsAt?: string; endsAt?: string; durationMin?: number;
    // gmail
    threadId?: string; receivedAt?: string; labelHash?: string;  // hash, not label name
    // slack
    channelId?: string; ts?: string;
  };
};
```

the metadata fields are deliberately minimal — enough for the agent to acknowledge the event/thread/message exists without giving the operator (or the agent on a later turn) the body content. for Gmail, even the label NAME is hashed in the placeholder because label names themselves can be revealing ("HR—termination", "doctor", "lawyer—divorce").

## per-capability behavior

### Calendar

google calendar has a native `visibility` field on every event. values: `default`, `public`, `private`, `confidential`. `default` inherits the calendar's own default visibility, which is also queryable.

filter rule:

| condition                                                               | decision                       |
|-------------------------------------------------------------------------|--------------------------------|
| event.visibility === `'private'` or `'confidential'`                    | `{ persist: false }`           |
| event.visibility === `'default'` AND calendarDefaultVisibility !== `'private'` | `{ persist: true }`            |
| event.visibility === `'default'` AND calendarDefaultVisibility === `'private'` | `{ persist: false }`           |
| event.visibility === `'public'`                                         | `{ persist: true }`            |
| user has `calendar.gateAllByDefault: true` in privacy config           | `{ persist: false }` regardless of visibility (opt-in stricter mode) |

the calendar default visibility is fetched once per user per session via `calendarSettings.get('defaultEventVisibility')` and cached in the privacy config row. the periodic re-prompt re-fetches and surfaces drift to the user.

### Gmail

gmail has two relevant signals: labels (system + user-defined) and recipient addresses. neither is a direct "private" flag, so the filter's primary input is the user's privacy config:

```ts
interface GmailPrivacyConfig {
  privateLabels: string[];          // labels whose threads are gated. e.g. ['Private', 'HR', 'Personal']
  denyListedAddresses: string[];    // emails whose presence on a thread gates the whole thread
  threadingMode: 'conservative';    // if any message in the thread matches a deny rule, the whole thread gates
}
```

filter rule for a Gmail tool result that returned a thread or message:

| condition                                                                                | decision                       |
|------------------------------------------------------------------------------------------|--------------------------------|
| any message in the thread has a label in `privateLabels`                                 | `{ persist: false, reason: 'private_label' }` |
| any message's `From`/`To`/`Cc`/`Bcc` matches a `denyListedAddresses` entry              | `{ persist: false, reason: 'address_deny_listed' }` |
| neither matches                                                                          | `{ persist: true }`            |

threading rule: conservative-by-default. tino's gmail tools usually return a thread with N messages. if even one message in the returned thread matches a deny rule, the whole thread gates. this is the user's expectation ("if my therapist is on a thread, the whole thread is private") and avoids leaking inferred information ("the thread starts with someone else but the deny-listed person joined at message 5").

### Slack

slack has no native sensitivity flag for a DM. the filter's input is the user's deny-list:

```ts
interface SlackPrivacyConfig {
  denyListedConversationIds: string[];  // channel/DM/MPDM ids that gate
  denyListedUserIds: string[];           // user ids; any DM with this user (1:1 or MPIM) gates
  multiPartyMode: 'conservative';        // any deny-listed user in a multi-party DM gates the whole convo
}
```

filter rule for a Slack tool result that returned messages from a conversation:

| condition                                                                                  | decision                       |
|--------------------------------------------------------------------------------------------|--------------------------------|
| `result.channelId ∈ denyListedConversationIds`                                              | `{ persist: false, reason: 'deny_listed_dm' }` |
| any participant in the conversation `∈ denyListedUserIds`                                   | `{ persist: false, reason: 'deny_listed_dm' }` |
| neither matches                                                                             | `{ persist: true }`            |

multi-party DMs (MPIMs) follow conservative semantics: if alice has bob on her deny-list and bob is in a 5-person MPIM with alice, the entire MPIM is gated for alice. this is the asymmetric posture — alice's privacy boundaries apply to alice's history; bob's MPIM history is governed by bob's own deny-list independently.

## onboarding flow

new users hit the console for the first time after wave-3 auto-provisioning (or admin-add). the onboarding gate middleware checks `user.privacy_setup_completed_at`; if null, every non-onboarding route redirects to `/onboarding`. four steps, each per-capability. the user MUST complete or explicitly skip each connected capability before reaching the main console.

step 1 — Gmail (only shown if user has connected Gmail):
- fetch top 15 user-defined labels by message count (read-only Gmail API call).
- fetch top 15 contacts by recent message volume (read-only).
- pre-check labels with names matching common privacy keywords (configurable regex; defaults: `/private|personal|hr|legal|medical|doctor|therapy|family|finance|tax/i`).
- pre-check contacts whose addresses match the same regex applied to local-parts.
- user reviews, deselects any false positives, adds entries by typing.
- submit → writes to `gmail.privateLabels` and `gmail.denyListedAddresses` in privacy config.

step 2 — Slack (only shown if user has connected slack-personal):
- fetch top 15 DM conversations by recent message volume (read-only `conversations.list` + `conversations.history` for ordering signal).
- pre-check conversations whose other participant's display name matches the privacy regex.
- user reviews, deselects, adds.
- submit → writes to `slack.denyListedConversationIds` and `slack.denyListedUserIds`.

step 3 — Calendar (only shown if user has connected calendar):
- fetch calendar default visibility.
- if it's not `'private'`, show a "your default visibility is `<value>` — events without an explicit `visibility` setting will be persisted in tino's history. you can change this in google calendar settings; tino can also gate everything by default if you prefer."
- offer toggle: `calendar.gateAllByDefault` (default off; turning it on means every calendar tool result gates regardless of source-side `visibility`).
- submit.

step 4 — completion:
- show a summary of what's gated, what's persisted, and the privacy claim text.
- "you can change any of this in Settings → Privacy at any time. tino will also re-prompt you periodically when it notices new contacts/conversations/labels."
- click "complete" → sets `user.privacy_setup_completed_at = now()` → main console unlocks.

re-entry: `/settings/privacy` lets the user re-do any step. saving from settings triggers a retroactive scrub for any new deny-list additions.

## tino-assisted setup tools

five tools, exposed only when the user has connected the corresponding capability AND has completed onboarding (so the agent can refer to the user's existing privacy config). the user invokes them via DM ("tino, audit my gmail filters" or "tino, suggest events i should mark private").

### `gmail_create_privacy_filter`

creates a server-side Gmail filter rule that auto-applies a label to incoming messages from a sender or matching a query. tino uses this to operationalize "anything from your therapist gets the `Private` label automatically going forward."

input: `{ from?: string, query?: string, addLabel: string, confirm?: boolean }`. mutates Gmail. requires approval (wave 5) or explicit `confirm: true`.

### `gmail_audit_filters`

read-only. lists all of the user's Gmail filters and surfaces "filters that look privacy-related" (regex match on label name) plus "filters where tino-relevant labels are missing" — e.g., the user has a `Private` label in their privacy config but no auto-apply filter, so messages only get labeled when the user does it manually.

input: `{}`. output: `{ filters: GmailFilter[], suggestions: AuditSuggestion[] }`.

### `calendar_check_defaults`

read-only. returns the user's calendar default visibility, lists the user's calendars, and flags any calendar whose default is not `private` if the user has elected `gateAllByDefault: false`.

input: `{}`. output: `{ defaultVisibility: string, calendars: CalendarSettings[], warnings: string[] }`.

### `calendar_suggest_private`

read-only. scans the user's recent calendar events (last 30 days, configurable) looking for events whose title or attendees match the privacy regex, then returns "events you might consider marking private going forward." tino does NOT auto-mark them — calendar editing is user-side mutation; tino suggests, the user clicks through in google calendar.

input: `{ daysBack?: number }`. output: `{ suggestions: { eventId, title, reason }[] }`.

### `slack_audit_dms`

read-only. lists the user's recent DM conversations, flags ones whose participant matches the privacy regex AND is not currently in the deny-list. surfaces as "you've been DMing X regularly; X looks like a private contact (matches `therapist`); want to add X to your slack deny-list?"

input: `{ daysBack?: number }`. output: `{ suggestions: { conversationId, participantName, reason }[] }`.

### tone

these tools' system-prompt fragments emphasize "tino is helping the user configure source-side privacy." not "tino is auditing the user." the agent surfaces suggestions, the user accepts or declines. agency stays with the user.

## data model

### `USER#<tinoUserId>#PRIVACY_CONFIG`

| pk                                  | sk                                  | shape                                                                 |
|-------------------------------------|-------------------------------------|-----------------------------------------------------------------------|
| `USER#<tinoUserId>#PRIVACY_CONFIG`  | `USER#<tinoUserId>#PRIVACY_CONFIG`  | `{ encryptedConfig: EnvelopeCiphertext, updatedAt: number, version: 1 }` |

the `encryptedConfig` envelope decrypts to:

```ts
interface PrivacyConfig {
  version: 1;
  gmail?: {
    privateLabels: string[];
    denyListedAddresses: string[];
    threadingMode: 'conservative';
  };
  slack?: {
    denyListedConversationIds: string[];
    denyListedUserIds: string[];
    multiPartyMode: 'conservative';
  };
  calendar?: {
    defaultVisibility: 'default' | 'public' | 'private' | 'confidential';
    gateAllByDefault: boolean;
  };
  // last time the user explicitly reviewed/saved their privacy config from the settings page
  lastReviewedAt: number;
  // last time tino surfaced a periodic re-prompt
  lastRepromptAt: number | null;
}
```

`EncryptionContext={ userId: <tinoUserId>, capabilityId: 'privacy_config', fieldName: 'config' }` — wave 2's encryption baseline applies. one envelope per write.

### `user.privacy_setup_completed_at` (column on better-auth user table extension)

`number | null`. null until the user submits the onboarding flow's final step. read by the onboarding gate middleware on every authenticated request.

### audit log additions

three new audit actions:

- `'privacy_config_change'` — user modified their privacy config. fields: `{ userId, before: PrivacyConfigDelta, after: PrivacyConfigDelta }`. delta is the field-level diff, not the full config (don't double-store).
- `'privacy_scrub'` — retroactive scrub completed. fields: `{ userId, capability, rowsScanned, rowsScrubbed, durationMs }`.
- `'privacy_setup_completed'` — onboarding completion. fields: `{ userId }`.

wave 4's audit viewer is what surfaces these to admins (admins) and to the user (members see their own privacy events).

## retroactive scrub

trigger: any save to the privacy config that ADDS to a deny-list (adds a label, address, conversation id, user id, OR enables `gateAllByDefault`). config saves that REMOVE entries don't trigger scrubs (data that was previously gated stays gated; un-gating future tool results is enough).

flow:

1. user saves privacy config update → server computes delta → if delta is additive, enqueue scrub job with `{ userId, addedRules }`.
2. scrub job scans `HISTORY#<userId>` partition for rows where `tool` is in `{ gmail, slack-personal, calendar }`.
3. for each row: decrypt the persisted body, re-evaluate the new privacy filter against `(capability, args, result)`. if the new filter says `persist: false`, build the placeholder, re-encrypt, write back to the same `pk/sk`.
4. count `rowsScrubbed`, write `'privacy_scrub'` audit entry.
5. SLA: scrub completes within 60s for typical history sizes (≤ 10k rows). larger histories paginate; one audit entry per page.

idempotency: re-running the scrub against the same delta is safe — rows already replaced with placeholders re-evaluate to "still gated" and the placeholder is rewritten identically (same `metadata` because `eventId`/`threadId`/`channelId` are derived from `args`/`result` not the body).

## periodic re-prompts

scheduled task (default cadence: weekly): for each user, run a small audit:

- gmail: are there labels the user has applied N+ times in the last week that aren't in their `privateLabels` and match the privacy regex? are there contacts the user has been emailing N+ times that aren't in their `denyListedAddresses` and match the regex?
- slack: same for DMs and DM participants.
- calendar: did the user's calendar default visibility change?

if any signals fire, write a "privacy noticed" record. the console's main page shows a dismissable card: "tino noticed 3 new contacts that look privacy-relevant. review →". clicking opens settings → privacy with the suggestions pre-selected.

cadence is configurable per user (`weekly | biweekly | monthly | off`). default `weekly`.

slack-side surfacing of these re-prompts (e.g., a tino DM "i noticed N new contacts; reply LATER to dismiss") is OUT OF SCOPE for wave 3.5. console-only for now. (open question 6 in main.md.)

## file-level changes

### `packages/core/src/privacy/types.ts` (NEW, ~80 LOC)

defines `PrivacyConfig`, `Decision`, `PrivacyFilter`, `ToolResultPlaceholder`. exports the discriminated unions.

```ts
export interface PrivacyConfig { /* see Data model */ }

export type ToolResultPlaceholder = {
  type: 'redacted';
  reason: 'private_event' | 'private_label' | 'deny_listed_thread' | 'deny_listed_dm' | 'address_deny_listed';
  metadata: { /* see Architecture overview */ };
};

export type Decision =
  | { persist: true }
  | { persist: false; placeholder: ToolResultPlaceholder };

export interface PrivacyFilter {
  evaluate(args: {
    capabilityId: string;
    toolName: string;
    toolArgs: unknown;
    toolResult: unknown;
    config: PrivacyConfig | null;
  }): Decision;
}
```

### `packages/core/src/privacy/filter.ts` (NEW, ~60 LOC)

orchestrator. routes by capability id to the per-capability filter modules. SYSTEM user and shared capabilities short-circuit to `{ persist: true }`.

```ts
export function createPrivacyFilter(deps: {
  capabilities: { calendar: CapabilityFilter; gmail: CapabilityFilter; slack: CapabilityFilter };
}): PrivacyFilter {
  return {
    evaluate({ capabilityId, toolArgs, toolResult, config }) {
      if (capabilityId === 'gmail') return deps.capabilities.gmail(toolArgs, toolResult, config?.gmail);
      if (capabilityId === 'slack-personal') return deps.capabilities.slack(toolArgs, toolResult, config?.slack);
      if (capabilityId === 'calendar') return deps.capabilities.calendar(toolArgs, toolResult, config?.calendar);
      // shared capabilities and SYSTEM runs reach here
      return { persist: true };
    },
  };
}
```

### `packages/core/src/privacy/calendar.ts` (NEW, ~70 LOC)

calendar filter implementing the table from "Per-capability behavior → Calendar". pure function. branch coverage: each row of the table is one branch + one test.

### `packages/core/src/privacy/gmail.ts` (NEW, ~100 LOC)

gmail filter. helpers for label-match (case-insensitive set membership) and address-match (case-insensitive normalized comparison, supports plus-addressing and dots-in-localpart per gmail rules). threading rule: scan all messages in the thread, return `persist: false` on first hit.

### `packages/core/src/privacy/slack.ts` (NEW, ~70 LOC)

slack filter. handles 1:1 DMs (channel id starts with `D`), MPIMs (`G`), and channels (`C`). conservative multi-party rule: if any participant id is in `denyListedUserIds`, gate.

### `packages/core/src/privacy/config-store.ts` (NEW, ~120 LOC)

read/write the `USER#<userId>#PRIVACY_CONFIG` row. uses `CryptoAdapter` from wave 2.

```ts
export interface PrivacyConfigStore {
  get(tinoUserId: string): Promise<PrivacyConfig | null>;
  set(tinoUserId: string, config: PrivacyConfig): Promise<void>;
  /** Returns the delta between current and proposed config; used to compute scrub triggers. */
  computeDelta(current: PrivacyConfig | null, proposed: PrivacyConfig): PrivacyConfigDelta;
  isAdditive(delta: PrivacyConfigDelta): boolean;
}
```

dynamo-backed (production) and sqlite-backed (local dev) adapters mirror the wave-2 user-capabilities store pattern.

### `packages/core/src/privacy/scrub.ts` (NEW, ~150 LOC)

retroactive scrub job. exposed as `runScrub(userId, addedRules)`. paginates `HISTORY#<userId>`, decrypts each row, re-evaluates filter, re-encrypts placeholder if filter now gates, writes back via conditional update. emits `'privacy_scrub'` audit entry on completion.

```ts
export async function runScrub(deps: {
  userId: string;
  addedRules: PrivacyConfigDelta;
  history: HistoryStore;
  filter: PrivacyFilter;
  config: PrivacyConfig;
  audit: AuditLogger;
  logger: AppLogger;
}): Promise<{ rowsScanned: number; rowsScrubbed: number; durationMs: number }>;
```

### `packages/core/src/agent/history-appender.ts` (MODIFIED)

replace the wave-2 default-allow filter with the real `privacyFilter` from `privacy/filter.ts`. inject `privacyConfigStore` so the appender can fetch the user's config on each call (cached per-runAgent-call, since one run produces multiple tool results and the config doesn't change mid-run).

```ts
// wave 2 (before)
const privacyFilter: PrivacyFilter = { evaluate: () => ({ persist: true }) };

// wave 3.5 (after)
const privacyFilter = createPrivacyFilter({ capabilities: { gmail, slack, calendar } });

// per-run config fetch (one PrivacyConfigStore.get per runAgent invocation, threaded through)
```

if the feature flag `privacy.filterEnabled === false`, fall back to the wave-2 default-allow filter. flag default: on.

### `packages/core/src/server/routes/privacy.ts` (NEW, ~120 LOC)

privacy config CRUD.

- `GET /api/privacy/config` — returns the requesting user's `PrivacyConfig` (decrypted).
- `PUT /api/privacy/config` — saves new config; computes delta; enqueues scrub if additive; writes audit entry.
- `POST /api/privacy/scrub` — manually trigger a re-scrub against current config (idempotent; useful after a regex/default change).

every route resolves the requesting user via the wave-3 auth middleware.

### `packages/core/src/server/routes/onboarding.ts` (NEW, ~200 LOC)

onboarding pre-population + completion.

- `GET /api/onboarding/gmail/labels` — top 15 labels with pre-check flags.
- `GET /api/onboarding/gmail/contacts` — top 15 contacts with pre-check flags.
- `GET /api/onboarding/slack/dms` — top 15 DM conversations with pre-check flags.
- `GET /api/onboarding/calendar/visibility` — calendar default visibility + per-calendar settings.
- `POST /api/onboarding/complete/<capabilityId>` — submit per-capability config (gmail | slack | calendar).
- `POST /api/onboarding/finalize` — flips `user.privacy_setup_completed_at = now()`. requires all connected capabilities to have submitted.

### `packages/core/src/server/middleware/onboarding-gate.ts` (NEW, ~30 LOC)

```ts
export function onboardingGate(): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    if (c.req.path.startsWith('/onboarding')) return next();
    if (c.req.path.startsWith('/api/onboarding')) return next();
    if (c.req.path.startsWith('/api/auth')) return next();
    const user = c.get('user');
    if (user.privacy_setup_completed_at == null) {
      // browser routes redirect; API routes 403
      if (c.req.path.startsWith('/api/')) return c.json({ error: 'onboarding_required' }, 403);
      return c.redirect('/onboarding');
    }
    await next();
  };
}
```

attached to every console route that's not in the allowlist above.

### `packages/core/console-app/src/pages/onboarding/*` (NEW, ~600 LOC across 5 files)

- `GmailStep.tsx` — labels + contacts checklists, pre-populated.
- `SlackStep.tsx` — DM conversations checklist, pre-populated.
- `CalendarStep.tsx` — default visibility display + `gateAllByDefault` toggle.
- `Completion.tsx` — summary + privacy claim text + "complete" button.
- `OnboardingShell.tsx` — step navigation, progress indicator, can't-skip enforcement.

### `packages/core/console-app/src/pages/settings/Privacy.tsx` (NEW, ~250 LOC)

re-entry settings page. mirrors the onboarding steps but allows partial saves and triggers retroactive scrubs on additive changes.

### `packages/core/src/tools/privacy_setup/*` (NEW, 5 files, ~80 LOC each)

- `gmail_create_privacy_filter.ts`
- `gmail_audit_filters.ts`
- `calendar_check_defaults.ts`
- `calendar_suggest_private.ts`
- `slack_audit_dms.ts`

each is a `ToolDefinition` consumed by the agent's tool registry. tools that mutate (only `gmail_create_privacy_filter`) follow the wave-5 approval contract or fall back to `confirm: true` if wave 5 hasn't shipped.

registered via the Gmail / Slack / Calendar capability modules' `buildToolsForUser` factories so they only appear in the toolset when the user has connected the corresponding capability AND has completed onboarding.

### `packages/core/src/scheduler/privacy-reprompt.ts` (NEW, ~150 LOC)

scheduled task. cadence configurable per user. runs the re-prompt audit and writes "privacy noticed" records to a new `USER#<tinoUserId>#PRIVACY_REPROMPT` partition. console renders open re-prompts as dismissable cards.

### `packages/core/src/logging/redaction.ts` (MODIFIED, ~50 added LOC)

extend the existing pino redaction config:

```ts
const PRIVATE_CAPABILITY_IDS = new Set(['gmail', 'slack-personal', 'calendar']);

export function logToolResult(logger: AppLogger, ctx: { capabilityId: string; toolName: string }, result: unknown) {
  if (PRIVATE_CAPABILITY_IDS.has(ctx.capabilityId)) {
    // never log the body of a private-capability tool result, regardless of privacy filter outcome
    logger.info({ tool: ctx.toolName, capability: ctx.capabilityId, body: '<redacted: private capability>' }, 'tool result');
    return;
  }
  logger.info({ tool: ctx.toolName, capability: ctx.capabilityId, body: result }, 'tool result');
}
```

every existing call to `logger.info(... toolResult)` is replaced with `logToolResult(...)`. lint rule (eslint custom rule, ~30 LOC) blocks raw `logger.info` calls that include a known tool-result variable name (`result`, `toolResult`) — defense against future drift.

### `docs/privacy.md` (NEW, ~150 LOC)

the writable privacy claim. structure:

- what tino persists (and what it doesn't).
- the per-capability rules (calendar / gmail / slack).
- the user-managed deny-list.
- the threat model — explicitly: "tino's operator (austin, on the kayn deployment) cannot read the body of a tool result that the privacy filter gated. they CAN still read placeholder metadata and history rows from non-gated tool results. for cryptographic defense against the operator, see the future cold-path vault (PROBLEM.md option 3, deferred)."
- residuals (the five from "what this design does not solve" below) with mitigation pointers.

written so it's the user-facing document an end-user reads to understand what tino does with their data. linked from the onboarding completion step.

## acceptance criteria

```plan-state
- [ ] id: a1
  intent: The Calendar privacy filter gates events whose source-side visibility is private or confidential, and gates default-visibility events when the calendar's default itself is private. Public events and explicit default-with-non-private-default pass through. The user-level gateAllByDefault opt-in gates everything when on.
  tests:
    - tests/privacy/calendar-filter.test.ts::"private visibility gates"
    - tests/privacy/calendar-filter.test.ts::"confidential visibility gates"
    - tests/privacy/calendar-filter.test.ts::"default visibility with private calendar default gates"
    - tests/privacy/calendar-filter.test.ts::"default visibility with public calendar default persists"
    - tests/privacy/calendar-filter.test.ts::"public visibility persists"
    - tests/privacy/calendar-filter.test.ts::"gateAllByDefault gates regardless of source visibility"
  verify: bun run test tests/privacy/calendar-filter.test.ts

- [ ] id: a2
  intent: The Gmail privacy filter gates threads where any message has a label in privateLabels, or where any participant address is in denyListedAddresses. Conservative threading: one matching message gates the whole thread.
  tests:
    - tests/privacy/gmail-filter.test.ts::"thread with private label gates"
    - tests/privacy/gmail-filter.test.ts::"thread with deny-listed sender gates"
    - tests/privacy/gmail-filter.test.ts::"thread with deny-listed cc gates"
    - tests/privacy/gmail-filter.test.ts::"thread where matching message is mid-thread gates whole thread"
    - tests/privacy/gmail-filter.test.ts::"thread with no matches persists"
    - tests/privacy/gmail-filter.test.ts::"label matching is case-insensitive"
    - tests/privacy/gmail-filter.test.ts::"address matching normalizes plus-addressing"
  verify: bun run test tests/privacy/gmail-filter.test.ts

- [ ] id: a3
  intent: The Slack privacy filter gates conversations whose id is deny-listed and conversations where any participant is deny-listed. Conservative multi-party: one deny-listed participant gates the whole MPIM.
  tests:
    - tests/privacy/slack-filter.test.ts::"deny-listed conversation id gates"
    - tests/privacy/slack-filter.test.ts::"deny-listed user in 1:1 DM gates"
    - tests/privacy/slack-filter.test.ts::"deny-listed user in MPIM gates whole MPIM"
    - tests/privacy/slack-filter.test.ts::"non-deny-listed conversation persists"
  verify: bun run test tests/privacy/slack-filter.test.ts

- [ ] id: a4
  intent: The history writer's seam is wired to the real privacy filter. Tool results that the filter gates are persisted as the metadata-only placeholder; non-gated results persist as bodies. The seam is the single path through which tool results enter HISTORY.
  tests:
    - tests/agent/history-appender.test.ts::"private calendar event persists as placeholder"
    - tests/agent/history-appender.test.ts::"non-private gmail thread persists with body"
    - tests/agent/history-appender.test.ts::"placeholder contains expected metadata fields"
    - tests/agent/history-appender.test.ts::"placeholder reason matches filter decision"
    - tests/agent/history-appender.test.ts::"feature flag off restores wave-2 default-allow behavior"
  verify: bun run test tests/agent/history-appender.test.ts

- [ ] id: a5
  intent: PrivacyConfigStore stores per-user privacy config encrypted with userId encryption context. Get returns plaintext config. Different users' configs are isolated. Decryption with mismatched userId fails.
  tests:
    - tests/privacy/config-store.test.ts::"set then get round-trips plaintext config"
    - tests/privacy/config-store.test.ts::"different users do not share privacy config"
    - tests/privacy/config-store.test.ts::"decrypt with wrong userId encryption context fails"
  verify: bun run test tests/privacy/config-store.test.ts

- [ ] id: a6
  intent: The retroactive scrub re-evaluates persisted history rows under a new (additive) privacy config and overwrites bodies with placeholders. Idempotent. Emits an audit entry on completion.
  tests:
    - tests/privacy/scrub.test.ts::"adding a label scrubs prior matching threads to placeholders"
    - tests/privacy/scrub.test.ts::"removing from deny-list does not unscrub previously-gated rows"
    - tests/privacy/scrub.test.ts::"second scrub run is idempotent"
    - tests/privacy/scrub.test.ts::"scrub completion writes a privacy_scrub audit entry"
  verify: bun run test tests/privacy/scrub.test.ts

- [ ] id: a7
  intent: The onboarding gate redirects new users to /onboarding until privacy_setup_completed_at is set. API routes return 403 with onboarding_required. The /api/auth/* and /onboarding/* paths bypass the gate.
  tests:
    - tests/server/onboarding-gate.test.ts::"user with null privacy_setup_completed_at is redirected to /onboarding"
    - tests/server/onboarding-gate.test.ts::"user with completed onboarding reaches main console"
    - tests/server/onboarding-gate.test.ts::"api routes return 403 when onboarding incomplete"
    - tests/server/onboarding-gate.test.ts::"/api/auth/* routes bypass the gate"
    - tests/server/onboarding-gate.test.ts::"/onboarding/* routes bypass the gate"
  verify: bun run test tests/server/onboarding-gate.test.ts

- [ ] id: a8
  intent: Onboarding pre-population queries return reasonable results against fixture Gmail / Slack / Calendar data, with sensible defaults for the privacy regex pre-checks.
  tests:
    - tests/server/onboarding-routes.test.ts::"gmail labels pre-population includes top 15 labels with privacy regex flags"
    - tests/server/onboarding-routes.test.ts::"gmail contacts pre-population includes top 15 contacts with flags"
    - tests/server/onboarding-routes.test.ts::"slack dms pre-population includes top 15 conversations with flags"
    - tests/server/onboarding-routes.test.ts::"calendar visibility query returns default and per-calendar settings"
    - tests/server/onboarding-routes.test.ts::"finalize requires every connected capability submitted"
  verify: bun run test tests/server/onboarding-routes.test.ts

- [ ] id: a9
  intent: Tino-assisted setup tools are registered when the user has the corresponding capability connected and has completed onboarding. Mutation tool requires approval (wave 5) or explicit confirm.
  tests:
    - tests/tools/privacy-setup.test.ts::"gmail_create_privacy_filter requires confirm or approval"
    - tests/tools/privacy-setup.test.ts::"gmail_audit_filters runs read-only without approval"
    - tests/tools/privacy-setup.test.ts::"calendar_check_defaults runs read-only without approval"
    - tests/tools/privacy-setup.test.ts::"calendar_suggest_private runs read-only without approval"
    - tests/tools/privacy-setup.test.ts::"slack_audit_dms runs read-only without approval"
    - tests/tools/privacy-setup.test.ts::"tools are not registered until onboarding is complete"
  verify: bun run test tests/tools/privacy-setup.test.ts

- [ ] id: a10
  intent: CloudWatch / pino log output never contains the body of a private-capability tool result. Verified by running each private tool against fixtures, capturing log output, and asserting no body content appears.
  tests:
    - tests/integration/cloudwatch-lockdown.test.ts::"gmail tool result body never appears in log output"
    - tests/integration/cloudwatch-lockdown.test.ts::"calendar tool result body never appears in log output"
    - tests/integration/cloudwatch-lockdown.test.ts::"slack-personal tool result body never appears in log output"
    - tests/integration/cloudwatch-lockdown.test.ts::"shared capability tool results may appear in logs"
  verify: bun run test tests/integration/cloudwatch-lockdown.test.ts

- [ ] id: a11
  intent: Periodic re-prompts surface in the console as dismissable cards when tino notices new contacts/conversations/labels matching the privacy regex.
  tests:
    - tests/scheduler/privacy-reprompt.test.ts::"new contact matching regex emits a reprompt"
    - tests/scheduler/privacy-reprompt.test.ts::"new dm participant matching regex emits a reprompt"
    - tests/scheduler/privacy-reprompt.test.ts::"calendar default visibility change emits a reprompt"
    - tests/scheduler/privacy-reprompt.test.ts::"reprompt cadence honors per-user setting"
  verify: bun run test tests/scheduler/privacy-reprompt.test.ts

- [ ] id: a12
  intent: All existing tests continue to pass.
  tests:
    - "*"
  verify: bun run test
```

## test plan

- unit tests for each filter (calendar/gmail/slack) covering each branch of each table in "Per-capability behavior". target: 17+ test cases.
- integration test for `historyAppender`: feed real tool results through the writer, assert persisted rows match expectations (body vs placeholder).
- `PrivacyConfigStore` round-trip + cross-user-decrypt-rejection (mirrors wave 2's a6).
- retroactive scrub end-to-end: seed history, save additive config, await scrub completion, assert rows are scrubbed and audit entry written.
- onboarding gate middleware tests (5 paths).
- onboarding pre-population tests against fixture data for Gmail / Slack / Calendar.
- assisted-setup tools: each tool's read-only or approval-gated behavior.
- **CloudWatch lockdown test (mandatory CI):** for each of the 3 private capabilities, run a representative tool against fixture data, capture the log output of the test run, and grep-assert that no body content appears. CI gates merge if this test fails.
- periodic re-prompt scheduler tests with mocked source data and configurable regex.
- existing suite passes.
- **manual verification post-deploy:**
  - admin DMs tino "what's on my calendar today" with a meeting marked private → tino responds in the moment, but the next agent run shows only the placeholder ("you had a private event at 3pm").
  - admin adds an address to gmail deny-list → admin DMs tino "summarize my latest email from <address>" → tino can't see prior content; the deny-list is enforced going forward; prior history rows show placeholders after the scrub.
  - admin checks `docs/privacy.md` matches what they actually expect tino to do.

## non-goals

- **the cold-path vault from PROBLEM.md option 3** — this design defends against operator-readable history bodies but does not provide cryptographic defense against the operator (Threat A). the vault is a future opt-in upgrade. wave 3.5 explicitly does NOT block on it.
- **per-field isolation within a tool result** (e.g., persist titles but not descriptions) — `product.md` defers to v3. the placeholder is whole-body; finer-grained masking is future work.
- **auto-modification of calendar event visibility** — `calendar_suggest_private` returns suggestions; the user clicks through in google calendar to mark events. tino does not auto-mutate calendar events.
- **slack-side surfacing of periodic re-prompts** — wave 3.5 ships the console surface only. slack DM surfacing is a follow-up. (open question 6 in main.md.)
- **cross-user "ask user X for permission to read their data" flows** (PROBLEM.md variant 3) — out of scope. future feature.
- **privacy regex localization beyond the configurable default list** — wave 3.5 ships a small initial English-language regex set; long-term a public default list lives in `docs/privacy.md` and the user can extend via console. (open question 7 in main.md.)
- **changes to wave 0/1/2/3/4/5 surface area** — wave 3.5 hooks into the wave-2 history-writer seam and the wave-3 multi-user dispatch but does not modify them otherwise.

## rollback story

wave 3.5 is additive and feature-flagged at four independent gates. all four default on; rollback toggles them off:

| flag                              | default | rollback effect                                                                              |
|-----------------------------------|---------|----------------------------------------------------------------------------------------------|
| `privacy.filterEnabled`           | `true`  | history writer falls back to wave-2 default-allow filter; tino persists every tool result   |
| `privacy.onboardingGateEnabled`   | `true`  | new users skip the gate and reach the main console; pre-existing users unaffected           |
| `privacy.assistedSetupEnabled`    | `true`  | the 5 tino-assisted setup tools are not registered                                          |
| `privacy.scrubEnabled`            | `true`  | additive deny-list saves still gate future tool results but no retroactive scrub runs        |

with all four flags off, tino behaves exactly as it did at the end of wave 3 — multi-user with no source-respecting privacy enforcement. the privacy config row exists but has no enforcement effect. this is the rollback path if any wave 3.5 component misbehaves; ship with all four on by default.

forward-only changes:
- the audit log gains three new actions (`'privacy_config_change'`, `'privacy_scrub'`, `'privacy_setup_completed'`). these are additive — wave 4's viewer renders unknown actions gracefully.
- the better-auth user table extension gains `privacy_setup_completed_at`. additive column. NULL for pre-existing users; the gate flag covers them when off.

## open questions

these are the residuals from "what this design does not solve" — accepted costs that the executor surfaces in code comments and in `docs/privacy.md`.

1. **credentials remain operator-readable (with audit).** wave 2's posture: KMS-decryptable by the ECS task role with the right encryption context. austin (as account admin) can call `Decrypt` directly. unchanged by wave 3.5. defended by audit visibility (CloudTrail) but not cryptographically. flag in `docs/privacy.md`.
2. **hot-path plaintext during agent runs.** tool results materialize as plaintext in the runAgent process and in the bedrock request. memory snapshots, debug heap dumps, or a compromised application process can read them. accepted residual; mitigated by IAM least-privilege on who can attach a debugger to the ECS task. flag in code comment at the top of `history-appender.ts`.
3. **CloudWatch logging is the most likely silent failure.** a future refactor adds a `logger.info(...result)` in the wrong place and leaks body content to CloudWatch — a place that survives long after the dynamodb history row is scrubbed. mitigation: the lockdown test in a10 is mandatory CI; the eslint custom rule catches drift at commit time. open question for follow-up: should CloudWatch logs also have a TTL aligned with the privacy posture? (currently retention is 90 days; arguably should be shorter for any log group that touches private capabilities.)
4. **reactive deny-list with first-conversation persistence window.** the user adds someone to the deny-list AFTER tino has already persisted a thread with them. the scrub fixes that going forward. but until the user explicitly adds the entry, the first conversation persists. mitigated by:
   - onboarding pre-population (catches privacy-relevant contacts/conversations BEFORE they're used)
   - periodic re-prompts (catches new ones soon after they appear)
   not eliminated; flag in `docs/privacy.md` as the explicit residual.
5. **multi-recipient threading conservatism.** the gmail filter gates the whole thread on any matching message. cost: a 50-message thread where one message contains the deny-listed person leaks no thread content even when the rest is benign. accepted as the safer default.

operational open questions (resolvable during implementation):

- **scrub job concurrency.** if a user saves config twice in quick succession, two scrub jobs may run concurrently against the same `HISTORY#<userId>` partition. dynamodb conditional updates make per-row writes safe; the open question is whether to serialize per-user (a job lock keyed by `userId`) or accept dup work. recommendation: per-user lock with a 5-minute lease (sufficient for typical history sizes).
- **`privacyRegex` defaults.** wave 3.5 ships `/private|personal|hr|legal|medical|doctor|therapy|family|finance|tax/i` as the initial English-language default set. the executor confirms this isn't culturally narrow for the kayn-team users; long-term the public default list lives in `docs/privacy.md` (open question 7 in main.md).
- **how `slack_audit_dms` ranks "recent" conversations.** slack's `conversations.list` doesn't return per-conversation message counts directly. the implementation may need `conversations.history` per conversation, which is rate-limited. recommendation: cap audit at the user's top 30 1:1/MPIM conversations by `last_message.ts`, then rank by message count via `history` calls with `limit: 100`. flag if rate-limit pressure surfaces.
