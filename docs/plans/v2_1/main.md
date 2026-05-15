# tino v2.1 — deployment-ready

## what this is

v2.0 got tino deployed on ECS with Google OAuth, DynamoDB persistence, and the console. but the deployment exposed a long list of gaps — things that are broken, half-wired, or missing entirely. v2.1 is about closing every one of those gaps so that tino is genuinely production-ready: a developer can `tino init`, deploy, configure via the console, and have a working assistant without touching code or restarting containers.

## principles

1. **the console is the only configuration interface.** no env vars for runtime config, no code changes to add capabilities, no ECS restarts to pick up new settings.
2. **every config change takes effect immediately.** hot-reload, not restart.
3. **the deployment pipeline is one command.** `tino init` → running instance. `tino deploy` → updated instance. no manual task definition registration, no ECR login dance.
4. **security is real, not aspirational.** every claim in the JSDoc is backed by working code.

## waves

the work is split into 4 waves, ordered by dependency and user impact:

- **wave 1: make it work** — fix the bugs that prevent basic functionality
- **wave 2: make it configurable** — the console can configure all capabilities
- **wave 3: make it seamless** — hot-reload, one-command deploy, no restarts
- **wave 4: make it polished** — UX, observability, documentation

each wave has its own file with detailed acceptance criteria.

## known gaps (complete inventory)

### critical (blocks basic usage)

| # | gap | where it broke | wave |
|---|-----|----------------|------|
| 1 | **tino responds poorly** — only 4 tools loaded (cloudwatch + tasks), no GitHub/Linear/Calendar/Gmail/Slack tools. system prompt works but capabilities aren't registered because they're not configured in the config store | deployment logs: `toolCount: 4` | 2 |
| 2 | **console can't load config** — `/api/config` returns HTML login page instead of JSON when session is invalid. the `getConfig()` fetch gets `<!DOCTYPE` instead of JSON | user report: `Unexpected token '<'` | 1 |
| 3 | **console has no capability configuration UI** — only shows Slack setup + basics. no way to configure GitHub, Linear, Calendar, Gmail, Slack reading, CloudWatch from the console | user report: "no option to enable/configure additional capabilities" | 2 |
| 4 | **config changes require ECS restart** — saving Slack tokens via console doesn't trigger reconnection. saving any capability config doesn't register new tools. the process reads config once at startup | deployment: had to `force-new-deployment` after every config change | 3 |

### high (degrades experience significantly)

| # | gap | where it broke | wave |
|---|-----|----------------|------|
| 5 | **deploy pipeline requires manual task definition registration** — every image push requires: register new task def → update service. the Pulumi docker-build pins to a digest, so `force-new-deployment` alone doesn't pick up new images | deployment: 14 task definition revisions to get it working | 3 |
| 6 | **preferences tools disabled** — `unable to open database file` because SQLite preferences store tries to write to the read-only root filesystem. should use DynamoDB in production | logs: `preferences tools disabled` on every startup | 1 |
| 7 | **session invalidation on restart** — `BETTER_AUTH_SECRET` was `crypto.randomUUID()` (changes every restart). fixed with a stable secret in revision 12, but any restart still kills sessions because the auth SQLite DB is in `/tmp` (ephemeral) | deployment: `state_mismatch` error after restart | 1 |
| 8 | **no HTTPS** — console runs on HTTP. Google OAuth over HTTP works but browsers show "Not Secure" warning. credentials are transmitted in plaintext | user screenshot: "Not Secure" warning | 4 |

### medium (missing features that users expect)

| # | gap | description | wave |
|---|-----|-------------|------|
| 9 | **no hot-reload for capabilities** — adding a GitHub PAT via console requires restart to register the tools | design gap | 3 |
| 10 | **no hot-reload for Slack** — saving Slack tokens via console requires restart to connect | design gap | 3 |
| 11 | **console doesn't show which capabilities are active** — no visual indicator of what's working vs what needs setup | UX gap | 2 |
| 12 | **no "restart tino" button in console** — as a stopgap until hot-reload works, the console should have a button that triggers ECS redeployment | UX gap | 3 |
| 13 | **logo doesn't load in production** — path resolution tries multiple candidates but may still fail depending on the working directory | deployment: broken logo on first deploy | 1 |
| 14 | **`tino init` doesn't handle the full deploy lifecycle** — generates files and runs `pulumi up` but doesn't handle the image-pinning problem. subsequent deploys require manual task def registration | deployment pain | 3 |
| 15 | **bedrock model ID read from config store but not validated** — if the model ID is wrong, tino crashes on first message with an opaque Bedrock error | robustness gap | 2 |
| 16 | **audit logging not wired to DynamoDB in production** — the in-memory audit logger is used even when `PERSISTENCE_ADAPTER=dynamodb` | design gap | 4 |

### low (polish, nice-to-have)

| # | gap | description | wave |
|---|-----|-------------|------|
| 17 | **compliance dashboard shows "unknown" for everything** — encryption status, BAA status all show "unknown" because there's no way to query the actual AWS resource state from the running container | UX gap | 4 |
| 18 | **`tino-tino` naming** — all resources are named `tino-tino` (component name "tino" + resource prefix "tino"). should be just `tino` | cosmetic | 4 |
| 19 | **console "signed in as" indicator** — the HTML has it but it may not be rendering the user's email correctly | UX gap | 2 |
| 20 | **VPC Flow Logs deprecation warning** — `log_group_name is deprecated. Use log_destination instead` on every deploy | Pulumi warning | 4 |
