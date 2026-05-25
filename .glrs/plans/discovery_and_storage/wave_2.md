# Wave 2: Discovery into System Prompt

## Goal

Inject the user's discovery profile into the agent's system prompt so tino can answer questions about the user's role, org, work patterns, and relationships. Also fix the missing `configStore` in all three `runAgent` call sites, which currently prevents both instructions and discovery from loading.

## Current State

- `buildSystemPrompt()` in `src/agent/systemPrompt.ts` takes `{ activeCapabilities, toolNames, instructions }`. No discovery parameter.
- `runAgent()` in `src/agent/run.ts` accepts an optional `configStore` and uses it to load instructions. No discovery loading.
- All three `runAgent` call sites in `src/index.ts` omit `configStore`:
  - **DM handler** (line ~295): `configStore` is in closure scope but not passed
  - **findWork callback** (line ~192): same
  - **Task scheduler** (line ~349): same
- This means instructions are also not loading for any agent run. Fixing `configStore` fixes both instructions and discovery.

## Changes

### 2a. Pass `configStore` to all `runAgent` call sites

**Edit:** `src/index.ts`

Add `configStore` to all three `runAgent` calls:

```typescript
// DM handler (~line 295)
return runAgent({
  model,
  history: wrappedHistory,
  historyAppender,
  logger,
  tools,
  userId,
  text,
  auditLogger,
  activeCapabilities,
  configStore,         // <-- add
});

// findWork callback (~line 192)
const result = await runAgent({
  model,
  history: taskHistory,
  historyAppender: taskHistoryAppender,
  logger,
  tools,
  userId: SYSTEM_USER_ID,
  text: prompt,
  auditLogger,
  activeCapabilities,
  configStore,         // <-- add
});

// Task scheduler (~line 349)
return runAgent({
  model,
  history: taskHistory,
  historyAppender: taskHistoryAppender,
  logger,
  tools,
  userId: task.userId,
  text: taskPrompt,
  auditLogger,
  activeCapabilities,
  configStore,         // <-- add
});
```

### 2b. Load discovery result in `runAgent`

**Edit:** `src/agent/run.ts`

After loading instructions, load the discovery result from the config store:

```typescript
import type { DiscoveryResult } from "../discovery/types.js";

// Inside runAgent(), after the instructions load:
let discovery: DiscoveryResult | undefined;
if (configStore) {
  const raw = await configStore.get(`user.${userId}.discovery_result`);
  if (raw) {
    try { discovery = JSON.parse(raw) as DiscoveryResult; }
    catch { /* ignore malformed */ }
  }
}

const start = Date.now();
const result = await generateText({
  model,
  system: buildSystemPrompt({ activeCapabilities, toolNames: Object.keys(tools ?? {}), instructions, discovery }),
  ...
});
```

### 2c. Add discovery to `buildSystemPrompt`

**Edit:** `src/agent/systemPrompt.ts`

Add `discovery?: DiscoveryResult` to the opts parameter. Render a "User Profile" section after the always-on prefix, before capability tool bullets:

```typescript
export function buildSystemPrompt(opts: {
  activeCapabilities: string[];
  toolNames: string[];
  instructions?: { ... };
  discovery?: DiscoveryResult;
}): string {
```

The User Profile section:

```
User Profile:
This is what you know about the person you're assisting. Use this to personalize your answers, anticipate their needs, and ground your responses in their actual work context.

Role: {inferredTitle} — {inferredDepartment}
{roleSummary}

Key relationships:
- {name} ({relationship}) — {context}, {interactionFrequency}
...

Responsibilities:
Daily: {daily responsibilities}
Weekly: {weekly responsibilities}
Monthly/Quarterly: {monthly/quarterly responsibilities}
Ongoing: {ongoing responsibilities}

Communication style:
{communicationStyle.summary}
Preferred channels: {preferredChannels}

Work patterns:
Meeting load: {meetingLoad}
Peak hours: {peakHours}
Time investment: {category}: ~{pct}% ...

Known pain points:
- {painPoint}
...
```

**Formatting rules:**
- Keep it compact. The system prompt is already long with capability sections. The profile should add ~300-500 tokens, not 2000.
- Use the data directly — don't add preamble like "Based on analysis of your email..." The agent doesn't need to know how the profile was derived.
- Omit empty sections. If `orgRelationships` is empty, skip "Key relationships" entirely.
- For `OrgRelationship`, render `reports-to` and `direct-report` first — these are the highest-signal relationships.

### 2d. Handle old-schema discovery results

The system prompt renderer should handle both old and new `DiscoveryResult` shapes gracefully:
- If `inferredTitle` is missing (old schema), fall back to just rendering `roleSummary`
- If `orgRelationships` is missing, skip the section
- If `responsibilities` is missing but `duties` exists (old schema), render duties

This avoids forcing a re-run before the agent can use any discovery data.

## Files Summary

| File | Action |
|------|--------|
| `src/index.ts` | **Edit** — add `configStore` to 3 `runAgent` calls |
| `src/agent/run.ts` | **Edit** — load discovery result, pass to `buildSystemPrompt` |
| `src/agent/systemPrompt.ts` | **Edit** — add `discovery` parameter, render User Profile section |

## Verification

- [ ] `bun --bun vitest run` passes
- [ ] DM tino "tell me about my role" → tino answers with specifics from discovery profile
- [ ] DM tino "who do I report to?" → tino answers with org relationship data
- [ ] DM tino "what should I focus on today?" → tino uses responsibilities + calendar context
- [ ] Instructions also load correctly (fixed by same `configStore` wiring)
- [ ] Agent runs for scheduled tasks and findWork also get discovery + instructions
- [ ] Old-schema discovery results render gracefully (no crash, shows what's available)
