# architecture

How tino is put together. Read this before changing anything load-bearing.

## principles

1. **Ports and adapters, strictly.** `domain/` and `application/` depend only on `ports/`. Every SDK, driver, and framework lives in `infrastructure/`. If a use-case imports `ai`, `hono`, `@slack/bolt`, or `pg`, that's a bug.
2. **The console is the only configuration interface.** No env vars for runtime config; credentials, model choice, and KB tuning live in the config store and are read live.
3. **Config changes take effect without a restart.** `refreshRuntime()` rebuilds the model and toolset in place; the driving adapters hold a stable facade.
4. **One process does everything.** Slack bot, agent runtime, KB indexer, and console in a single process — and exactly one replica of it.

## layout

Everything is `packages/core`. (`@tino/aws` and `@tino/cli` were deleted when
Tino moved from AWS/Pulumi to GKE/Helm on 2026-07-25 — see git history.)

```
packages/core/src/
├── domain/              pure: types, system prompt, KB chunking + scoring,
│                        MCP rules (tool naming, URL guard)
├── application/         use-cases: assistant, sender resolution, kb-indexer,
│                        kb-synthesizer (chunks → facts + themes)
├── ports/               inbound.ts (Assistant, SenderResolver)
│                        outbound.ts (everything the app needs from the world)
├── infrastructure/
│   ├── driving/         slack/ (Bolt socket mode), http/ (Hono, better-auth, routes)
│   ├── driven/          model/ tools/ mcp/ persistence/ identity/ crypto/ kb/
│   └── security/        connect-token (signed personal OAuth links)
├── console-app/         React SPA (Login, Setup, Chat, Knowledge, Tools, Users)
└── bootstrap/main.ts    composition root
```

## the interesting boundaries

**The LLM is behind a port.** `ChatModel.reply()` takes a system prompt,
history, the user's text, and an opaque tool handle; the AI SDK's `generateText`
agent loop exists only in `infrastructure/driven/model/chat-model.ts`.
`ConversationMessage` and `Tools` are `unknown` to the domain — it shuttles them
between the conversation log and the model without inspecting them, which is
what keeps the SDK out of the inner layers. (`ChatModel.describe` is the one
window in: it returns a message's role and plain text, for recall.)

**Tools are built per reply, in labelled groups.** See "who may see what"
below. MCP connections are pooled per server config and reaped when idle; a
server that fails to connect in 10s is skipped for a minute, so one dead server
never stalls a reply. Credentials are decrypted per reply, never cached across
turns — so a just-completed `connect` works on the very next message.

## who may see what

Every piece of context carries a `WhoCanSee` label, and every reply has
`Readers`. A reply may only use context every reader is allowed to see —
`readersMaySee(readers, whoCanSee)` in `domain/who-can-see.ts`, the one rule
everything goes through.

| label | means |
|---|---|
| `everyoneInWorkspace` | any member of the company (never outsiders) |
| `membersOfChannel(C)` | members of #C; `insidersOnly` if it also drew on workspace sources |
| `onlyUser(U)` | U alone |
| `onlyUserInChannel(U, C)` | U alone, and only while they're in #C |
| `nobody` | unknown or unresolvable — never shown |

**Readers** (`application/readers.ts`): a Slack DM or the web chat is read by
the asker alone, who "is in" every channel Slack says they're in. A channel
reply is read by the channel; `includesOutsiders` when it's Slack Connect or has
guests (`infrastructure/driven/slack/channel-directory.ts`). If Slack can't
describe a channel, outsiders are assumed. The admin setting
`slack.channelMentions = asker` treats a mention as read by the asker alone.

**Tools** (`infrastructure/driven/tools/provider.ts`) come in groups, each
labelled: Gmail/Calendar, the user's Slack messages, their knowledge
(`kb_search_mine`, `kb_what_you_know`) and personal MCP servers are
`onlyUser`; public channels, workspace knowledge (`kb_search_workspace`,
`kb_what_the_workspace_knows`) and workspace MCP servers an admin marked
shareable are `everyoneInWorkspace`; `slack_read_this_channel` /
`slack_read_this_thread` are `membersOfChannel(C)`, locked to the channel tino
was asked in. Groups the readers may not see are never built.

**The conversation log** (`ConversationLog`, table `conversation_message`)
stores every message with the label of its reply: the place it was asked,
narrowed by every tool group that contributed (`strictestOf`). Two uses:
- *this thread's history* — filtered by the rule, a whole reply at a time, so a
  thread shared by several people only shows each reader what they may see;
- *recall* — the asker's recent messages from their other conversations that
  these readers may see, quoted in the system prompt. It runs one way: a DM
  recalls a channel thread the person is in; a channel never recalls a DM.

**Moving to a narrower audience** is the `continue_in_dm` tool, offered only
when others read the reply. It takes no input. After the channel reply is
saved, the asker's original message is answered again as a DM with their full
context and sent to them; nothing from that answer returns to the channel.

`strictestOf` is property-tested: combining two labels never lets anyone see the
result who couldn't see both inputs (`tests/domain/who-can-see.test.ts`).

**Persistence is dual-adapter.** `PERSISTENCE_ADAPTER=sqlite` (local dev,
bun:sqlite) or `postgres` (production, Cloud SQL + pgvector). Every store has
both implementations behind the same port; contract tests run the same
assertions against each, with the Postgres suites gated on `TEST_DATABASE_URL`.

**Per-user credentials are envelope-encrypted.** AES-256-GCM with a
`(userId, capabilityId, fieldName)` context bound as AAD, so ciphertext can't be
replayed across users, capabilities, or fields.

## the knowledge base

Two scopes: **`workspace`** is what the company can see (public Slack channels)
and **`private`** is one person's own DMs, private channels, and mail. Rows
stored `scope='user'` before 2026-07-25 are rewritten by a migration in
`kb/schema.ts`; nothing else in the codebase should say "user scope".

Three layers, most digested first:

| table | holds | built by |
|---|---|---|
| `kb_facts` | atomic claims with evidence, dates, confidence | `application/kb-synthesizer.ts` |
| `kb_topics` | labelled clusters of chunks | same, via k-means + a labelling call |
| `kb_chunks` | raw indexed excerpts, `halfvec(3072)` + HNSW cosine | `kb/sources/*` |

**Who can read what a channel contains is decided by Slack, not by us.**
`conversations.history` only works for channels the token's owner has joined —
for bot tokens *and* user tokens. The bot is typically in very few channels, so
public channels are indexed by whichever **user** principal is a member, written
to the `workspace` scope (`user_id=''`) so everyone shares one copy. DMs, group
DMs, and private channels stay in that person's `private` scope. A short
recheck window in the shared cursor stops N users re-reading the same channel
every cycle. (`search.messages` needs no membership, which is why the live
Slack tools can see channels the KB has not indexed.)

The indexer is a single 5-minute loop started **once** in `bootstrap/main.ts`.
It must not live in `refreshRuntime()`, which re-runs on every Slack reconnect
and would leak timers. Per-cycle API budgets, rotating round-robin over
principals, and mark-and-continue isolation: one revoked token pauses that
principal only. Every principal's slice writes a row to `kb_cycle_events`,
which is what the console's activity view reads.

Distillation runs at the end of each cycle over chunks with `synthesized_at IS
NULL`, newest first. Two failure modes are handled separately and it matters
that they are: a batch that fails three times is consumed so it cannot block
newer chunks behind it, while **six** failures in a row — any batch — halt the
principal for an hour, because a misconfigured model would otherwise eat the
entire backlog three chunks at a time. Facts merge on
`(scope, userId, kind, key)` where `key` is a stemmed word-set slug of the
claim, so re-observing something extends its date range and evidence instead of
duplicating it.

**Don't learn from.** Each person keeps a list of exclusions in their own
terms per source (`domain/dont-learn-from.ts`) — for Gmail, labels (by id) and
searches (typed, or converted from one of their Gmail filters). The Gmail
source leaves excluded searches out of its query, skips messages carrying an
excluded label, and, whenever the list's fingerprint changes, asks Gmail which
already-indexed messages match and calls `KnowledgeStore.forgetSourceItems`:
excerpts deleted, facts resting only on them deleted, other facts' evidence
trimmed. Gmail's filters decide what's noise; tino honours the labels they
leave rather than re-running their rules.

Retrieval blends similarity with recency —
`score = (1−w)·sim + w·exp(−age/τ)` (`w=0.3`, `τ=30d`, both config-tunable),
with `w` forced to 0 when the caller passes explicit date filters. The
`kb_search_mine` and `kb_what_you_know` tools bind the user id in their
closures, so they can never be pointed at another user's data by the model.

## request paths

**Slack DM / web chat / channel mention** → driving adapter (Bolt or
`POST /api/chat`) → `SenderResolver` for Slack → `Assistant.handleMessage(user,
text, surface)` → readers → allowed tool groups + this thread's visible history
+ recall → `ChatModel.reply` (tool loop) → labelled messages into the log →
reply (Slack: mrkdwn, edited into the "thinking…" placeholder) → optional DM
follow-up. Slack DMs and the web chat share one thread per person.

**Console** → Hono + better-auth (Google sign-in), admin-only config and user
management, MCP server management, per-user OAuth connect flows, KB
status/browse, and the static SPA. Members read configuration only as booleans
via `/api/status`.

## users and access

`tino_user` (role `admin`/`member`, status `active`/`invited`/`suspended`) is
the account; `identity` maps `(slack|google|email, externalId)` to it. Slack
senders resolve by Slack id, then by Slack profile email; console sessions by
email. The join policy (`org.accessControl.mode`: org-domain or invite-only) is
read the same way on both paths. Invites create an `invited` account that
activates on first contact from either side. See
[`user-journeys.md`](user-journeys.md) for the flows and
[`security.md`](security.md) for the boundaries.
