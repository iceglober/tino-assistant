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
├── domain/              pure: types, system prompt, KB chunking + scoring
├── application/         use-cases: assistant, sender resolution, kb-indexer,
│                        kb-synthesizer (chunks → facts + themes)
├── ports/               inbound.ts (Assistant, SenderResolver)
│                        outbound.ts (everything the app needs from the world)
├── infrastructure/
│   ├── driving/         slack/ (Bolt socket mode), http/ (Hono, better-auth, routes)
│   ├── driven/          model/ tools/ persistence/ identity/ crypto/ kb/
│   └── security/        connect-token (signed personal OAuth links)
├── console-app/         React SPA (Login, Setup, Chat, Knowledge)
└── bootstrap/main.ts    composition root
```

## the interesting boundaries

**The LLM is behind a port.** `ChatModel.reply()` takes a system prompt,
history, the user's text, and an opaque tool handle; the AI SDK's `generateText`
agent loop exists only in `infrastructure/driven/model/chat-model.ts`.
`ConversationMessage` and `Tools` are `unknown` to the domain — it shuttles them
between the history store and the model without inspecting them, which is what
keeps the SDK out of the inner layers.

**Tools are built per user, per message.** `ToolProvider.forUser(userId)` merges
shared Slack channel tools (bot token, built once) with that user's Google tools,
their personal Slack tools (their own xoxp token), and KB search. Credentials are
decrypted per run, never cached across turns — so a just-completed `connect`
works on the very next message.

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

Retrieval blends similarity with recency —
`score = (1−w)·sim + w·exp(−age/τ)` (`w=0.3`, `τ=30d`, both config-tunable),
with `w` forced to 0 when the caller passes explicit date filters. The
`kb_search_mine` and `kb_what_you_know` tools bind the user id in their
closures, so they can never be pointed at another user's data by the model.

## request paths

**Slack DM** → Bolt handler → `SenderResolver` (identity + access policy) →
`Assistant.handleMessage` → history + tools + prompt → `ChatModel.reply` (tool
loop) → append history → mrkdwn → edit the "thinking…" placeholder.

**Web chat** → `POST /api/chat` (auth-gated) → the same `Assistant`.

**Console** → Hono + better-auth (Google sign-in), config CRUD, per-user OAuth
connect flows, KB status/browse, and the static SPA.
