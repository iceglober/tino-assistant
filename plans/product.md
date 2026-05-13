# tino — product design

## what tino is

an open-source AI assistant that connects to your team's tools and works alongside you in slack. it searches code, reads email, preps for meetings, monitors project boards, and works on tasks autonomously — all through DMs.

it runs on your AWS infrastructure, uses BAA-backed models on Bedrock, and is configured through a web console. open-source at `iceglober/tino-assistant`, deployed privately per-org.

---

## deployment model

tino is open-source software that orgs deploy on their own infrastructure. there is no hosted version, no SaaS, no data leaving the org's AWS account.

```
iceglober/tino-assistant (public repo, MIT)
  └── your-org deploys to your-org's AWS account
        ├── ECS Fargate (compute)
        ├── DynamoDB (persistence)
        ├── Secrets Manager (credentials)
        ├── Bedrock (model inference — BAA-backed)
        └── your Slack workspace (Socket Mode — no public endpoint)
```

this means:
- **data stays in your AWS account.** model calls go to Bedrock in your account. conversation history, tool results, credentials — all in your DynamoDB table and Secrets Manager. nothing leaves your VPC except API calls to external services (Slack, GitHub, Google, Linear, etc.) that the user explicitly configures.
- **you control the model.** swap Bedrock model IDs in config. use cross-region inference profiles. enforce BAA compliance at the AWS account level.
- **you control access.** who can talk to tino, what tools tino has, what data tino can see — all configured by your team, not by us.

---

## the journey: "never heard of tino" → "tino saves the team hours"

### phase 0: discovery (30 seconds)

someone sees tino mentioned. clicks the repo. README shows the butler logo, one line: "AI assistant that connects to your team's tools and works alongside you in Slack." they scan the capability list and think "i want that for my team."

### phase 1: org deploy (30 minutes)

the CTO (or whoever owns infra) runs:

```
git clone → cd infra → cdk deploy → scripts/setup-secrets.sh secrets.json
```

this creates: ECS cluster, DynamoDB table, Secrets Manager entries, IAM roles. tino starts running. the console is accessible via ECS exec port-forward (localhost-only for now) or behind the org's SSO (future).

the deployer configures:
- Slack app (bot token, app token, Socket Mode)
- Bedrock model access
- which capability types are available org-wide

### phase 2: user onboarding (5 minutes per person)

each team member DMs tino in slack. tino recognizes them (by Slack user ID) and creates their user profile. the first message triggers onboarding:

> "hey, i'm tino. i'm your team's AI assistant. i can search code, read your calendar, check CI, and more — but i need you to connect your accounts first. visit the console to get set up."

the user visits the console (authenticated via Google Workspace SSO), sees their personal capability setup:

- **shared capabilities** (configured by the org admin): GitHub repos, Linear workspace, CloudWatch log groups — already connected, the user just sees them
- **personal capabilities** (configured by each user): their Google Calendar, their Gmail, their Slack reading token — each user connects their own

### phase 3: daily use

same as the single-user journey: first capability → capability stacking → autonomous work → tino saves hours. but now multiplied across the team.

### phase 4: team value

- shared context: "what did the team discuss about the deployment?" — tino searches shared Slack channels (using the asking user's token, so it only sees what they see)
- shared tools: everyone can ask about CI status, search the same codebase, query the same log groups
- individual context: each person's calendar, email, and DM history stays private to them

---

## multi-user architecture

### user model

```ts
interface TinoUser {
  id: string;                        // Slack user ID (primary key)
  slackDisplayName: string;
  role: 'admin' | 'member';
  createdAt: number;
  lastActiveAt: number;
}
```

- **admin**: can manage org-wide capabilities, view audit logs, configure shared resources, add/remove users
- **member**: can use tino, manage their personal capabilities, see their own conversation history

users are auto-created on first DM to tino. the deployer's Slack user ID is the initial admin (set during deploy). admins can promote other users via the console.

### access control: who can talk to tino?

the current single-user `ALLOWED_SLACK_USER_ID` evolves into a user table. two modes:

- **allowlist mode** (default): only Slack user IDs in the user table can interact with tino. new users must be added by an admin (or auto-added if their Slack email matches the org's domain).
- **org-domain mode**: any Slack user whose email matches a configured domain (e.g., `@kayn.ai`) is auto-provisioned on first DM. simpler for small teams.

the DM handler checks the user table before processing. unknown users get: "i don't recognize you — ask your admin to add you to tino."

---

## shared vs private resources

this is the core design challenge. some things are shared across the team, some are private to each user. the boundary must be clear and enforced.

### resource classification

| resource | scope | who configures | who can access | examples |
|----------|-------|----------------|----------------|----------|
| **org capabilities** | shared | admin | all users | GitHub repos, Linear workspace, CloudWatch log groups, customer Jira boards |
| **personal capabilities** | private | each user | only that user | their Google Calendar, their Gmail, their Slack reading token |
| **conversation history** | private | automatic | only that user | each user's DM history with tino |
| **preferences** | private | each user | only that user | timezone, summary style, etc. |
| **scheduled tasks** | private | each user | only that user | each user's reminders and scheduled work |
| **org config** | shared | admin | admins only | capability types, model settings, security policies |
| **audit logs** | shared | automatic | admins only | every tool call, every agent run, every data access |

### how shared capabilities work

an org capability (e.g., GitHub) is configured once by an admin: credentials, repo allowlist, settings. all users can use it. the tools are registered for every user's agent session.

but: the tool calls are attributed to the user who triggered them. if austin asks "what does the auth middleware do?", the GitHub API call uses the org's PAT but the audit log shows `user: austin, tool: github_search_code, query: "auth middleware"`.

### how personal capabilities work

a personal capability (e.g., Gmail) is configured by each user individually. each user provides their own OAuth refresh token. the tools are registered only for that user's agent session.

austin's Gmail token can only be used in austin's conversations. if cody asks tino about email, tino uses cody's Gmail token (if configured) or says "you haven't connected Gmail yet."

### the slack reading problem

slack is the hardest case because it's both shared and private:

- **shared channels** (#engineering, #support): everyone can see these. tino should be able to search them for any user.
- **private channels**: only members can see these. tino should only search them when the asking user is a member.
- **DMs**: strictly private. tino should only read a user's DMs when that user asks.

solution: **each user provides their own Slack user token (`xoxp-`)**. tino uses the asking user's token for all Slack operations. this means:
- tino sees exactly what the asking user sees — no more, no less
- private channels are automatically scoped (the token only has access to channels the user is in)
- DMs are automatically scoped (the token only has access to the user's own DMs)
- no central "admin Slack token" that can see everything

this is the same design we have today, just extended to multiple users. each user's `xoxp-` token is stored in their personal capability config, encrypted in DynamoDB.

### data isolation in DynamoDB

the DynamoDB partition key scheme enforces isolation:

```
USER#<userId>#HISTORY → conversation history (private)
USER#<userId>#PREF#<key> → preferences (private)
USER#<userId>#TASK#<taskId> → scheduled tasks (private)
USER#<userId>#CAP#<capId> → personal capability config (private)
ORG#CAP#<capId> → org capability config (shared, admin-only write)
ORG#USER#<userId> → user profile (shared, admin-only write)
AUDIT#<timestamp>#<userId> → audit log entry (shared, admin-only read)
```

DynamoDB's partition key is the access boundary. a user's agent session only queries `USER#<theirUserId>#*` partitions plus `ORG#*` partitions. there is no code path that queries another user's `USER#*` partition.

---

## security model

tino is notorious for security. this section defines the threat model and the controls.

### threat model

| threat | severity | control |
|--------|----------|---------|
| unauthorized user talks to tino | high | user table + allowlist/domain check before any processing |
| user A reads user B's email/calendar/DMs | critical | personal capabilities use per-user tokens; DynamoDB partition isolation |
| user A reads user B's conversation history | high | partition key isolation; no cross-user query path |
| credential leak (token in logs, error messages) | high | pino redaction config; never log credential values; Secrets Manager for org creds |
| model exfiltrates data via tool calls | medium | permission filtering on capability instances; audit logging of every tool call |
| customer data leaks between contexts | high | capability instance isolation labels; per-instance instructions; audit trail |
| admin escalation (member promotes themselves) | medium | role stored in DynamoDB with admin-only write; role check on every console API call |
| tino writes to a read-only customer system | high | permission filtering at tool registration; credential scope as outer boundary |
| prompt injection via tool results | medium | tool results are data, not instructions; system prompt is authoritative; results are truncated |
| DynamoDB data at rest | low | encrypted by default (AWS-managed keys); optionally CMK |
| data in transit | low | all API calls over TLS; Slack Socket Mode over WSS; Bedrock SDK over TLS |

### authentication

**slack DM**: user is authenticated by Slack (the message includes their verified Slack user ID). tino checks the user table. no additional auth needed — Slack is the identity provider for the DM interface.

**web console**: authenticated via Google Workspace SSO (the org's primary IdP). the console checks that the authenticated email matches a user in the user table and that the user has the required role (admin for org config, member for personal config).

**API**: the console's API routes check the session cookie (set by the SSO flow). no API keys, no bearer tokens for the console — session-based auth only.

### authorization

every action checks:
1. **is this user in the user table?** (authentication)
2. **does this user have the required role?** (admin vs member)
3. **is this resource in the user's scope?** (their own data, or shared org data)
4. **does the capability instance's permissions allow this action?** (read/write/delete)

### audit logging

every tool call is logged:

```ts
interface AuditEntry {
  timestamp: number;
  userId: string;
  action: string;              // 'tool_call', 'config_change', 'login', 'capability_toggle'
  toolName?: string;           // 'github_search_code', 'gmail_get_message', etc.
  capabilityInstanceId?: string;
  input?: Record<string, unknown>;  // tool input (redacted: no credential values, no message bodies)
  durationMs?: number;
  status: 'success' | 'error' | 'denied';
  errorMessage?: string;
}
```

audit entries are written to DynamoDB under the `AUDIT#` partition. admins can view them in the console. entries are retained for 90 days (configurable).

what IS logged: tool name, capability instance, input parameters (keys only, not values for sensitive fields), duration, status.

what is NOT logged: credential values, email bodies, message content, file contents. these are redacted at the logging layer (pino redact config).

### credential storage

| credential type | storage | encryption | access |
|-----------------|---------|------------|--------|
| org capability tokens (GitHub PAT, Linear token) | Secrets Manager | AWS-managed KMS | ECS task role only |
| personal capability tokens (Gmail refresh, Slack xoxp-) | DynamoDB (encrypted attribute) | AWS-managed KMS | user's own partition only |
| Slack bot/app tokens | Secrets Manager | AWS-managed KMS | ECS task role only |
| Bedrock model access | IAM role (no stored credential) | n/a | ECS task role only |

personal tokens in DynamoDB are encrypted using a per-user encryption key derived from the org's KMS key. this means even if someone reads the raw DynamoDB item, they can't decrypt another user's tokens without the KMS key.

for the MVP: personal tokens are stored as plaintext in DynamoDB (encrypted at rest by DynamoDB's default encryption). per-user envelope encryption is a v3 hardening step.

---

## resolved: open questions

### instruction conflicts

> if two instances have contradictory instructions, which wins?

**resolution: explicit precedence + conflict detection.**

instructions are assembled in this order (later overrides earlier):
1. base system prompt (tino's core behavior)
2. org-level instructions (set by admin, apply to all users)
3. capability-type instructions (e.g., "all Jira connections should...")
4. capability-instance instructions (e.g., "for RevenueWell Jira specifically...")
5. user-level instructions (personal preferences, set by each user)

when tino is working across contexts (e.g., a task that touches both internal Linear and customer Jira), the instance-specific instructions for EACH active instance are included, prefixed with the instance name:

```
[for jira-revenuewell]: focus on issues tagged 'integration'. read-only — never create or modify.
[for linear-internal]: full access. investigate thoroughly before posting findings.
```

if instructions genuinely conflict (one says "always create issues" and another says "never create issues"), the MORE RESTRICTIVE instruction wins. this is the security-default-deny principle: when in doubt, don't act.

the console flags potential conflicts at config time: if two instances of the same type have contradictory permission flags (one write-enabled, one read-only), show a warning. not a blocker — the admin may intend this — but a visible signal.

### isolation granularity

> is per-instance isolation enough, or do we need per-field isolation?

**resolution: per-instance for v2, per-field deferred to v3 with a clear trigger.**

per-instance isolation means: data from instance A is either fully visible or fully invisible to instance B. there's no "share titles but not descriptions."

this is sufficient when:
- customer systems are fully isolated from each other (canShareWith: [])
- internal systems share freely (canShareWith: ['*'])
- the boundary is "which system" not "which field within a system"

per-field isolation becomes necessary when:
- you want to share issue titles across contexts for cross-referencing but keep descriptions private
- you want to share user names but not email addresses
- you have compliance requirements that specific fields (PHI, PII) must never leave a context

**trigger for v3:** if an admin configures a capability instance and says "i want to share some fields but not others," that's the signal to build per-field isolation. until then, per-instance is the right granularity.

implementation sketch for v3: each field in a tool result is tagged with a sensitivity level (public, internal, restricted). the isolation engine filters fields based on the requesting context's sharing rules. this requires schema-level metadata on every tool's return type — significant work, but well-defined.

### MCP server lifecycle

> who starts/stops the MCP server?

**resolution: three tiers, user chooses per instance.**

**tier 1: external (user-managed).** the MCP server runs as a separate process, container, or service. tino connects to it via the configured endpoint. the user is responsible for starting, stopping, and updating it. this is the default for production deployments.

**tier 2: sidecar (tino-managed, same host).** tino spawns the MCP server as a child process on startup, using a configured command (e.g., `npx @atlassian/mcp-server`). tino monitors the process and restarts it if it crashes. the MCP server runs on the same host as tino (same ECS task, different process). good for simple setups where the MCP server is lightweight.

**tier 3: on-demand (tino-managed, ephemeral).** tino starts the MCP server only when a tool from that capability is called, and stops it after a configurable idle timeout. minimizes resource usage for rarely-used capabilities. implemented via child process spawn + idle timer.

the capability instance config specifies which tier:

```ts
mcpServer?: {
  tier: 'external' | 'sidecar' | 'on-demand';
  // tier 1: external
  endpoint?: string;                // 'http://localhost:3002'
  // tier 2/3: tino-managed
  command?: string;                 // 'npx @atlassian/mcp-server'
  args?: string[];
  env?: Record<string, string>;     // env vars passed to the MCP server (credentials, etc.)
  idleTimeoutMs?: number;           // tier 3 only: stop after this much idle time
};
```

for v2.2 (first MCP integration): implement tier 1 only. tier 2 and 3 are v3.

### credential rotation

> when a token expires, how does tino handle it?

**resolution: detect → notify → auto-refresh where possible.**

**detection:** every tool call that returns an auth error (401, 403, `invalid_grant`, `token_revoked`) triggers the credential-expiry flow. the capability instance is marked as `status: 'auth_error'` in the config.

**notification:** tino DMs the affected user (for personal capabilities) or all admins (for org capabilities):

> "your gmail connection stopped working — the refresh token may have expired. visit the console to reconnect, or run `pnpm tsx scripts/google-auth.ts` to get a new token."

the console shows the capability with a red "auth error" badge and a "reconnect" button.

**auto-refresh (where the protocol supports it):**
- **OAuth2 refresh tokens** (Google, Atlassian): the OAuth2 client automatically refreshes the access token using the refresh token. if the refresh token itself expires (Google: 6 months of inactivity), tino detects the failure and notifies.
- **API keys** (GitHub PAT, Linear): no auto-refresh possible. tino detects the 401 and notifies.
- **Slack tokens**: bot tokens (`xoxb-`) don't expire. user tokens (`xoxp-`) don't expire but can be revoked. tino detects revocation and notifies.

**grace period:** when an auth error is detected, tino retries once after 60 seconds (in case it was a transient error). if the retry also fails, the capability is marked as errored and the notification is sent. tino does not keep retrying — it waits for the user to fix the credential.

**findWork behavior during auth error:** if a capability's findWork poller encounters an auth error, the poller pauses for that instance (stops polling) and resumes only after the credential is updated. this prevents hammering an expired token every 15 minutes.

### cost tracking

> should the console show cost estimates per capability instance?

**resolution: yes. track token usage per user per capability instance. surface in the console and in a weekly digest.**

**what to track:**

```ts
interface UsageEntry {
  userId: string;
  capabilityInstanceId: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
}
```

the AI SDK's `result.usage` already provides `{ inputTokens, outputTokens }` per call. write a usage entry to DynamoDB after every `generateText` call, tagged with the user and the capability instance(s) that were active.

**cost estimation:** Bedrock pricing is per-token, per-model. store the price-per-token for each model in config (updated manually — Bedrock pricing changes rarely). multiply usage × price for the estimate.

**console display:**
- per-user: "austin used 45,000 tokens this week (~$0.12)"
- per-capability: "GitHub tools: 120,000 tokens this week (~$0.32)"
- per-instance: "jira-revenuewell findWork: 30,000 tokens this week (~$0.08)"
- total: "org total: 500,000 tokens this week (~$1.35)"

**weekly digest:** tino DMs each user their weekly usage summary. admins get the org-wide summary.

**budget alerts:** configurable per-user and org-wide token budgets. when 80% of the budget is reached, tino DMs a warning. at 100%, tino stops autonomous work (findWork pollers pause) but still responds to direct DMs. this prevents runaway costs from misconfigured findWork intervals or overly chatty agent loops.

---

## console evolution for multi-user

### admin console

accessible to users with `role: 'admin'`. shows:

- **users**: list of all tino users, their role, last active, personal capabilities configured
- **org capabilities**: manage shared capabilities (GitHub, Linear, CloudWatch, customer Jira boards)
- **security**: audit log viewer, active sessions, credential status across all capabilities
- **usage**: org-wide token usage, cost estimates, budget alerts
- **settings**: org-level config (allowed domains, default model, security policies)

### user console

accessible to all users. shows:

- **my capabilities**: personal capabilities (Gmail, Calendar, Slack reading) with setup/edit
- **shared capabilities**: read-only view of org capabilities (what's available to me)
- **my usage**: personal token usage and cost estimate
- **preferences**: timezone, summary style, notification preferences

### authentication

**v2 (MVP):** Google Workspace SSO. the console redirects to Google Sign-In, verifies the `hd` (hosted domain) claim matches the org's domain, checks the user table, sets a session cookie. this is the approach we deferred earlier — now it's needed for multi-user.

**v3:** support additional IdPs (AWS Identity Center, Okta, generic OIDC). the console's auth layer is pluggable — swap the IdP without changing the rest of the console.

---

## implementation sequence (revised)

### v2.1: capability instances + permissions
- evolve `CapabilityConfig` → `CapabilityInstance`
- add `permissions`, `instructions`, `isolation` fields
- update the registry to filter tools by permissions
- update the console to manage instances
- migrate existing capabilities to single-instance format

### v2.2: MCP integration
- add MCP server connection support (tier 1: external only)
- implement tool discovery from MCP servers
- wire permission filtering on MCP-discovered tools
- build the Atlassian Jira capability type as the first MCP consumer

### v2.3: multi-user
- user table in DynamoDB
- per-user conversation history, preferences, tasks (partition key isolation)
- personal vs org capability distinction
- per-user Slack token for Slack reading tools
- allowlist/domain-based access control
- admin vs member roles

### v2.4: console auth + admin UI
- Google Workspace SSO for the console
- admin console (users, org capabilities, audit logs, usage)
- user console (personal capabilities, preferences, usage)
- move console from localhost-only to SSO-protected

### v2.5: security hardening
- audit logging to DynamoDB (every tool call, config change, login)
- credential encryption (per-user envelope encryption via KMS)
- budget alerts and usage tracking
- credential rotation detection + notification
- security policy enforcement (org-level: which capability types are allowed, max findWork frequency, etc.)

### v2.6: onboarding flow
- guided setup in the console (first-time experience)
- "test connection" for each capability
- nudge loop in the system prompt
- instruction templates for common patterns
- weekly usage digest DMs

### v2.7: data isolation (hard enforcement)
- tag tool results with instance isolation labels
- filter data in prompt assembly based on sharing rules
- separate conversation contexts per isolation group
- audit logging of cross-context data access attempts

### v3.0: advanced
- per-field isolation (sensitivity-tagged tool result schemas)
- MCP server lifecycle management (tier 2: sidecar, tier 3: on-demand)
- pluggable IdP support (OIDC, SAML)
- team-level capabilities (shared between a subset of users, not the whole org)
- tino-to-tino communication (multiple tino instances sharing context across orgs — far future)
