# Tino Capability Architecture Refactor

## Goal

Refactor tino's configuration from scattered env vars + SQLite config entries into a unified **capability-as-config-unit** model. Each capability (GitHub, Linear, Slack, Gmail, Calendar, CloudWatch) is a self-contained unit with its own credentials, allowlist, settings, and autonomous work-discovery toggle. A parent config controls the master "find work" switch. The web console at localhost:3001 is the primary management interface.

## Capability shape

```ts
interface CapabilityConfig {
  enabled: boolean;
  credentials: Record<string, string>;   // tokens, API keys
  settings: Record<string, unknown>;     // allowlists, defaults, tool-specific config
  findWork?: {
    enabled: boolean;
    intervalMinutes: number;
    // capability-specific scan config lives in settings
  };
}
```

## Capabilities

### github
- **credentials:** `token` (PAT)
- **settings:** `repos` (allowlist: `["kn-eng/kn-eng"]`), `defaultRepo` (`"kn-eng/kn-eng"`)
- **findWork:** scan for failed CI runs on default branch, new PRs needing review
- **tools:** `github_search_code`, `github_get_file`, `github_list_workflow_runs`, `github_get_workflow_run_logs`

### linear
- **credentials:** `token` (OAuth app developer token)
- **settings:** `defaultTeamKey` (`"GEN"`), `autoPickupStates` (`["backlog", "unstarted"]`)
- **findWork:** poll for issues assigned to tino in autoPickupStates
- **tools:** `linear_search_issues`, `linear_get_issue`, `linear_create_issue`, `linear_update_issue`, `linear_add_comment`, `linear_list_my_issues`

### slack
- **credentials:** `userToken` (xoxp-)
- **settings:** (none currently; future: channel allowlist, scan keywords)
- **findWork:** scan recent messages in channels for action items, questions directed at the owner
- **tools:** `slack_search_messages`, `slack_read_thread`, `slack_list_dms`, `slack_read_dm`

### gmail
- **credentials:** `clientId`, `clientSecret`, `refreshToken`
- **settings:** (none currently; future: label filter, VIP senders)
- **findWork:** scan for unread emails from VIP senders, urgent subjects
- **tools:** `gmail_search`, `gmail_get_message`

### calendar
- **credentials:** (shares gmail's OAuth credentials)
- **settings:** `calendarId` (default: `"primary"`)
- **findWork:** scan upcoming meetings, auto-schedule prep tasks
- **tools:** `calendar_list_events`

### cloudwatch
- **credentials:** (uses AWS default credential chain)
- **settings:** `logGroups` (allowlist: `[]`), `region`
- **findWork:** (future: scan for error spikes)
- **tools:** `cloudwatch_logs_query`

## Storage

Capabilities are stored in the existing config table (SQLite or DynamoDB) under the key pattern `capability.<id>`. The value is a JSON blob:

```
capability.github → { "enabled": true, "credentials": { "token": "ghp_..." }, "settings": { "repos": [...], "defaultRepo": "..." }, "findWork": { "enabled": true, "intervalMinutes": 15 } }
capability.linear → { ... }
```

**Credentials in the config table:** This is a deliberate choice. The config table is in SQLite (local dev, encrypted at rest on EFS) or DynamoDB (deployed, encrypted at rest by default). For a single-user personal bot, this is acceptable. The alternative (SSM for secrets, config table for non-secrets) splits the config across two stores and makes the console unable to manage credentials. We consolidate.

The `.env` file becomes a **bootstrap-only** config: just `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ALLOWED_SLACK_USER_ID` (the three things needed to start the Slack connection), plus `PERSISTENCE_ADAPTER` and `DYNAMODB_*` vars. Everything else moves into capabilities.

## Migration

On first startup after the refactor, if the config table has no `capability.*` keys but `.env` has the old vars (GITHUB_TOKEN, LINEAR_DEVELOPER_TOKEN, etc.), auto-migrate: read the env vars, construct capability configs, write them to the config table, log what was migrated. Subsequent startups read from the config table only.

## Web console changes

The console at localhost:3001 becomes the primary config UI:

- **Capabilities page:** list all capabilities with enabled/disabled toggle, credential status (set/missing), findWork toggle
- **Capability detail:** edit credentials, settings (allowlists), findWork config
- **Add capability:** form to configure a new capability (for future: Ramp, Rippling, etc.)
- **Health:** which capabilities are active, tool count, last findWork scan time per capability

## Find Work (autonomous scanning)

The parent `findWork` config is a master switch. When enabled, each capability with `findWork.enabled=true` runs its scan on its configured interval.

Current implementation:
- **linear:** already built (linear-poller.ts, 15 min interval)
- **github/slack/gmail/calendar:** not yet built, but the architecture supports them

The refactor wires the existing linear poller into the capability framework. Other capability scanners are stubs (enabled=false by default, no implementation yet).

## File changes

### New
- `src/capabilities/types.ts` — `CapabilityConfig`, `CapabilityRegistry` interfaces
- `src/capabilities/registry.ts` — loads capabilities from config store, registers tools, starts findWork pollers
- `src/capabilities/github.ts` — GitHub capability: tool registration + findWork stub
- `src/capabilities/linear.ts` — Linear capability: tool registration + findWork (migrated from linear-poller.ts)
- `src/capabilities/slack.ts` — Slack capability: tool registration + findWork stub
- `src/capabilities/gmail.ts` — Gmail capability: tool registration
- `src/capabilities/calendar.ts` — Calendar capability: tool registration
- `src/capabilities/cloudwatch.ts` — CloudWatch capability: tool registration
- `src/capabilities/migration.ts` — one-time migration from env vars to capability configs
- `src/console/html.ts` — rewrite with capability-centric UI

### Edited
- `src/index.ts` — replace `buildTools` + linear poller with capability registry
- `src/env.ts` — slim down to bootstrap-only vars
- `src/console/server.ts` — add capability CRUD API routes
- `src/agent/systemPrompt.ts` — generate tool descriptions dynamically from registered capabilities

### Removed / deprecated
- `src/tools/index.ts` — replaced by capability registry
- `src/tools/github/allowlist.ts` — allowlist moves into capability config
- `src/tools/cloudwatch/allowlist.ts` — same
- `src/scheduler/linear-poller.ts` — migrated into `src/capabilities/linear.ts`

### Tests
- `tests/capabilities/registry.test.ts` — capability loading, tool registration, findWork scheduling
- `tests/capabilities/migration.test.ts` — env-to-capability migration
- Update existing tool tests if import paths change
