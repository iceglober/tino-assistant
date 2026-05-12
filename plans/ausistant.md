# Ausistant — Personal Claude Slack Agent

## Goal

Build a locally-run TypeScript Node process that serves as a single-user personal assistant over Slack DM, backed by Claude Sonnet on Amazon Bedrock via the Vercel AI SDK, with a tight toolbelt (≤10 tools) for GitHub code search, CloudWatch logs aggregates (read-only, heavily validated), Google Calendar, and Gmail (label-filtered). Persistent per-user conversation history, structured logging, and an allowlist that refuses anyone but the owner.

## Constraints

- **Runtime:** Node 22 LTS, TypeScript strict, ESM, pnpm. Dev loop via `tsx watch`. No bundler.
- **Auth:** AWS via default credential chain (`~/.aws/credentials` / `AWS_PROFILE`). Slack bot + app tokens, GitHub PAT, Google refresh token in `.env` (gitignored). Single-user: hardcoded `ALLOWED_SLACK_USER_ID`.
- **Framework:** Vercel AI SDK v6 (`ai` + `@ai-sdk/amazon-bedrock`). The SDK owns the tool-calling loop via `generateText({ tools, stopWhen })` — no hand-rolled loop.
- **Slack mode:** Socket Mode only. No public HTTP. Bot scopes limited to DM surface (`im:history`, `im:read`, `im:write`, `chat:write`). Event subscription: `message.im`. `app.message()` handler filters on `channel_type === 'im'` and `user === ALLOWED_SLACK_USER_ID`; all other events ignored silently.
- **Model:** Claude Sonnet cross-region inference profile on Bedrock. Stored as `BEDROCK_MODEL_ID` env var (starting value: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`; verify in Bedrock console before wiring — user mentioned "4.6", use the newest profile the console shows).
- **Tool budget:** Hard cap 10. Day-one set = 5 (`github_search_code`, `github_get_file`, `cloudwatch_logs_query`, `calendar_list_events`, `gmail_search`). `/reset` is a Slack command, not a tool. The "ask before running" wrapper for CloudWatch uses the AI SDK's built-in `needsApproval`.
- **Testing:** `vitest`. The CloudWatch validator and Gmail query-rewriter each ship with test suites that must pass before the tools are registered.

## Acceptance criteria

- [x] **a1 — Scaffold.** Clean pnpm + strict TypeScript ESM scaffold. `pnpm dev` starts tsx watch pointed at `src/index.ts`, which logs a startup line and exits cleanly on SIGINT. `.env` is gitignored and `.env.example` documents every required variable. Typecheck passes. Verify: `pnpm install && pnpm typecheck`.
- [x] **a2 — Echo bot (DM-only, allowlisted).** Slack Socket Mode bot connects with xapp-/xoxb- tokens and echoes DMs back verbatim, but ONLY to the allowlisted user ID. Messages from any other user in any other DM are dropped silently (logged, not replied to). Bot does not respond in channels, threads, or group DMs. Verify: `pnpm test -- tests/slack/allowlist.test.ts`.
- [ ] **a3 — Agent loop.** DMs from the allowlisted user are forwarded to Claude Sonnet on Bedrock via the AI SDK, and the final text response is posted back. Multi-turn context preserved per user via in-memory `Map<userId, ModelMessage[]>`, capped at 40 messages. `generateText` uses `stopWhen: stepCountIs(10)`. AWS creds from default provider chain. Verify: `pnpm test -- tests/agent/history.test.ts`.
- [ ] **a4 — GitHub tools.** Agent answers "what does our auth middleware do?" by calling `github_search_code` then `github_get_file`. Tools defined via AI SDK `tool()` helper with Zod inputSchemas; responses truncated to 50KB before returning to the model. Verify: `pnpm test -- tests/tools/github.test.ts`.
- [ ] **a5 — CloudWatch validator.** The CloudWatch logs tool refuses every adversarial query before the tool is registered. Allowed: single Logs Insights query against an allowlisted log group, containing a `| stats` clause, no forbidden pipes (`parse`, `display`, `fields` as terminal, `head`). `| limit 1000` auto-injected if absent. Verify: `pnpm test -- tests/tools/cloudwatch-validator.test.ts`.
- [ ] **a6 — Google Calendar.** Agent answers "what's on my calendar tomorrow?" by calling `calendar_list_events`. Uses googleapis with refresh token. Returns normalized `{ summary, start, end, location, attendees }`. Verify: `pnpm test -- tests/tools/calendar.test.ts`.
- [ ] **a7 — Gmail rewriter.** Gmail tool ONLY ever queries Gmail with `label:assistant-ok` prepended. Rewriter refuses any input containing `-label:`, `NOT label:`, or a `label:` token referencing any label other than `assistant-ok`. Returns metadata only (no body). Verify: `pnpm test -- tests/tools/gmail-rewriter.test.ts`.
- [ ] **a8 — Polish.** Conversation history persists across restarts in SQLite (`ausistant.db`). Structured logs (pino) record every Bedrock call and tool invocation with `{ traceId, user, toolName, durationMs, status }` — never raw tool output body. CloudWatch tool uses AI SDK's `needsApproval` so Claude surfaces a confirmation in Slack. `/reset` command wipes that user's history. Verify: `pnpm test -- tests/persistence tests/tools/cloudwatch-approval.test.ts`.

## File-level changes

All files are new — greenfield repo.

### Phase 1 — Scaffold

**Prerequisites (user, out-of-band):** none.

- **`package.json`** — `"type": "module"`, `"engines": { "node": ">=22" }`, scripts: `dev` (`tsx watch src/index.ts`), `start`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch`. Deps: `ai`, `@ai-sdk/amazon-bedrock`, `@aws-sdk/credential-providers`, `@slack/bolt`, `zod`, `dotenv`, `pino`, `pino-pretty`. Dev deps: `typescript`, `tsx`, `vitest`, `@types/node`.
- **`tsconfig.json`** — `strict`, `noUncheckedIndexedAccess`, `module: nodenext`, `moduleResolution: nodenext`, `target: es2022`, `esModuleInterop`, `skipLibCheck`, `rootDir: src`.
- **`.nvmrc`** — `22`.
- **`.gitignore`** — `node_modules/`, `.env`, `.env.local`, `*.db`, `*.db-journal`, `dist/`, `.DS_Store`, `*.log`.
- **`.env.example`** — Every required var with empty value and comment: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ALLOWED_SLACK_USER_ID`, `AWS_PROFILE` (optional), `AWS_REGION=us-east-1`, `BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0`, `GITHUB_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `LOG_LEVEL=info`.
- **`src/index.ts`** — Loads `dotenv/config`, builds logger, wires Bolt app (echo handler for now), installs `SIGINT`/`SIGTERM` handlers that call `app.stop()` then exit. Logs "ausistant starting" at INFO.
- **`src/env.ts`** — Zod schema that parses `process.env` into typed `Env`. Fails fast if required vars missing.
- **`README.md`** — Setup: prereqs, env vars, `pnpm install && pnpm dev`, troubleshooting block.

### Phase 2 — Echo bot (DM-only, allowlisted)

**Prerequisites (user, out-of-band):**
1. Create Slack app at api.slack.com/apps → From scratch.
2. Enable Socket Mode; generate App-Level Token (`xapp-`) with `connections:write`.
3. OAuth & Permissions → Bot scopes: `im:history`, `im:read`, `im:write`, `chat:write`. Install; copy Bot Token (`xoxb-`).
4. Event Subscriptions → subscribe to bot event: `message.im`.
5. App Home → enable Messages Tab, "Allow users to send Slash commands and messages from the messages tab."
6. DM the bot once to open the DM channel, then copy your Slack user ID.
7. Put `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ALLOWED_SLACK_USER_ID` in `.env`.

- **`src/slack/app.ts`** — `createSlackApp(env, onDmFromOwner: (userId, text) => Promise<string>)` factory. Registers single `app.message()` handler: narrows on `message.subtype === undefined`, guards `channel_type === 'im'`, guards `user === ALLOWED_SLACK_USER_ID` (otherwise warn-log and return), calls `onDmFromOwner`, replies via `say({ text })`.
- **`src/slack/types.ts`** — Local narrowed type aliases for `GenericMessageEvent`.
- **`tests/slack/allowlist.test.ts`** — Cases: owner DM (pass), non-owner DM (drop), owner in channel (drop), `thread_broadcast` subtype (drop), `bot_message` subtype (drop).
- **`src/index.ts` (modified)** — Wires `createSlackApp(env, async (_u, text) => text)` for the echo phase.

**Phase 2 "done when":** DM the bot "hi" from your account → replies "hi". DM from any other account → no reply, warn log. Channel mention → ignored.

### Phase 3 — Bedrock + AI SDK agent loop

**Prerequisites (user, out-of-band):**
1. Confirm Bedrock model access for Claude Sonnet on your AWS work account (Bedrock console → Model access).
2. `aws sts get-caller-identity` works with your profile. If using a named profile, set `AWS_PROFILE=<name>` in `.env`.

- **`src/agent/bedrock.ts`** — `createBedrockModel(env)` → `createAmazonBedrock({ region, credentialProvider: fromNodeProviderChain({ profile: env.AWS_PROFILE }) })(env.BEDROCK_MODEL_ID)`.
- **`src/agent/history.ts`** — `createHistoryStore({ cap = 40 })` with `get`/`append`/`reset`. In-memory `Map<string, ModelMessage[]>`. Trim in assistant/tool pairs (never orphan a `tool` role message from its preceding `assistant` tool-call).
- **`src/agent/run.ts`** — `runAgent({ model, tools, systemPrompt, history, userId, text, logger })`. Appends user message, calls `generateText({ model, messages, tools, stopWhen: stepCountIs(10), system })`, appends `response.messages`, returns `result.text || '(no response)'`. Tool lifecycle callbacks log `{ toolName, durationMs, status }` — never the output body.
- **`src/agent/systemPrompt.ts`** — Single constant string describing purpose, tools, cite-sources instruction, ask-before-expensive-queries instruction.
- **`tests/agent/history.test.ts`** — Cap trimming, tool/assistant pair integrity, reset.
- **`src/index.ts` (modified)** — Builds history store + Bedrock model, passes `runAgent` as `onDmFromOwner` handler. Empty tools object for Phase 3.

**Phase 3 "done when":** DM "what's 2+2 plus the capital of France?" → Claude answers. Second DM "multiply that by itself" → remembers prior answer.

### Phase 4 — GitHub code search + file fetch

**Prerequisites (user, out-of-band):**
1. Create GitHub PAT (classic) with `repo` scope for private repos; no scope for public-only.
2. Put `GITHUB_TOKEN=ghp_...` in `.env`.

- **`src/tools/github/client.ts`** — `createOctokit(env) => Octokit` with `auth: env.GITHUB_TOKEN`.
- **`src/tools/github/search.ts`** — `githubSearchCodeTool(octokit)` with Zod schema `{ query: string, repo?: string }`. Calls `octokit.search.code({ q: repo ? \`${query} repo:${repo}\` : query, per_page: 10 })`. Maps to `{ path, repository, htmlUrl, snippet }` (snippet truncated to 200 chars). Handles 403/429 with `{ error: 'rate_limited' }`.
- **`src/tools/github/getFile.ts`** — `githubGetFileTool(octokit)` with schema `{ owner, repo, path, ref? }`. Calls `octokit.repos.getContent`, base64-decodes, returns `{ path, content, truncated }` (truncate to 50KB).
- **`src/tools/index.ts`** — `buildTools(env)` returning `{ github_search_code, github_get_file, ... }`.
- **`tests/tools/github.test.ts`** — Truncation boundary, repo-prefix behavior, rate-limit error shape. Mocks Octokit.
- **`src/index.ts` (modified)** — Calls `buildTools(env)` and passes into `runAgent`.

**Phase 4 "done when":** "What does our auth middleware do? Look in owner/my-repo" → Claude calls search, picks top hit, calls getFile, summarizes.

### Phase 5 — CloudWatch Logs Insights (validator-first)

**Prerequisites (user, out-of-band):**
1. AWS profile has `logs:StartQuery`, `logs:GetQueryResults`, `logs:StopQuery` on target log groups (IAM scoped to specific group ARNs strongly preferred as defense-in-depth).
2. Decide Day-One allowlist of log group names.

- **`src/tools/cloudwatch/allowlist.ts`** — `export const ALLOWED_LOG_GROUPS: readonly string[] = []` with `// TODO: populate before enabling tool`. Ships empty → tool fails-closed until user edits.
- **`src/tools/cloudwatch/validator.ts`** — Pure `validateLogsInsightsQuery(query, logGroupName, allowlist) → { ok: true, rewritten } | { ok: false, reason }`. Rules:
  - Reject if `logGroupName` not in allowlist.
  - Reject if matches `/\|\s*(parse|display|unmask)\b/i`.
  - Reject if matches `/\|\s*fields\b/i` UNLESS followed immediately by bare projections before a `| stats`.
  - Reject if does NOT contain `/\|\s*stats\b/i`.
  - Reject if contains `/\|\s*head\b/i`.
  - Auto-inject `| limit 1000` if no `| limit <N>`.
- **`tests/tools/cloudwatch-validator.test.ts`** — ~20 adversarial cases enumerated (see Open Questions for any borderline cases to add). Must include: no-stats reject, head reject, parse reject anywhere in query, display reject, non-allowlisted group reject, empty allowlist rejects everything, limit auto-injection, case-variation acceptance, stats-with-pre-stats-fields acceptance.
- **`src/tools/cloudwatch/client.ts`** — `createCloudWatchLogsClient(env)` with `fromNodeProviderChain`.
- **`src/tools/cloudwatch/query.ts`** — `cloudwatchLogsQueryTool(client)` with `needsApproval: true`. Schema: `{ logGroupName, query, startTimeIso, endTimeIso }`. Runs validator first; on `ok: false` returns `{ error, reason }` without AWS call. Otherwise `StartQueryCommand` → poll `GetQueryResultsCommand` every 1s up to 30s. Truncates to top 100 rows. Logs `{ logGroup, rewrittenQuery, rowCount, durationMs }`.
- **`tests/tools/cloudwatch-approval.test.ts`** — Verifies tool declaration includes `needsApproval: true`.
- **`src/tools/index.ts` (modified)** — Appends `cloudwatch_logs_query`.

**Phase 5 "done when":** All validator tests pass, tool registered, "how many 5xx errors did the api have in the last hour?" triggers approval prompt, approval runs query, response summarized.

### Phase 6 — Google Calendar (readonly)

**Prerequisites (user, out-of-band):**
1. console.cloud.google.com → new project "ausistant".
2. APIs & Services → Enable Google Calendar API.
3. OAuth consent screen → External, test user = your email.
4. Credentials → OAuth client ID → **Desktop app**. Download JSON. Put `client_id` and `client_secret` in `.env`.
5. Run `pnpm tsx scripts/google-auth.ts` — obtains refresh token. Paste into `.env` as `GOOGLE_OAUTH_REFRESH_TOKEN`.

- **`scripts/google-auth.ts`** — CLI script. Takes `--scopes` (default `calendar.readonly`). Spins up localhost:42069 server, opens consent URL, exchanges code for tokens, prints refresh token, exits.
- **`src/tools/google/oauth.ts`** — `createGoogleAuth(env)` returning `google.auth.OAuth2` with client id/secret set and `setCredentials({ refresh_token })`. Shared by Calendar and Gmail.
- **`src/tools/google/calendar.ts`** — `calendarListEventsTool(auth)` with schema `{ calendarId: default 'primary', timeMinIso, timeMaxIso, maxResults: max 50 default 10 }`. Calls `calendar.events.list`. Maps to `{ summary, start, end, location?, attendees?: [{ email, responseStatus }] }`. Does NOT surface raw iCal or event descriptions (work calendar may contain PHI).
- **`tests/tools/calendar.test.ts`** — All-day flagging (date vs dateTime), attendee normalization, maxResults enforcement.
- **`src/tools/index.ts` (modified)** — Appends `calendar_list_events`.

**Phase 6 "done when":** "What's on my calendar tomorrow?" → Claude computes tomorrow in user TZ, calls tool, summarizes.

### Phase 7 — Gmail with hard label filter

**Prerequisites (user, out-of-band):**
1. **Gmail filter rules FIRST.** Gmail → Settings → Filters → Create filter. Rules that auto-apply `assistant-ok` label to mail you're comfortable having the agent read. Exclude work email, PHI-adjacent senders, etc. This is the PHI-containment work.
2. Manually apply `assistant-ok` to a few test messages.
3. Re-run `scripts/google-auth.ts --scopes calendar.readonly,gmail.readonly`. Replace `GOOGLE_OAUTH_REFRESH_TOKEN` with new value (Phase 6 token is obsolete).

- **`src/tools/google/gmailRewriter.ts`** — Pure `rewriteGmailQuery(raw) → { ok: true, query } | { ok: false, reason }`. Rules:
  - Reject if contains `/\blabel:\S+/i` matching anything not exactly `label:assistant-ok`.
  - Reject if contains `/-label:/i`.
  - Reject if contains `/\bNOT\s+label:/i`.
  - Reject if contains `/\bin:(spam|trash)\b/i`.
  - Empty string → reject (force a real query).
  - Else: rewrite to `label:assistant-ok ${raw}`. If input already starts with `label:assistant-ok`, pass through unchanged.
- **`tests/tools/gmail-rewriter.test.ts`** — Enumerated: `from:mom` → prepends. `-label:assistant-ok` → reject. `NOT label:assistant-ok` → reject. `label:other` → reject. `label:assistant-ok from:mom` → pass-through. `(from:mom OR -label:assistant-ok)` → reject. `LABEL:OTHER` (case) → reject. Empty string → reject.
- **`src/tools/google/gmail.ts`** — `gmailSearchTool(auth)` with schema `{ query, maxResults: max 20 default 10 }`. Runs rewriter; on `ok: false` returns `{ error, reason }` without Gmail call. Otherwise `gmail.users.messages.list({ q: rewritten, maxResults })`, then for each id `gmail.users.messages.get({ format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] })`. Returns `{ id, threadId, subject, from, snippet, internalDate }`. **No body ever.**
- **`src/tools/index.ts` (modified)** — Appends `gmail_search`.

**Phase 7 "done when":** All rewriter tests pass. "What email did I get from mom about the trip?" (with a labeled message) returns subject + from. Asking about unlabeled mail returns empty, not a bypass.

### Phase 8 — Polish: SQLite, logging, /reset, approval UI

**Prerequisites (user, out-of-band):** none.

- **`src/persistence/sqlite.ts`** — `better-sqlite3`. Single table `conversations (user_id TEXT PRIMARY KEY, messages_json TEXT NOT NULL, updated_at INTEGER NOT NULL)`. `init()` creates table if missing. `createSqliteHistoryStore({ dbPath, cap = 40 })` matches `src/agent/history.ts` interface.
- **`tests/persistence/sqlite-history.test.ts`** — Create store, append, reopen with new instance pointed at same tempfile, verify round-trip.
- **`src/logging/logger.ts`** — `createLogger(env)` returns pino. Dev: pretty-print. Redact keys: `authorization`, `cookie`, `output`, `body`, `snippet`, `content`, `messages`. Level from `env.LOG_LEVEL`.
- **`src/slack/reset.ts`** — Second `app.message()` handler matching `/^\/reset$/i` (trimmed). Same DM+allowlist guard. Calls `history.reset(userId)`, replies "History cleared." Register BEFORE the generic handler.
- **`src/slack/approval.ts`** — When `generateText` returns `tool-approval-request` parts, post: "I want to run `cloudwatch_logs_query` on `<group>` with query: ```<query>```. Reply `approve` or `deny`." Store pending approval keyed by `(userId, messageTs)` in in-memory map. Next DM from user: if `approve`/`deny`, construct `tool-approval-response` and re-run `generateText`. Otherwise: cancel pending approval, treat as new message.
- **`src/index.ts` (modified)** — Swaps in-memory history for SQLite. Registers `/reset` handler. Wires approval middleware.
- **Optional `.env`:** `DB_PATH=./ausistant.db`.

**Phase 8 "done when":** Restart → conversation persists. `/reset` wipes it. CloudWatch query triggers approval DM; `approve` runs it, `deny` makes Claude pivot. Logs are readable JSON with no raw tool output bodies.

## Test plan

- **Unit (vitest):** all `tests/**/*.test.ts` files above. `pnpm test`. Gates: allowlist, agent/history, github truncation, cloudwatch validator (~20 adversarial cases), calendar normalization, gmail rewriter (all bypass attempts), sqlite round-trip, approval declaration.
- **Integration (manual):** each phase's "done when" at the bottom of each section. Require real credentials; not automated.
- **Smoke script (optional):** `scripts/smoke.ts` pings each tool with canned input.

## Out of scope

- Multi-user support. Single `ALLOWED_SLACK_USER_ID`.
- Any cloud deployment.
- OAuth UI / Slack OAuth flow for distribution.
- Streaming responses. `generateText` only.
- MCP tool integration.
- Block Kit UI for approvals. Plain-text DM approvals sufficient.
- Gmail body reads. `format: 'metadata'` only. A separate `gmail_get_message` tool would have its own threat model.
- Calendar writes. `calendar.readonly` only.
- GitHub writes. Read-only.
- Production observability (OTel, distributed tracing).
- Dynamic tool loading.

## Open questions

- **Model ID verification.** User wrote "Sonnet 4.6". AI SDK / Bedrock console may list 4.5 as current cross-region Sonnet profile. Before Phase 3, verify exact ID in Bedrock console → Inference profiles. Env var `BEDROCK_MODEL_ID` is a one-line change.
- **AWS region.** `us-east-1` is default. Confirm work account has Sonnet access in chosen region. Bedrock and CloudWatch Logs clients are independent — different regions are fine.
- **Gmail label case.** Filter label is `assistant-ok` (lowercase, hyphenated). Gmail labels are case-insensitive on search; the rewriter uses case-insensitive match.
- **Approval flow for other tools.** Only CloudWatch has `needsApproval: true` day-one. GitHub file reads over 10KB as approval-gated? Probably not for single-user read-only; flag as future consideration.
- **SQLite schema migration story.** None. If schema changes in v1, blow the file away. Acceptable for a personal tool.
