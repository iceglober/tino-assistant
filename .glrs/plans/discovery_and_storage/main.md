# Storage Simplification + Discovery Redesign

## Problem

Two related problems that share enough surface area to ship together.

### Storage: appDataFolder sprawl

Four different data types are stored in each user's Google Drive appDataFolder: encryption key, preferences, privacy config, and discovery results. Each has its own adapter with a "try Drive first, fall back to DynamoDB" pattern. This creates three problems:

1. **Silent data loss.** All three data adapters write to Drive and `return` on success, skipping DynamoDB entirely. If Drive works, DynamoDB never sees the data. Any server-side reader (the agent, the API, a migration) that hits DynamoDB directly gets nothing. This is how discovery results disappeared after a table wipe — they only existed in Drive.

2. **Divergent state.** When Drive and DynamoDB both have data, there's no reconciliation. The "read Drive first" pattern means DynamoDB can hold stale data indefinitely without anyone noticing. There's no version vector, no last-write-wins timestamp, no conflict detection.

3. **Coupling explosion.** Adding a new storage integration means building another appDataFolder adapter, wiring another `resolveClient` dependency, handling another set of Drive API errors (auth_failed, scope_missing, rate_limited, network). The total surface area scales linearly with the number of integrations.

### Discovery: too shallow to be useful

Discovery produces a generic role summary, a flat list of duties, and contact categories — but tino can't answer basic questions about the user like "who do I report to?", "what's my communication style?", or "what should I focus on today?". The results aren't injected into the agent's system prompt at all, so even the data we do collect is invisible to tino during DMs.

The discovery prompt is also limited to email contacts/labels and calendar events. Slack data (search, DMs, channels) is available for users who connected `slack-personal` but isn't used.

## Solution

### Storage: key-only in appDataFolder

Only the per-user encryption key (`encryption-key.json`) lives in Drive. Everything else goes to DynamoDB. This matches the pattern `createEncryptedHistoryStore` already uses — key from Drive, data in DynamoDB.

- Preferences, privacy config, discovery: stored in DynamoDB directly (no Drive adapter)
- Privacy config: already encrypted via KMS `CryptoAdapter` in the DynamoDB path
- Preferences and discovery: stored as plaintext JSON in DynamoDB config store (non-sensitive, derived from already-accessible data)
- History: unchanged — encrypted with Drive DEK, stored in DynamoDB

Adding a new storage integration in the future = encrypt with DEK if sensitive, write to DynamoDB. No Drive adapter needed.

### Discovery: structured user profile

Replace the current flat schema with a structured profile that directly answers the questions tino needs to answer. Add Slack as a data source. Inject the result into the agent's system prompt.

## Waves

| Wave | Scope | Description |
|------|-------|-------------|
| [0](wave_0.md) | Storage simplification | Remove Drive adapters for preferences, privacy config, discovery. Wire DynamoDB stores directly. Delete dead code. |
| [1](wave_1.md) | Discovery redesign | New schema, new prompt, Slack data source, richer analysis. |
| [2](wave_2.md) | Discovery into system prompt | Pass discovery result to `buildSystemPrompt`, wire `configStore` to all `runAgent` call sites. |

## Verification

After all waves:
1. `bun --bun vitest run` passes from `packages/core`
2. Deploy → admin signs in → runs discovery → sees richer profile in Customize page
3. DM tino "tell me about my role" → tino answers with specifics from the discovery profile
4. DM tino "who do I work with most?" → tino answers with contact graph details
5. Wipe DynamoDB, re-sign in, re-run discovery → results persist (no Drive dependency)
6. `appDataFolder` contains only `encryption-key.json` (check via Drive API or console)
