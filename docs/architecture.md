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
├── application/         use-cases: assistant, sender resolution, kb-indexer
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

Two scopes — `workspace` (public channels via the bot token) and `user` (each
person's own DMs, private channels, and email via their own tokens) — indexed
into `kb_chunks` as `halfvec(3072)` vectors with an HNSW cosine index.

The indexer is a single 5-minute loop started **once** in `bootstrap/main.ts`.
It must not live in `refreshRuntime()`, which re-runs on every Slack reconnect
and would leak timers. Per-cycle API budgets, rotating round-robin over
principals, and mark-and-continue isolation: one revoked token pauses that
principal only.

Retrieval blends similarity with recency —
`score = (1−w)·sim + w·exp(−age/τ)` (`w=0.3`, `τ=30d`, both config-tunable),
with `w` forced to 0 when the caller passes explicit date filters. The
`kb_search_mine` tool binds the user id in its closure, so it can never be
pointed at another user's data by the model.

## request paths

**Slack DM** → Bolt handler → `SenderResolver` (identity + access policy) →
`Assistant.handleMessage` → history + tools + prompt → `ChatModel.reply` (tool
loop) → append history → mrkdwn → edit the "thinking…" placeholder.

**Web chat** → `POST /api/chat` (auth-gated) → the same `Assistant`.

**Console** → Hono + better-auth (Google sign-in), config CRUD, per-user OAuth
connect flows, KB status/browse, and the static SPA.
