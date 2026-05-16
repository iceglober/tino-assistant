# console

The web console is tino's only configuration interface. Every credential, capability, model ID, and admin action goes through it. No env vars for runtime config; no code changes to add capabilities.

## where it lives

| Mode | URL |
|---|---|
| Local dev | `http://localhost:3001` |
| Deployed, no custom domain | `http://<alb-dns>` (HTTP, with an "insecure" banner) |
| Deployed, with `consoleDomain` | `https://<consoleDomain>` |

The console is a React SPA in [`packages/core/src/console-app/`](../packages/core/src/console-app) served by a Hono server in [`packages/core/src/server/`](../packages/core/src/server). The same process also runs the Slack bot.

## first-run flow

The first time you load the console, it routes you through:

1. **Login** — Google Sign-In with the domain restricted to whatever you set as `allowedDomain` on the Pulumi component.
2. **Setup, step 1** — paste your Slack bot token + Slack app-level token. Both come from the Slack app config page; the bot token starts `xoxb-`, the app token starts `xapp-`.
3. **Setup, step 2** — pick the Bedrock model ID and your Slack admin user ID. The model ID is validated against your AWS region before save (see [`packages/core/src/agent/bedrock.ts`](../packages/core/src/agent/bedrock.ts)) — invalid IDs are rejected before the config is committed.

After step 2 finishes you land on the main console.

## main console layout

The console has four sections:

### header

Logo, status dot (green when Slack is connected, dim otherwise), your signed-in email, and a sign-out link. Defined in [`Header.tsx`](../packages/core/src/console-app/components/Header.tsx).

### capabilities

A card per capability — GitHub, Linear, Google Calendar, Gmail, Slack reading, CloudWatch. Each card shows:

- An icon and one-line description.
- Connected/disconnected status.
- Expansion area with the credentials, allowlists, and toggles for that capability.

Adding a credential and clicking save triggers a hot reload of the capability registry — the new tools become available on the next agent message without restarting the container. See [`packages/core/src/capabilities/registry.ts`](../packages/core/src/capabilities/registry.ts) for the reload logic and `POST /api/reload/capabilities` for the route.

### compliance

Live HIPAA dashboard. Reads from `GET /api/compliance` ([`packages/core/src/server/routes/compliance.ts`](../packages/core/src/server/routes/compliance.ts)) and shows:

- **Encryption** — `cmk` for DynamoDB and CloudWatch Logs when you're on the DynamoDB adapter (the Pulumi component always provisions a CMK; see `tino-service.ts:317`). `unknown` on local SQLite.
- **Audit logging** — entry count, last entry timestamp, retention days. Pulled live from the audit logger (`auditLogger.count()`, `auditLogger.lastEntryAt()`).
- **Data retention** — history (default 30d) and audit (default 90d). Sourced from `tino.deploy.json hipaa.{historyRetentionDays, auditRetentionDays}` if present.
- **BAA status** — per provider (AWS, Bedrock, GitHub, Slack). Sourced from `tino.deploy.json compliance.baaStatus`. "no-baa" for Slack is the honest answer — Slack does not offer a BAA on standard plans.
- **Access control** — count of `user.*` and `admin.*` config entries.

### raw config

A table of every key/value in the config store with edit-in-place. Use sparingly — most keys are managed by the capability cards. The raw view is for debugging or for keys the UI doesn't expose yet.

### health footer

Uptime, tool count, last reload timestamp.

## what each setting does

- **`slack.botToken`, `slack.appToken`** — Slack tokens. Saving these triggers `POST /api/reload/slack`, which tears down the existing Slack connection and reconnects with the new tokens.
- **`slack.adminUserId`** — Slack user ID (e.g. `U0123ABCDE`) of the admin who can DM tino. Other users' DMs are dropped.
- **`bedrock.modelId`** — full Bedrock model ID (e.g. `global.anthropic.claude-sonnet-4-6`). Validated on save.
- **`<capability>.<key>`** — capability-specific config. See each capability's schema in [`packages/core/src/capabilities/`](../packages/core/src/capabilities).

## hot-reload semantics

Changes take effect on the next request — no container restart needed.

| Change | Reload trigger | Effect |
|---|---|---|
| Slack tokens | `POST /api/reload/slack` (auto on save) | Slack connection torn down + recreated |
| Capability credentials, allowlists, toggles | `POST /api/reload/capabilities` (auto on save) | Tool registry rebuilt; new tools available next message |
| Bedrock model ID | next agent run | Model client re-created with new ID |
| Anything else | next read | Config store is the source of truth; reads are live |

## screenshots

Screenshots live under `docs/img/` (relative paths from this file). Add new ones there if you're updating the console UI; reference them as `![label](img/name.png)`.

## reset / sign out

The header has a sign-out button. To wipe the local SQLite session DB and start over:

```sh
rm tino.db
pnpm dev
```

In production sessions are stored server-side in the DynamoDB table; sign out via the header link clears the cookie. To force-revoke all sessions, restart the ECS task — the `BETTER_AUTH_SECRET` survives but session records are wiped on table-side rotation.

## API surface

For automation or debugging, the routes the console talks to are:

- `GET /api/health` — liveness + tool count + uptime.
- `GET /api/config` / `PUT /api/config/:key` / `DELETE /api/config/:key` — raw config CRUD.
- `GET /api/capabilities` / `POST /api/capabilities/:id/toggle` — capability metadata + toggle.
- `GET /api/compliance` — HIPAA dashboard data.
- `POST /api/reload/slack` / `POST /api/reload/capabilities` — hot-reload triggers.
- `POST /api/admin/restart` — graceful shutdown (ECS will spin a new task).

All require the auth cookie except `/api/health`.
