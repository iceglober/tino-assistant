# tino — product design

## what tino is

a personal AI assistant that lives in your slack DMs. it connects to your tools (code, calendar, email, slack, project management, customer systems) and uses them to answer questions, do research, prep for meetings, and work on tasks autonomously.

it runs on your infrastructure (ECS Fargate), uses BAA-backed models (Bedrock), and is configured through a localhost web console. single-user by design — it's YOUR assistant, not a team tool.

---

## the journey: "never heard of tino" → "tino saves me hours"

### phase 0: discovery (30 seconds)

someone sees tino mentioned. clicks the repo. README shows the butler logo, one line: "personal AI assistant that lives in your Slack DMs." they scan the capability list and think "i want that."

### phase 1: install (15 minutes)

```
git clone → cp .env.example .env → fill in slack tokens → docker compose up -d → pnpm dev
```

tino starts with zero capabilities enabled. the console at localhost:3001 shows a guided setup:

> *welcome to tino. let's get you set up.*
>
> *which of these do you use?*
> - [ ] GitHub — search code, check CI, read files
> - [ ] Linear — create/manage issues, get assigned work
> - [ ] Google Calendar — see your schedule
> - [ ] Gmail — search and read email
> - [ ] Slack — read channels and DMs (yours, not the bot's)
> - [ ] CloudWatch — query logs (stats only, safety-validated)
>
> *pick one to start. you can add more anytime.*

each capability expands to show exactly what credentials are needed, where to get them, and a "test connection" button.

### phase 2: first conversation (2 minutes)

the user DMs tino. tino responds — but with only Bedrock configured, it's just a chat bot. the system prompt says:

> "hey, i don't have any tools enabled yet so i'm just working from general knowledge. visit localhost:3001 to connect your GitHub, calendar, etc. — that's where i get useful."

this is the nudge loop. tino is useful enough to talk to, but clearly limited, and it tells you how to become more useful.

### phase 3: first capability (5 minutes)

the user enables GitHub — pastes their PAT, adds a repo. now "what does our auth middleware do?" returns real code with file paths and line numbers. the user feels the value immediately.

this is the hook. one capability, one question answered that would have taken 10 minutes of manual searching.

### phase 4: capability stacking (30 minutes over a week)

each day the user hits a wall:
- "i wish tino could see my calendar" → enables calendar (5 min)
- "can tino read that slack thread?" → enables slack reading (5 min)
- "tino should know about my linear board" → enables linear (5 min)

the value compounds. meeting prep now pulls from calendar + email + slack + code. "prep me for my 3pm" goes from useless to genuinely helpful.

### phase 5: autonomous work (the unlock)

the user assigns tino a linear issue. tino investigates using code search + slack context, posts findings as a comment, moves the issue to "in progress," and DMs a summary.

the user realizes: tino can work while i sleep.

they start:
- scheduling tasks ("remind me to review the PR in 2 hours")
- enabling findWork on capabilities (tino polls linear for new assignments)
- asking tino to schedule its own prep tasks ("if i have a meeting tomorrow, prep me 30 min before")

tino goes from "tool i query" to "colleague who handles things."

### phase 6: tino saves hours

daily routine:
- 7am: tino's morning briefing — today's calendar, yesterday's unread emails, CI status, linear assignments, slack threads that need attention
- throughout the day: meeting prep auto-scheduled 30 min before each meeting
- linear issues investigated autonomously, findings posted as comments
- "what happened in slack today?" answered in 10 seconds instead of 30 minutes of scrolling

the user's context-switching drops dramatically because tino pre-digests information across all their tools.

### phase 7: external systems (the expansion)

the user connects a customer's Jira board. tino monitors it for issues tagged "integration," summarizes new ones daily, and flags anything urgent — all without the user having to context-switch into the customer's project management tool.

this is where capability instances and guardrails become essential.

---

## capability instances

### the problem

the current model: one capability = one type = one set of credentials = one set of settings. this works when all capabilities are YOUR systems.

it breaks when:
- you have 3 Jira connections (yours + 2 customers) each with different permissions
- customer A's data must never appear in customer B's context
- each connection has custom instructions ("for RevenueWell, focus on issues tagged 'integration'")
- some connections are read-only, others allow writes

### the model

```
CapabilityType (e.g., "atlassian-jira")
  └── CapabilityInstance (e.g., "jira-revenuewell")
        ├── credentials
        ├── settings
        ├── permissions (read/write/delete, allowed actions)
        ├── instructions (natural language, injected into system prompt)
        ├── isolation (data tagging + sharing rules)
        └── findWork config
```

a capability type defines WHAT tools exist (search issues, create issue, etc.). a capability instance defines HOW a specific connection uses those tools (which credentials, what's allowed, what to focus on).

### capability instance schema

```ts
interface CapabilityInstance {
  // identity
  id: string;                        // 'jira-revenuewell'
  type: string;                      // 'atlassian-jira'
  name: string;                      // 'RevenueWell Jira'
  enabled: boolean;

  // connection
  credentials: Record<string, string>;
  settings: Record<string, unknown>;  // board IDs, project keys, filters, etc.

  // guardrails
  permissions: {
    read: boolean;                   // can tino read from this system?
    write: boolean;                  // can tino create/modify?
    delete: boolean;                 // can tino delete?
    allowedActions?: string[];       // whitelist of specific tool names
    // if allowedActions is set, ONLY those tools are exposed
    // if unset, all tools matching the read/write/delete flags are exposed
  };

  // agent instructions (per-instance)
  instructions: string;
  // natural language, injected into the system prompt when tino is
  // working with this instance's data. examples:
  //
  // "focus on issues tagged 'integration' or 'kayn'. summarize new
  //  issues daily. never create or modify issues — report findings
  //  to the owner via slack DM only."
  //
  // "this is our internal linear board. full access. when assigned
  //  an issue, investigate thoroughly using code search and slack
  //  context before posting findings."

  // data isolation
  isolation: {
    label: string;                   // 'revenuewell' — tags all data from this instance
    canShareWith: string[];          // ['internal'] — which other instance labels can see this data
    // empty array = data stays within this instance's context only
    // ['*'] = no isolation (default for internal systems)
  };

  // autonomous scanning
  findWork?: {
    enabled: boolean;
    intervalMinutes: number;
    // what to scan for is defined in `instructions` + `settings`
  };
}
```

### how permissions work

when tino calls a tool, the capability registry checks:

1. which instance owns this tool call? (determined by the credentials/connection being used)
2. does the instance's `permissions` allow this action?
3. if `allowedActions` is set, is this specific tool in the whitelist?

if any check fails, the tool returns a structured error: `{ error: 'permission_denied', message: 'this connection is read-only' }`. tino sees the error and adjusts — it won't try to write again.

### how isolation works

when tino retrieves data from an instance, the data is tagged with the instance's `isolation.label`. when tino is working in a different context:

- if the other context's `canShareWith` includes this label → data is accessible
- if not → data is not included in the system prompt or tool results

implementation: the agent loop checks isolation labels before including tool results in the message history. data from isolated instances is stored separately (different conversation context, not mixed into the main history).

for the MVP, isolation is advisory — enforced by the system prompt ("do not reference data from RevenueWell when working on internal issues") rather than by hard data separation. hard separation (separate DynamoDB partitions, filtered tool results) comes later.

### how instructions work

each instance's `instructions` field is injected into the system prompt when tino is working with that instance. the prompt assembly becomes:

```
[base system prompt]
[tool descriptions for enabled instances]
[per-instance instructions for the current context]
```

"current context" is determined by:
- which tools tino is calling (if it calls `jira-revenuewell.search_issues`, the RevenueWell instructions are active)
- which findWork poller triggered the run (if the RevenueWell poller found a new issue, those instructions are active)
- explicit user direction ("check the RevenueWell board" → RevenueWell instructions active)

### MCP integration

an MCP server (e.g., Atlassian MCP) is a capability type. the MCP server provides the tools. the capability instance wraps it:

```
CapabilityType: 'atlassian-jira' (backed by Atlassian MCP server)
  └── Instance: 'jira-revenuewell'
        ├── credentials: { apiKey: '...' } → passed to MCP server
        ├── permissions: { read: true, write: false } → filters which MCP tools are exposed
        ├── instructions: "focus on integration issues..."
        └── isolation: { label: 'revenuewell', canShareWith: [] }
```

the AI SDK already supports MCP tool sources. the registry:
1. connects to the MCP server with the instance's credentials
2. discovers available tools from the MCP server
3. filters by `permissions.allowedActions` (or `read`/`write`/`delete` flags)
4. registers the filtered tools with instance-prefixed names (e.g., `jira-revenuewell.search_issues`)
5. injects the instance's `instructions` into the system prompt

### native vs MCP capabilities

some capabilities are native (built-in TypeScript tools): GitHub, Linear, Slack, Gmail, Calendar, CloudWatch. these ship with tino and are always available.

some capabilities are MCP-backed: Atlassian Jira, Salesforce, custom internal tools. these require an MCP server to be running and accessible.

the capability instance model handles both — the `type` field determines whether to use native tools or connect to an MCP server. the permissions, instructions, and isolation work the same way regardless.

---

## the console (capability management UI)

### current state

localhost:3001 serves a single-page config editor with:
- capability list (enable/disable, credential status, findWork toggle)
- capability detail (credentials, settings/allowlists, findWork interval)
- raw config table
- health section

### evolution for capability instances

the console needs to support:

**instance management:**
- add a new instance of a capability type ("add another Jira connection")
- each instance has its own credentials, settings, permissions, instructions
- instances are listed under their type, not as a flat list

**permissions editor:**
- toggle read/write/delete per instance
- optional: whitelist specific tool names (advanced, hidden by default)
- visual indicator: "read-only" badge on the instance card

**instructions editor:**
- textarea for natural language instructions
- preview of what the system prompt will look like with these instructions active
- templates for common patterns ("read-only monitoring", "full access internal", "customer system — report only")

**isolation config:**
- label assignment (auto-derived from instance name by default)
- sharing rules (which other instances can see this data)
- visual: isolation badge on the instance card ("isolated" vs "shared")

**connection testing:**
- "test connection" button that verifies credentials work
- shows which tools are available from the MCP server (for MCP-backed types)
- shows which tools are exposed after permission filtering

### guided setup (onboarding)

first-time experience:
1. welcome screen with the butler logo
2. "which tools do you use?" checklist
3. for each selected tool: step-by-step credential setup with "where to get this" links
4. "test connection" after each credential is entered
5. "you're set up! DM tino in slack to get started."

returning experience:
- console opens to the capability list
- capabilities with issues (expired token, connection error) are flagged
- "add capability" button for new connections

---

## data model evolution

### current: flat capabilities in config table

```
capability.github → { enabled, credentials, settings, findWork }
capability.linear → { ... }
```

### future: capability instances

```
capability-type.atlassian-jira → { name: 'Atlassian Jira', toolSource: 'mcp', mcpServer: '...' }
capability-instance.jira-revenuewell → { type: 'atlassian-jira', name: 'RevenueWell Jira', credentials: {...}, permissions: {...}, instructions: '...', isolation: {...}, findWork: {...} }
capability-instance.jira-internal → { type: 'atlassian-jira', name: 'Internal Jira', ... }
capability-instance.github-main → { type: 'github', name: 'GitHub (kn-eng)', ... }
```

the migration from flat capabilities to instances is straightforward: each existing capability becomes a single instance of its type with default permissions (full access) and no isolation.

---

## guardrail enforcement layers

defense in depth — multiple layers, any one of which can block an action:

1. **credential scope** — the API key itself may have limited permissions (e.g., Jira API key with read-only scope). this is the outermost layer and is controlled by the external system, not by tino.

2. **permission filtering** — the capability registry filters which tools are exposed to the agent based on `permissions`. if `write: false`, create/update/delete tools are not registered. the agent literally cannot call them.

3. **instructions** — the system prompt tells the agent what to do and what not to do. this is a soft guardrail — the agent may violate it, but it's the primary steering mechanism for nuanced behavior ("focus on integration issues, ignore infrastructure issues").

4. **isolation** — data from one instance doesn't leak into another instance's context. enforced by the prompt assembly (MVP) or by hard data separation (future).

5. **audit logging** — every tool call is logged with the instance ID, action, and result. the owner can review what tino did with each connection.

layers 1-2 are hard guardrails (the agent cannot bypass them). layers 3-4 are soft guardrails (the agent is instructed to follow them but could theoretically violate them). layer 5 is detection (catches violations after the fact).

for customer systems, layers 1-2 are the safety net. layer 3 is the steering. layer 5 is the audit trail.

---

## implementation sequence

### now (v2.1): capability instances + permissions
- evolve `CapabilityConfig` → `CapabilityInstance`
- add `permissions`, `instructions`, `isolation` fields
- update the registry to filter tools by permissions
- update the console to manage instances
- migrate existing capabilities to single-instance format

### next (v2.2): MCP integration
- add MCP server connection support to the capability type system
- implement tool discovery from MCP servers
- wire permission filtering on MCP-discovered tools
- build the Atlassian Jira capability type as the first MCP consumer

### then (v2.3): data isolation
- tag tool results with instance isolation labels
- filter data in prompt assembly based on sharing rules
- separate conversation contexts per isolation group

### later (v2.4): onboarding flow
- guided setup in the console
- "test connection" for each capability
- nudge loop in the system prompt
- templates for common instruction patterns

---

## open questions

- **instruction conflicts.** if two instances have contradictory instructions ("always create issues" vs "never create issues"), which wins? current answer: the instance-specific instruction for the active context wins. but what if tino is working across contexts?

- **isolation granularity.** is per-instance isolation enough, or do we need per-field isolation? (e.g., "share issue titles from RevenueWell but not descriptions"). current answer: per-instance is enough for MVP; per-field is a future concern.

- **MCP server lifecycle.** who starts/stops the MCP server? does tino manage it, or does the user run it separately? current answer: user runs it separately; tino connects to it. future: tino could manage MCP server processes.

- **credential rotation.** when a token expires, how does tino handle it? current answer: the tool returns an auth error, tino DMs the owner "your RevenueWell Jira token expired — update it in the console." future: auto-refresh for OAuth tokens.

- **cost tracking.** each Bedrock call costs money. when tino is autonomously scanning 5 customer Jira boards every 15 minutes, the cost adds up. should the console show cost estimates per capability instance? current answer: yes, eventually. log token usage per instance and surface it in the health section.
