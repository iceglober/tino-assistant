# wave 3: multi-user slack DM + per-user agent dispatch

drop the `ALLOWED_SLACK_USER_ID` hard gate in the slack DM handler. replace it with a user-table check using the identity resolver from wave 0. support two modes — **allowlist** (only users in the user table can DM, others are rejected with "ask your admin") and **org-domain** (any slack user whose email domain matches the configured org is auto-provisioned on first DM). thread the requesting user's tino-UUID through every `runAgent` call site, so each user's agent run uses their own per-user private toolset (which wave 2 made real). also: move better-auth sessions from `/tmp/tino-auth.db` to a dynamodb-backed `secondaryStorage` so N teammates don't get force-logged-out on every ECS restart. **this is the wave that lets your teammates DM tino.** **wave 3.5 makes the privacy story complete; without it, multi-user tino persists everything to history regardless of source-side sensitivity.**

## why this comes fourth

waves 0-2 built the foundation. wave 3 turns it on. shipping wave 3 before wave 2 would mean teammates' first DM uses the bot owner's gmail token (because per-user storage didn't exist yet) — exactly the bug we're trying to prevent. shipping wave 3 before wave 0 is impossible — there's no resolver. wave 3 is the first wave with user-visible new behavior for anyone other than the bot owner.

## constraints

- **default mode is allowlist.** new deployments get `accessControl.mode: 'allowlist'` in the org config. only the bootstrap admin (resolved from `ALLOWED_SLACK_USER_ID`) is in the user table at first DM. subsequent users are added by an admin via the console (wave 4 ships the UI; wave 3 ships an admin-only API endpoint).
- **org-domain mode is opt-in.** `accessControl.mode: 'org-domain'` + `accessControl.orgDomain: 'kayn.ai'` enables auto-provisioning. an admin sets this via the console (wave 4 UI; wave 3 ships the API endpoint and uses it from the slack handler).
- **`runAgent` `userId` semantics change.** today it's the bot owner's slack id. after wave 3 it's the requesting user's tino-UUID. every call site is updated. existing per-user data (history/preferences/tasks) is read via the wave-0 fallback for the bot owner; for other users (who didn't exist before wave 3) there's no legacy data to fall back to.
- **the bootstrap admin behavior persists for one release** (D3). if the user table is empty at startup, the slack user named by `ALLOWED_SLACK_USER_ID` is auto-provisioned as admin. wave 0's migration already does this; wave 3 just verifies the invariant ("user table is never empty in deployed state") and logs deprecation when `ALLOWED_SLACK_USER_ID` is read.
- **session storage moves to dynamodb.** the better-auth `secondaryStorage` interface is documented (key-value get/set/delete with TTL). a thin adapter writes to the same dynamodb table under `pk=SESSION#<sessionId>`.
- **suspended users cannot DM.** the user table has a `status: 'active' | 'invited' | 'suspended'` field (defined in wave 0). only `'active'` users can DM tino. `'suspended'` returns "your access has been revoked." `'invited'` (a user added by an admin who hasn't logged into the console yet) treats the DM as activation — flips them to `'active'` and processes the DM normally.
- **the per-user runAgent dispatch is the precondition for per-user privacy config.** wave 3.5 hooks the privacy filter to `USER#<tinoUserId>#PRIVACY_CONFIG`; this row only becomes meaningful once each user is a real tino-UUID (wave 0) with their own credentials (wave 2) and their own dispatched runAgent run (wave 3). wave 3.5 is the next wave; nothing about wave 3 changes to accommodate it. between waves 3 and 3.5 the deployed state is multi-user DM with the wave-2 default-allow privacy filter still in place — flag in deployment notes; deliberate transitional state but should not linger in production.

## file-level changes

### `packages/core/src/persistence/config.ts` (no change)

reuse the existing config store. wave 3 adds new keys: `org.accessControl.mode` (`'allowlist' | 'org-domain'`) and `org.accessControl.orgDomain` (`string | undefined`). these are read at startup and on each DM. mutations flow through the wave-3 admin API.

### `packages/core/src/server/routes/org-config.ts` (NEW)

admin-only API for setting org-level config:
- `GET /api/org/access-control` — returns `{ mode, orgDomain }`
- `PUT /api/org/access-control` — admin-only; sets mode and orgDomain
- `POST /api/org/users` — admin-only; manually add a user by email + slack user id (allowlist mode workflow)
- `PATCH /api/org/users/:id/status` — admin-only; suspend or reactivate a user

middleware: a `requireAdmin` Hono middleware that resolves the requesting user, queries the user table, and rejects with 403 if `role !== 'admin'`. wave 4 also uses this; wave 3 ships it.

### `packages/core/src/server/middleware/auth.ts` (MODIFIED)

the auth middleware already stashes `c.get('user')` from better-auth's session. extend it to ALSO resolve the better-auth user → tino-UUID via `identityResolver.resolveGoogle(email)`, and stash:

```ts
type AuthVariables = {
  user: {
    id: string;          // tino-UUID (NOT better-auth's user.id)
    email: string;
    name?: string;
    role: 'admin' | 'member';
    status: 'active' | 'invited' | 'suspended';
    slackUserId?: string;
  };
};
```

if `resolveGoogle` returns null (a better-auth-authenticated user with no tino user record yet) and the email's domain matches the org-domain config, auto-provision a tino user (member role). otherwise 403 with "your account is not provisioned in tino — ask your admin."

if `status === 'suspended'`, 403 "your access has been revoked."

### `packages/core/src/server/middleware/require-admin.ts` (NEW)

```ts
export function requireAdmin(): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = c.get('user');
    if (user.role !== 'admin') {
      return c.json({ error: 'forbidden', message: 'admin role required' }, 403);
    }
    await next();
  };
}
```

attach to `/api/org/*` and `/api/audit/*` (wave 4 wires the audit routes).

### `packages/core/src/slack/app.ts` (MODIFIED — substantial)

the central change:

```ts
// before (line 47)
if (m.user !== env.ALLOWED_SLACK_USER_ID) {
  logger.warn({ user: m.user, channel: m.channel }, "rejected DM from non-allowlisted user");
  return;
}

// after
const tinoUserId = await resolveDmSender(m.user, { /* identityResolver, accessControl, slackClient, logger, auditLogger */ });
if (!tinoUserId) {
  // resolveDmSender already DMed the user the right rejection message and audited the rejection
  return;
}
const reply = await onDmFromUser(tinoUserId, m.text);  // signature changes from onDmFromOwner
await say({ text: toSlackMrkdwn(reply) });
```

`resolveDmSender(slackUserId, opts)` is the gate function:

```ts
async function resolveDmSender(slackUserId, opts): Promise<string | null> {
  // 1. Try the identity table.
  const existing = await opts.identityResolver.resolveSlack(slackUserId);
  if (existing) {
    const user = await opts.users.get(existing);
    if (user.status === 'suspended') {
      await opts.say({ text: 'your access to tino has been revoked. ask your admin if this is a mistake.' });
      await opts.auditLogger.log({ userId: existing, action: 'login', status: 'denied', errorMessage: 'suspended' });
      return null;
    }
    if (user.status === 'invited') {
      // First DM activates the invited user.
      await opts.users.update(existing, { status: 'active' });
    }
    return existing;
  }

  // 2. Not in identity table — check access mode.
  const ac = await opts.configStore.getTyped('org.accessControl', { mode: 'allowlist', orgDomain: undefined });
  if (ac.mode === 'allowlist') {
    await opts.say({ text: "i don't recognize you. ask your admin to add you to tino." });
    await opts.auditLogger.log({ userId: 'UNKNOWN_SLACK_USER', action: 'login', status: 'denied', errorMessage: `unknown slack user ${slackUserId}` });
    return null;
  }

  // 3. org-domain mode — try to auto-provision.
  try {
    const newUser = await opts.identityResolver.provisionFromSlack(slackUserId, { mode: 'org-domain', orgDomain: ac.orgDomain });
    await opts.auditLogger.log({ userId: newUser.id, action: 'login', status: 'success', errorMessage: 'auto-provisioned via org-domain' });
    return newUser.id;
  } catch (err) {
    if (err.code === 'unknown_user' || err.code === 'domain_mismatch') {
      await opts.say({ text: "i don't recognize you and your email domain doesn't match the configured org. ask your admin to add you to tino." });
      await opts.auditLogger.log({ userId: 'UNKNOWN_SLACK_USER', action: 'login', status: 'denied', errorMessage: err.code });
      return null;
    }
    throw err;
  }
}
```

note: `resolveDmSender` lives in a new file `packages/core/src/slack/resolve-dm-sender.ts` so it's testable in isolation. `app.ts` imports and calls it.

### `packages/core/src/index.ts` (MODIFIED)

three runAgent call sites change `userId` semantics:

- **slack DM handler (~line 184):** `userId: tinoUserId` (resolved from the slack DM sender). agent run uses the resolved user's history/preferences/private tools.
- **scheduler (~line 222):** `userId: task.userId` — already a tino-UUID after wave 0's migration.
- **find-work callback (line 84):** `userId: SYSTEM_USER_ID` — these runs use shared tools only. the resulting DM still goes to the deployment owner (today: `allowedUserId`; future: a designated admin user, but for wave 3 still the bot owner).

```ts
const userId = SYSTEM_USER_ID;
const privateTools = await registry.buildPrivateTools(userId);  // returns {} for SYSTEM
const tools = { ...registry.sharedTools, ...privateTools };
const activeCapabilities = await registry.getActiveCapabilities(userId);
// ...
```

### `packages/core/src/server/middleware/dynamo-session-store.ts` (NEW)

better-auth `secondaryStorage` adapter backed by dynamodb.

```ts
/**
 * better-auth secondaryStorage interface:
 *   get(key) → string | null
 *   set(key, value, ttl?) → void
 *   delete(key) → void
 *
 * Dynamo schema:
 *   pk = SESSION#<key>
 *   sk = SESSION#<key>
 *   value (string)
 *   expiresAt (number, epoch seconds; dynamodb TTL field — automatic eviction)
 */
export function createDynamoSessionStore(opts: { table: TinoTable; logger: AppLogger }): SecondaryStorage;
```

dynamodb's TTL feature evicts expired sessions automatically (no cron job needed). the table already has TTL configured on a generic `expiresAt` column — verify in pulumi; if not, this wave configures it.

### `packages/core/src/server/middleware/auth.ts` (MODIFIED — small, layered with above)

pass `secondaryStorage` to the `betterAuth` config:

```ts
betterAuth({
  // ...
  secondaryStorage: opts.sessionStore ?? createDynamoSessionStore({ table, logger }),
  // ...
});
```

remove the comment block at lines 14-31 about `/tmp/tino-auth.db` being acceptable. replace with: "Sessions persist in DynamoDB via secondaryStorage so multi-user deployments survive ECS restarts."

local dev: `secondaryStorage` defaults to better-auth's built-in in-memory store when no adapter is passed.

### `packages/core/src/env.ts` (MODIFIED)

`ALLOWED_SLACK_USER_ID` is no longer required. mark it deprecated in the schema with a note: "deprecated; used only as bootstrap-admin marker if the user table is empty. removed in v3.0."

### `packages/core/console-app/src/pages/Users.tsx` (NEW — minimal)

wave 3 adds the API for admin user management; wave 4 ships the rich UI. for wave 3, ship a minimal "Users" page that lists users (admin-only) with status field, and a "Add user" form (email + slack user id input). the goal is enough UI for the bot owner to manually invite a teammate before wave 4 lands.

### `packages/core/console-app/src/pages/AccessControl.tsx` (NEW — minimal)

a tiny admin-only page that lets the admin choose `allowlist` vs `org-domain` mode and set `orgDomain`. one form, two fields, one save button. wave 4 polishes this.

### `tests/slack/resolve-dm-sender.test.ts` (NEW)

unit tests for `resolveDmSender`. mocks the resolver, user store, slack client, audit logger. covers:
- known slack user → returns their tino-UUID, no audit "denied" entry
- known slack user with `status: 'suspended'` → returns null, sends rejection DM, audits denied
- known slack user with `status: 'invited'` → flips to active, returns tino-UUID
- unknown slack user, allowlist mode → returns null, sends "ask your admin" DM, audits denied with reason `unknown slack user <id>`
- unknown slack user, org-domain mode, email matches → auto-provisions, returns new user's tino-UUID, audits success
- unknown slack user, org-domain mode, email doesn't match → returns null, sends rejection DM, audits denied with reason `domain_mismatch`

### `tests/integration/wave3-multi-user.test.ts` (NEW)

end-to-end test: simulate two slack users (the bootstrap admin + a teammate), each DMs tino. assert:
- bootstrap admin's DM → uses bootstrap admin's history, preferences, gmail token (after wave 2 migration)
- teammate's DM (in allowlist mode, after admin adds them) → uses teammate's empty history; gmail not connected; `getActiveCapabilities` does NOT include gmail
- teammate's gmail token (added via the console route) → only that teammate's runs see gmail tools; bootstrap admin's runs use bootstrap admin's gmail
- audit log shows the right `userId` for each DM (tino-UUID, not slack id)

this is the highest-signal test of the whole plan. it's the test that proves "user A can't read user B's email" by construction.

### `tests/integration/wave3-cross-user-isolation.test.ts` (NEW)

adversarial test: with a malicious tool implementation that tries to query another user's partition, assert that:
- direct `dynamodb:GetItem` on `USER#<userB>#CAP#gmail` succeeds at the dynamo level (we can't prevent that without IAM-level scoping which D2 in main.md notes is impractical)
- but `Decrypt` of the resulting credential with `EncryptionContext={ userId: <userA> }` fails — KMS rejects
- the rejection bubbles up as a tool error, not a leaked credential

this is the cryptographic-floor test. wave 2's a6 covered it for the unit case; wave 3 covers it in the multi-user dispatch scenario.

### `tests/server/dynamo-session-store.test.ts` (NEW)

unit tests for the better-auth dynamo session adapter. covers: get/set/delete round-trip; TTL field is set on `set` calls with a ttl arg; get returns null after delete; get returns null for nonexistent key.

### `tests/server/auth-middleware.test.ts` (MODIFIED)

extend existing tests:
- the middleware resolves `c.get('user').id` to the tino-UUID, NOT better-auth's internal id
- `status: 'suspended'` returns 403 with "your access has been revoked"
- a better-auth user with no tino record + matching org domain auto-provisions
- a better-auth user with no tino record + non-matching org domain returns 403

## acceptance criteria

```plan-state
- [x] id: a1
  intent: The slack DM handler no longer rejects based on ALLOWED_SLACK_USER_ID. Instead it resolves the sender's slack id via the identity table, falling back to allowlist or org-domain auto-provisioning depending on the configured mode.
  tests:
    - tests/slack/resolve-dm-sender.test.ts::"known slack user returns tinoUserId"
    - tests/slack/resolve-dm-sender.test.ts::"unknown user in allowlist mode is rejected"
    - tests/slack/resolve-dm-sender.test.ts::"unknown user in org-domain mode with matching email auto-provisions"
    - tests/slack/resolve-dm-sender.test.ts::"unknown user in org-domain mode with non-matching email is rejected"
  verify: bun run test tests/slack/resolve-dm-sender.test.ts

- [x] id: a2
  intent: A suspended user's DM is rejected with a clear message and an audit entry. An invited user's first DM activates them and is processed normally.
  tests:
    - tests/slack/resolve-dm-sender.test.ts::"suspended user is rejected with revocation message"
    - tests/slack/resolve-dm-sender.test.ts::"invited user is activated on first DM"
  verify: bun run test tests/slack/resolve-dm-sender.test.ts

- [x] id: a3
  intent: Each user's runAgent call uses their own per-user private toolset. User A's gmail tools are not in user B's toolset. Two simultaneous DMs from different users dispatch to two different toolsets without leaking credentials.
  tests:
    - tests/integration/wave3-multi-user.test.ts::"bot owner DM uses bot owner's private tools"
    - tests/integration/wave3-multi-user.test.ts::"teammate DM uses teammate's private tools (empty until they configure)"
    - tests/integration/wave3-multi-user.test.ts::"teammate's gmail tools never appear in bot owner's runs"
  verify: bun run test tests/integration/wave3-multi-user.test.ts

- [x] id: a4
  intent: A malicious or buggy code path that reads another user's encrypted credentials cannot decrypt them — KMS rejects the decrypt because the encryption context does not match.
  tests:
    - tests/integration/wave3-cross-user-isolation.test.ts::"decrypting user B credential under user A context fails closed"
  verify: bun run test tests/integration/wave3-cross-user-isolation.test.ts

- [x] id: a5
  intent: Better-auth sessions persist across ECS restarts via the dynamodb secondaryStorage adapter. A session set before a simulated restart is still readable after.
  tests:
    - tests/server/dynamo-session-store.test.ts::"set then get round-trips a session value"
    - tests/server/dynamo-session-store.test.ts::"set with TTL sets the dynamo expiresAt field"
    - tests/server/dynamo-session-store.test.ts::"get after delete returns null"
  verify: bun run test tests/server/dynamo-session-store.test.ts

- [x] id: a6
  intent: The auth middleware stashes the requesting user's tino-UUID, role, and status on the request context. Routes that use the requireAdmin middleware reject member-role users with 403.
  tests:
    - tests/server/auth-middleware.test.ts::"middleware resolves session to tinoUserId via identity resolver"
    - tests/server/auth-middleware.test.ts::"requireAdmin middleware rejects member role"
    - tests/server/auth-middleware.test.ts::"requireAdmin middleware allows admin role"
  verify: bun run test tests/server/auth-middleware.test.ts

- [x] id: a7
  intent: Admin-only org-config and user-management routes work end-to-end. An admin can switch access mode, set org-domain, add a user, and suspend a user.
  tests:
    - tests/server/org-config-routes.test.ts::"GET /api/org/access-control returns the current config"
    - tests/server/org-config-routes.test.ts::"PUT /api/org/access-control as admin updates mode"
    - tests/server/org-config-routes.test.ts::"PUT /api/org/access-control as member returns 403"
    - tests/server/org-config-routes.test.ts::"POST /api/org/users adds a user"
    - tests/server/org-config-routes.test.ts::"PATCH /api/org/users/:id/status suspends a user"
  verify: bun run test tests/server/org-config-routes.test.ts

- [x] id: a8
  intent: All existing tests continue to pass.
  tests:
    - "*"
  verify: bun run test
```

## test plan

- `resolveDmSender` unit tests covering all 6 paths (known active, known suspended, known invited, unknown allowlist, unknown org-domain match, unknown org-domain mismatch).
- multi-user integration test simulating two users, each with their own data and tools.
- cross-user-isolation cryptographic test (the highest-signal property).
- session-store unit tests + a "survives restart" simulation (close and re-open the better-auth instance with the same dynamodb table).
- admin-route tests for org config and user management.
- existing suite passes.
- **manual verification** post-deploy: (a) ssh-equivalent into the bot owner's slack DMs and verify DMs work; (b) have one teammate DM tino — they should get rejected in allowlist mode with "ask your admin"; (c) admin adds the teammate via the console; (d) teammate DMs again — they get a normal response with empty private tools; (e) teammate connects gmail in the console; (f) teammate asks "what's in my latest email" — they get THEIR email, not the bot owner's; (g) bot owner asks the same question — they get THEIR email. these manual checks are the actual "tino is multi-user" demo.

## non-goals

- Do NOT add the rich admin UI for user management. wave 4 polishes the minimal pages from this wave.
- Do NOT add audit-log visibility UI. wave 4.
- Do NOT add per-user findWork. shared-only stays the rule.
- Do NOT delete legacy slack-id-keyed history/preferences. follow-up wave.
- Do NOT remove `ALLOWED_SLACK_USER_ID` env var from `env.ts`. it's deprecated, not removed (D3).
- Do NOT add audit-log retention policy changes. existing 90-day TTL stays.

## rollback story

if wave 3 ships and a critical bug surfaces:

1. **the most dangerous case is a teammate already DMed and got auto-provisioned, then a bug bricks DM handling.** the data created (tino user record, identity link, possibly empty per-user capability records) is harmless to leave in place. rolling back to wave-2 code restores the old `ALLOWED_SLACK_USER_ID !== m.user` gate, which rejects everyone except the bootstrap admin. the auto-provisioned teammates' tino user records become dormant data.
2. **for "i need to lock everyone out fast":** an admin can switch access mode to `allowlist` (default), then suspend every non-admin user via `PATCH /api/org/users/:id/status`. existing teammates' DMs immediately bounce.
3. **session storage rollback** is more delicate: the dynamodb session store creates `SESSION#*` partitions. reverting to sqlite-`/tmp` invalidates all live sessions (everyone re-logs in via google OAuth). acceptable.
4. **the deprecation log line for `ALLOWED_SLACK_USER_ID`** is the only env-shape-related change; the env var is still parsed.

## open questions

- **simultaneous DMs and per-user toolset cost.** `buildPrivateTools(userId)` does N KMS Decrypt calls per agent run. for the bot owner alone it's been once at startup; now it's per-DM. KMS pricing (~$0.001/run) is fine; latency may add ~50ms to first-tool-use. flag if real-world DM responsiveness regresses noticeably; mitigation is a small per-user toolset cache with explicit invalidation on capability change.
- **invited-user activation race.** if two DMs from an invited user arrive within milliseconds, both might try to flip status to active. dynamodb ConditionExpression on `status = 'invited'` makes the update idempotent; ensure the executor uses ConditionExpression rather than read-then-write.
- **slack `users.info` rate limits during auto-provisioning bursts.** in org-domain mode, every unknown slack DM does one `users.info` call. tier-3 limits are 100/min — fine for normal use, but a slack-app-install bug that triggers many DMs could rate-limit. flag for the executor to use slack's tier-3 retry-after header.
- **the bootstrap-admin invariant** — wave 0's migration creates the bootstrap admin from `ALLOWED_SLACK_USER_ID`. wave 3 deprecates the env var. if a future deploy is created with no `ALLOWED_SLACK_USER_ID` AND no manually-seeded admin, the user table will be empty and no one can DM. flag: wave 3 should add an explicit startup check — "user table is empty AND `ALLOWED_SLACK_USER_ID` is unset" → log a loud warning telling the operator to seed an admin via pulumi config. don't crash; the console still works for OAuth-based first-admin setup if `GOOGLE_OAUTH_CLIENT_ID` is configured.
- **wave 3.5 introduces the privacy onboarding flow.** wave 3 ships multi-user DM gated by `accessControl.mode`; wave 3.5 adds a second gate (`user.privacy_setup_completed_at == null` → redirect to `/onboarding`). between waves 3 and 3.5, new users can DM and the privacy filter defaults to `persist: true` (no source-respecting gating). this is the deliberate transitional state — flag it in the deployment notes and avoid leaving production parked here for long.
