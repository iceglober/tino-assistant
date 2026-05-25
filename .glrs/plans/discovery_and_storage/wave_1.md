# Wave 1: Discovery Redesign

## Goal

Replace the shallow discovery schema with a structured user profile that answers specific questions. Add Slack as a data source. Make the prompt directive — tell the LLM exactly what questions to answer from the data.

## Current Schema Problems

The current `DiscoveryResult` has four fields:
- `roleSummary` — a generic paragraph ("Austin is a founder/CTO who...")
- `duties` — flat list of {title, description, frequency}
- `contactCategories` — groups contacts by vague category ("Engineering Team")
- `suggestions` — how tino could help

This can't answer: "who do I report to?", "who reports to me?", "what's my communication style?", "what should I focus on today?", "what meetings eat most of my time?". The schema doesn't have slots for this information, and the prompt doesn't ask for it.

## New Schema

```typescript
interface DiscoveryResult {
  // --- Identity ---
  roleSummary: string;          // 2-3 sentences. Title, org, primary function.
  inferredTitle: string;        // "CTO", "Senior Engineer", "Product Manager"
  inferredDepartment: string;   // "Engineering", "Product", "Operations"

  // --- Org graph ---
  orgRelationships: OrgRelationship[];

  // --- Responsibilities ---
  responsibilities: Responsibility[];

  // --- Communication profile ---
  communicationStyle: CommunicationStyle;

  // --- Work patterns ---
  workPatterns: WorkPatterns;

  // --- Pain points & suggestions ---
  painPoints: string[];         // observed inefficiencies, bottlenecks
  suggestions: Suggestion[];    // how tino could help

  // --- Metadata ---
  analyzedAt: number;
  dataSourcesUsed: string[];    // ["email", "calendar", "slack"]
}

interface OrgRelationship {
  name: string;                 // display name or email
  email?: string;
  relationship: "reports-to" | "direct-report" | "peer" | "stakeholder"
                | "cross-functional" | "external" | "frequent-contact";
  context: string;              // "weekly 1:1, co-authors PRs, reviews your docs"
  interactionFrequency: string; // "daily", "weekly", "monthly", "occasional"
}

interface Responsibility {
  title: string;
  description: string;
  timeHorizon: "daily" | "weekly" | "monthly" | "quarterly" | "ongoing";
  evidence: string;             // what data point(s) support this inference
}

interface CommunicationStyle {
  summary: string;              // 2-3 sentences on how they communicate
  preferredChannels: string[];  // ["slack", "email", "meetings"]
  patterns: string[];           // ["responds quickly to DMs", "batches email replies"]
}

interface WorkPatterns {
  meetingLoad: string;          // "heavy (20+ hrs/week)", "moderate", "light"
  peakHours: string;            // "mornings", "afternoons", "distributed"
  recurringCommitments: string[];  // "daily standup 9am", "weekly 1:1 with CTO"
  timeInvestment: TimeInvestment[];
}

interface TimeInvestment {
  category: string;             // "meetings", "code review", "email", "Slack"
  estimatedPct: number;         // 0-100
  details: string;
}

interface Suggestion {
  title: string;
  description: string;
  capabilityId?: string;
}
```

### Key design decisions

- **`OrgRelationship` replaces `ContactCategory`.** Instead of grouping contacts by vague category, each person gets a specific relationship type and context. This lets tino answer "who do I report to?" and "who reports to me?" directly.
- **`Responsibility` has `timeHorizon` and `evidence`.** Time horizon enables "what should I focus on today?" vs "what are my quarterly goals?". Evidence forces the LLM to ground each claim in actual data.
- **`CommunicationStyle` is new.** Derived from email response patterns, Slack message style, meeting frequency. Lets tino match the user's tone and anticipate how they want information delivered.
- **`WorkPatterns` is new.** Meeting load, peak hours, time investment. Lets tino suggest better times for tasks and flag overload.
- **`painPoints` is new.** Explicit list of observed inefficiencies. Feeds the suggestions and gives tino context for proactive help.

## New Discovery Prompt

The current prompt says "identify the user's role, duties, contacts, and suggestions." The new prompt gives the LLM specific questions to answer, grounded in the data:

```
You are analyzing a user's email, calendar, and Slack data to build a profile for their personal AI assistant.

Answer each of these questions from the data. If the data doesn't support a confident answer, say so — don't fabricate.

IDENTITY:
- What is this person's job title and department?
- What is their primary function — what does the org pay them to do?

ORG RELATIONSHIPS:
- Who do they report to? (look for: 1:1 meetings titled "1:1" or "check-in" with one other person, especially someone senior)
- Who reports to them? (look for: 1:1s where they are likely the senior person, or team standups they run)
- Who are their closest peers? (frequent email, co-attendees on recurring meetings, Slack DM partners)
- Who are their key stakeholders outside their team? (cross-functional meetings, external email domains)
- For each person, note: how they interact (email, Slack, meetings), how often, and what about.

RESPONSIBILITIES:
- What do they do daily? (recurring daily meetings, Slack channel activity, email patterns)
- What do they do weekly? (weekly meetings, report cadences, sprint ceremonies)
- What do they do monthly/quarterly? (planning meetings, reviews, all-hands)
- What ongoing responsibilities show up across all time horizons? (ownership areas, tools they admin)
- For each responsibility, cite the evidence: which meetings, email threads, or Slack patterns support it.

COMMUNICATION STYLE:
- What channels do they use most? (email vs Slack vs meetings — compare relative volumes)
- Any observable patterns? (responds fast on Slack, batches email, prefers async, schedules everything)

WORK PATTERNS:
- How heavy is their meeting load? Count recurring meetings per week.
- Where does their time go? Estimate percentage split across meetings, async communication, and focus work.
- What recurring commitments anchor their week? (daily standup at 9am, weekly team sync on Tuesdays, etc.)

PAIN POINTS:
- What looks inefficient? (too many status meetings, context-switching between tools, manual processes)
- Where might they be overloaded? (back-to-back meetings, high email volume from certain contacts)
- What patterns suggest friction? (rescheduled meetings, unanswered threads, weekend email)

SUGGESTIONS:
- Based on the pain points, what could an AI assistant do to help?
- Be specific: "summarize the #engineering channel before your 10am standup" not "help with communication."
```

## Add Slack as a Data Source

### New port: `SlackDiscoveryPort`

```typescript
interface SlackDiscoveryPort {
  getTopDMPartners(userId: string, opts?: { sinceDays?: number; limit?: number }):
    Promise<Array<{ name: string; messageCount: number }>>;
  getActiveChannels(userId: string, opts?: { sinceDays?: number; limit?: number }):
    Promise<Array<{ name: string; messageCount: number }>>;
  getMessageSample(userId: string, opts?: { limit?: number }):
    Promise<Array<{ channel: string; text: string; ts: string }>>;
}
```

**Implementation:** Uses the user's xoxp- token (from `slack-personal` capability) to call:
- `conversations.list` + `conversations.history` for DM partner frequency
- `search.messages` with `from:@me` for the user's own messages (communication style analysis)
- `users.conversations` for channel activity

**Wiring:** The discovery service already takes optional ports (`email?: EmailPort`, `calendar?: CalendarPort`). Add `slack?: SlackDiscoveryPort`. Build the Slack port from the user's `slack-personal` capability token if available.

### New discovery data section

```
## Slack activity (last 180 days)

### Top DM partners
- Alice Johnson: 342 messages
- Bob Smith: 218 messages
...

### Active channels
- #engineering: 156 messages
- #general: 89 messages
...

### Recent message sample (communication style reference)
- "hey can you take a look at the PR when you get a chance?"
- "shipped — deployed to staging, will monitor for an hour then promote"
...
```

## Schema Migration

The `DiscoveryResult` type is stored as JSON in the config store. Old results have the old shape. Two options:

1. **No migration.** Old results are silently replaced when the user re-runs discovery. The Customize page and system prompt handle missing fields with optional chaining. Old `contactCategories` field is ignored.
2. **Version field.** Add `schemaVersion: 2` to new results. Readers check the version and prompt re-run if stale.

Recommend option 1 — it's early stage, one user, and discovery takes 30 seconds.

## UI Changes

**`src/console-app/pages/Capabilities.tsx` (Customize page)**

The discovery results section currently shows `roleSummary`, `duties`, and `suggestions`. Update to show the new fields:

- **Role summary** — keep as-is, now with inferred title/department badge
- **Org relationships** — grouped by relationship type, show name + context + frequency
- **Responsibilities** — grouped by time horizon (daily → quarterly)
- **Work patterns** — meeting load indicator, time investment breakdown
- **Pain points** — bulleted list
- **Suggestions** — keep as-is

Don't over-design the UI. The primary consumer is the system prompt, not the page. The page is for the user to verify accuracy and re-run if wrong.

## Files Summary

| File | Action |
|------|--------|
| `src/discovery/types.ts` | **Rewrite** — new schema, new Zod schema |
| `src/discovery/service.ts` | **Rewrite** — new prompt, Slack data source, richer analysis |
| `src/discovery/slack-port.ts` | **New** — Slack data port for discovery |
| `src/console-app/pages/Capabilities.tsx` | **Edit** — render new discovery fields |
| `src/console-app/pages/Onboarding.tsx` | **Edit** — render new discovery fields in onboarding results |
| `src/server/routes/discovery.ts` | **Edit** — pass Slack port to discovery service |

## Verification

- [x] `bun --bun vitest run` passes
- [x] Discovery with email + calendar + Slack produces all new fields
- [x] Discovery with email + calendar only (no Slack) still works — Slack port is optional
- [x] Discovery with no data sources returns graceful empty result
- [x] Customize page renders new fields without layout breakage
- [x] Re-running discovery replaces old-schema results cleanly
