# wave 4: admin/member roles + audit visibility

layer role-based access control on top of the working multi-user system from wave 3. polish the minimal admin pages from wave 3 into a real user-management UI. expose audit-log visibility to admins (admins see all entries; members see their own only). enforce role-based separation server-side on every API route. **this wave adds no new privacy boundaries** (those landed in wave 2's encryption + wave 3's per-user dispatch); it adds operational visibility and access-control polish so admins can manage users and observe what tino is doing.

## why this comes fifth

waves 0-3 are the security-critical sequence: foundation, structural split, encryption, multi-user dispatch. wave 4 is the operational layer — what an admin running tino for their team needs to actually administer it. doing this before wave 3 is wasted effort because there's no multi-user system to administer. doing it after wave 3 is fine; teammates are already using tino with privacy enforced.

## constraints

- **server-side role enforcement on every admin route, no exceptions.** the `requireAdmin` middleware from wave 3 is mandatory on every route that exposes shared state. UI gates are convenience; the server is authoritative.
- **audit-log queries are partitioned by role.** members see only `WHERE userId = <theirs>`. admins see all entries. enforced by the route handler reading `c.get('user').role` and adjusting the query.
- **role changes are audited.** an admin promoting another user is itself an audit event (`action: 'role_change'`). this is the meta-audit floor.
- **suspend / unsuspend / role change can never affect the requesting admin's own session.** an admin demoting themselves is a foot-gun; the route returns 400 "you cannot demote yourself; ask another admin."
- **the bootstrap admin can never be demoted to member if they are the only admin.** the route enforces "at least one admin must exist" with a count query.

## file-level changes

### `packages/core/src/server/routes/audit.ts` (NEW)

```ts
/**
 * GET /api/audit?userId=<id>&action=<a>&from=<ts>&to=<ts>&limit=<n>
 *
 * Returns audit log entries. Filtering:
 *  - admin: any filter combination, default no filter
 *  - member: userId is forced to their own tinoUserId; other filters optional
 *
 * The dynamodb partition key is AUDIT#<timestamp>#<tinoUserId>; a query plan:
 *  - admin with no filter: scan with limit (paginated)
 *  - admin with userId filter: query gsi1 (gsi1pk = AUDIT_USER#<userId>, gsi1sk = <timestamp>)
 *  - member: same as "admin with userId filter" but userId locked
 *
 * For sqlite (local dev), simpler: a single "select with where" against the in-memory log.
 */
```

### `packages/core/src/audit/logger.ts` (MODIFIED)

extend the `AuditLogger` interface with `query(filter): Promise<AuditEntry[]>` for the new route. existing `log` method is unchanged.

### `packages/aws/src/persistence/dynamo/audit.ts` (MODIFIED)

add a gsi1 index on the audit table for `userId` lookups. partition key `gsi1pk = AUDIT_USER#<userId>`, sort key `gsi1sk = <timestamp>`. requires a pulumi update (`packages/aws/src/pulumi/tino-service.ts`) — additional GSI on the existing table. backfill existing rows: a one-shot script run at startup reads existing audit entries and writes the gsi1pk/gsi1sk fields. (or accept a partial backfill — only entries written after wave 4 deploy are queryable by the new index. simpler.)

decision: accept partial backfill. wave 4 only queries entries written after wave 4 deploys. older entries are still in the table; they're just not in the GSI. flag for the executor: confirm this is acceptable; if not, write a backfill.

### `packages/core/src/server/routes/users.ts` (MODIFIED, was minimal in wave 3)

complete the user-management API:
- `GET /api/org/users` — admin-only; lists all users with role and status
- `POST /api/org/users` — admin-only; adds a user (already shipped in wave 3)
- `PATCH /api/org/users/:id` — admin-only; updates role and/or status. enforces:
  - cannot demote self
  - cannot demote the last admin
  - role change is audited
- `DELETE /api/org/users/:id` — admin-only; soft-delete (sets status to `'suspended'` and clears `slackUserId`). hard-delete is out of scope; users keep their data for forensics.

### `packages/core/console-app/src/pages/Users.tsx` (MODIFIED, expand from wave 3)

full user-management UI:
- table of users: email, name, role, status, last activity (read from latest audit entry).
- per-row actions: "Promote to admin" / "Demote to member", "Suspend" / "Reactivate", "Remove".
- "Add user" form with email + slack user id + role (admin/member).
- confirmation modal for suspend/remove with the user's email shown.
- error toasts for "cannot demote self" and "cannot demote last admin."

design language matches existing console pages (use existing card / button / modal components).

### `packages/core/console-app/src/pages/Audit.tsx` (NEW)

admin-only audit log viewer:
- filterable list view with columns: timestamp, user (email + slack handle), action, tool name, status, error message.
- filters: user (dropdown of all users), action (dropdown: login, tool_call, injection_suspected, denied, role_change), date range.
- pagination via `cursor` query param (server returns `nextCursor` when more entries available).
- a "live tail" toggle that polls every 2 seconds and prepends new entries.

### `packages/core/console-app/src/pages/MyActivity.tsx` (NEW)

member-visible "your activity" view:
- list of the user's own audit entries (limited to last 90 days, the audit retention).
- columns: timestamp, action, tool name, status.
- no error message column (members shouldn't see internal error strings — those go to admins only).

### `packages/core/console-app/src/Header.tsx` (MODIFIED)

show different nav items based on `user.role`:
- both: "Your capabilities", "Your activity"
- admin only: "Org capabilities", "Users", "Audit", "Access control"

the role comes from `/api/auth/get-session` extended response (better-auth's session response includes the additional fields registered in wave 0).

### `packages/core/console-app/src/pages/Capabilities.tsx` (MODIFIED — small)

already changed in wave 2 to be the "org capabilities" page. wave 4 adds a 403 boundary: if the requesting user is a member, the page redirects to `/me/capabilities` with a "you don't have access to org capabilities" toast.

### `packages/core/console-app/src/router.tsx` (MODIFIED)

add the new routes (`/audit`, `/me/activity`, `/users`, `/access-control`). client-side role gates fall back to a 403 page if the user lacks the role; server-side enforcement is still authoritative.

### `packages/core/src/audit/logger.ts` (MODIFIED — small)

new audit action: `'role_change'`. emitted by the user-update route when role transitions. payload includes `{ targetUserId, oldRole, newRole, actorUserId }`.

### `tests/server/audit-routes.test.ts` (NEW)

route-level tests:
- admin can list all audit entries
- member cannot list other users' entries (forced filter)
- filter by user works
- filter by action works
- pagination via cursor works
- 401 on no session, 403 on suspended user

### `tests/server/users-routes.test.ts` (MODIFIED, expand from wave 3)

- admin can change another user's role; emits role_change audit
- admin cannot demote themselves
- admin cannot demote the last admin (with a single-admin fixture)
- soft-delete sets status=suspended

### `tests/integration/wave4-role-enforcement.test.ts` (NEW)

end-to-end:
- member's session can hit `/api/me/capabilities` but not `/api/capabilities` (org)
- member's session can hit `/api/me/activity` but not `/api/audit`
- admin's session can hit all of them
- demoted user (admin → member) immediately loses access on next request (no session refresh needed because the middleware reads `user.role` from the live user table on each request, not from the session token)

### `tests/console-app/header-role-nav.test.tsx` (NEW)

component test: header renders different nav items based on `user.role`.

## acceptance criteria

```plan-state
- [ ] id: a1
  intent: Admin-only routes are server-side enforced. A member's session cannot hit /api/audit, /api/org/users, /api/org/access-control, or /api/capabilities — all return 403. An admin's session can hit all of them.
  tests:
    - tests/integration/wave4-role-enforcement.test.ts::"member is rejected from admin routes"
    - tests/integration/wave4-role-enforcement.test.ts::"admin can access admin routes"
  verify: bun run test tests/integration/wave4-role-enforcement.test.ts

- [ ] id: a2
  intent: The audit route returns all entries for admins and only the requesting user's entries for members. Filters by user, action, and date range work.
  tests:
    - tests/server/audit-routes.test.ts::"admin sees all entries with no filter"
    - tests/server/audit-routes.test.ts::"member sees only their own entries"
    - tests/server/audit-routes.test.ts::"filter by user returns only that user"
    - tests/server/audit-routes.test.ts::"filter by action returns only that action"
    - tests/server/audit-routes.test.ts::"pagination cursor returns next page"
  verify: bun run test tests/server/audit-routes.test.ts

- [ ] id: a3
  intent: Role changes are guarded against foot-guns and audited. An admin cannot demote themselves; an admin cannot demote the last remaining admin; every role change emits a role_change audit entry.
  tests:
    - tests/server/users-routes.test.ts::"admin cannot demote self"
    - tests/server/users-routes.test.ts::"cannot demote the last admin"
    - tests/server/users-routes.test.ts::"role change emits role_change audit entry"
  verify: bun run test tests/server/users-routes.test.ts

- [ ] id: a4
  intent: A demoted user immediately loses admin access on their next request, without needing to log out. The middleware reads role from the live user record on every request rather than caching it in the session token.
  tests:
    - tests/integration/wave4-role-enforcement.test.ts::"demoted admin cannot hit admin routes on next request"
  verify: bun run test tests/integration/wave4-role-enforcement.test.ts

- [ ] id: a5
  intent: The console renders different navigation for admins and members. Admin-only pages redirect members away with a clear message.
  tests:
    - tests/console-app/header-role-nav.test.tsx::"member nav lacks admin links"
    - tests/console-app/header-role-nav.test.tsx::"admin nav includes admin links"
  verify: bun run test tests/console-app/header-role-nav.test.tsx

- [ ] id: a6
  intent: All existing tests continue to pass.
  tests:
    - "*"
  verify: bun run test
```

## test plan

- route-level tests for `/api/audit`, `/api/org/users`, `/api/org/access-control` covering admin and member access.
- integration test that demotes an admin live and verifies the next request is gated.
- console component tests for role-conditional rendering.
- existing 314+-test suite passes.
- **manual verification:** create two test users (one admin, one member). admin sees Users / Audit / Access control / Org capabilities. member sees only Your capabilities and Your activity. admin demotes themselves → 400 with explanatory message. admin promotes member → role change appears in audit log immediately.

## non-goals

- Do NOT add custom roles beyond admin/member.
- Do NOT add per-capability ACLs (member X can use capability Y but not capability Z).
- Do NOT add hard-delete for users.
- Do NOT add audit-log retention configuration UI. existing 90-day TTL stays; an admin who wants to change it edits pulumi.
- Do NOT add session-revocation on role change. role enforcement happens on each request via the middleware lookup; revocation isn't needed.
- Do NOT add MFA, IP allowlists, SCIM, or any other identity-management bells. these are correct-but-out-of-scope; future plans can layer them.

## rollback story

if wave 4 ships and a bug surfaces:

1. **role-related bugs are recoverable by demoting users via direct dynamodb console or the still-existing `POST /api/org/users` allowlist-mode workflow.** the underlying user table is unchanged; only the routes and UI layer.
2. **audit GSI rollback.** wave 4 adds a GSI to the audit table. removing a GSI is a pulumi destructive operation but safe — querying via the GSI just stops returning rows; non-GSI queries still work.
3. **for code rollback:** revert. the wave-3 minimal admin pages still work for the basic operations (mode toggle, add user, suspend user). audit log viewing falls back to "ssh into ECS and read CloudWatch."

## open questions

- **member-visible activity feed retention.** members see their own audit entries up to 90 days (the dynamodb TTL). after that, entries are gone. flag for the executor: should there be a "your activity since signup" view that pulls a longer history? not for this wave; member-visible 90-day window is fine.
- **role-change audit detail.** the role_change entry includes `{ targetUserId, oldRole, newRole, actorUserId }` in the `errorMessage` JSON-encoded field (existing audit schema reuses `errorMessage` for free-form strings). consider extending the audit schema with a typed `details` field instead. flag — small refactor; not blocking.
- **demoted-admin cache.** if the auth middleware is hot-pathed, reading the user record from dynamodb on every request adds ~10ms per request. flag for the executor: consider a per-process LRU cache with a 30-second TTL on user records. invalidation on role change is best-effort (other ECS tasks won't see the change for up to the TTL). acceptable trade-off; ship without cache first, add if latency is noticeable.
- **a5 deferred routes.** the wave-4-a5 implementation wires up `/me/activity`, `/users`, `/audit` routes inside `App.tsx` and adds nav links for `/capabilities` and `/access-control` to the header. but `Capabilities.tsx` and `AccessControl.tsx` pages do not exist in this codebase yet — `/capabilities` falls through to `<AppRouter>` which renders the existing `Console.tsx` (where org caps live today), and `/access-control` falls through to `<AppRouter>` too (renders Console — soft 404). a future wave should split out a dedicated `Capabilities.tsx` page and create the `AccessControl.tsx` page; for now the nav link surface matches the spec, the routes resolve to a sensible page, and admin/member separation is correctly enforced for the three pages that DO exist.
- **`RequireRole` prop name.** the spec called it `role`, but biome's `useValidAriaRole` lint flagged `role="admin"` on a custom React component as if it were the html `role` attribute. renamed to `requiredRole` to keep the lint clean. functional behaviour is identical.
