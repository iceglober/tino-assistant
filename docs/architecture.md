# architecture

How tino is put together. Read this before changing anything load-bearing.

## principles

1. **Ports and adapters, strictly.** `domain/`, `application/` and `ports/` are their own package, `@tino/core`, with **no dependencies** — if it needs one, the code belongs in an adapter. Every SDK, driver and framework lives in `apps/server/src/infrastructure/`.
2. **Tenancy is structural.** Every org's data is reached through stores bound to that org (`persistence.forOrg(id)`); nothing below the composition root takes an org id. See [`managed-service.md`](managed-service.md#tenancy).
3. **Customers configure their own org.** Model keys, their Slack app, their Google client and policies live in the org's encrypted settings and take effect without a restart: saving and applying rebuilds that org's runtime. The platform's environment is only for the operator.
4. **One process serves every org.** HTTP API, Slack events, every org's agent runtime and the knowledge-base scheduler run in one process — one replica, by choice (see [scaling](managed-service.md#scaling-past-one-box)).

## layout

A Bun workspace:

```
apps/
├── server/  @tino/server — the process
│   └── src/
│       ├── bootstrap/       main.ts (platform composition root), org-registry.ts,
│       │                    org-runtime.ts (one org's tino), org-kb.ts
│       ├── infrastructure/
│       │   ├── driving/     http/ (Hono, better-auth, routes), slack/ (Bolt fed over HTTP, signature check)
│       │   ├── driven/      persistence/ (Postgres or PGlite, org-bound stores), model/ tools/ mcp/
│       │   │                kb/ (store, sources, embedders), oauth/ (client policy adapter),
│       │   │                slack/ (manifest, channel directory), identity/ crypto/ email/
│       │   └── security/    signed OAuth state
│       └── env.ts           the operator's settings
└── web/     @tino/web — React Router 8 SPA (Vite), served by the server from apps/web/dist/client
packages/
├── core/       @tino/core — domain/ (incl. org.ts, oauth-clients.ts, access-policy.ts),
│               application/ (assistant, sender, kb-indexer, kb-synthesizer), ports/
└── contracts/  @tino/contracts — the HTTP contract the server and web app share
.railway/railway.ts   infrastructure as code
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

**Persistence is Postgres, always.** Real Postgres with pgvector in production
(Railway), PGlite — Postgres compiled to WASM, with pgvector — in local dev and
tests (`persistence/db.ts`). One SQL dialect, one adapter per store, and the
contract tests run on every `bun run test` instead of only when a database is around.

**Credentials and org secrets are envelope-encrypted.** AES-256-GCM with a
`(owner, capabilityId, fieldName)` context bound as AAD, so ciphertext can't be
replayed across users, orgs, capabilities, or fields. Org settings whose key ends
in secret/token/apiKey are encrypted the same way under `org:<orgId>` and are
write-only through the API.

## the knowledge base

Two scopes: **`workspace`** is what the company can see (public Slack channels)
and **`private`** is one person's own DMs, private channels, and mail — both
within one org (every KB table is keyed by `org_id` first).

**Embeddings come from the org's own key** (OpenAI or an Azure
text-embedding-3-large deployment), else from a platform embedder if the operator
set one, else the KB stays off with a reason the console shows
(`kb/embedders.ts`). The model that wrote an org's vectors is pinned in
`kb.embedModel`; vectors from two models aren't comparable, so switching means
an admin-confirmed rebuild, never a mix.

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

Each org has its own indexer with no timer of its own; the registry's scheduler
(`bootstrap/org-registry.ts`) runs every org's cycle in turn, every five minutes.
Per-cycle API budgets, rotating round-robin over
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

**Slack DM / channel mention** → `POST /slack/events/<orgId>` → signature checked
with that org's signing secret, acked → the org's Bolt app (`processEvent`) →
`SenderResolver` → `Assistant.handleMessage(user, text, surface)` → readers →
allowed tool groups + this thread's visible history + recall → `ChatModel.reply`
(tool loop) → labelled messages into the org's log → reply (mrkdwn, edited into
the "thinking…" placeholder) → optional DM follow-up.

**Web chat** → `POST /api/orgs/<slug>/chat` → same assistant, `web_chat` surface.
Slack DMs and the web chat share one thread per person.

**Web app** → better-auth session (`/api/auth/*`) → `orgScope` middleware resolves
the account to a member of `<slug>` (activating an invite, refusing a suspended
member, 404 for non-members) → org routes read the org's runtime from the request.

**Connecting** → `/api/orgs/<slug>/connections/{google,slack}/start` → the client
policy picks the org's own or tino's client → signed state → provider →
`/api/oauth/{google,slack}/callback`, which must finish as the person who started.

## users and access

An **account** (better-auth `user`) is a person on the platform. A **member**
(`tino_user`) is that person in one org, with a role (`admin`/`member`) and a
status (`active`/`invited`/`suspended`); `identity` maps `(slack|google|email,
externalId)` to a member within the org. Slack senders resolve by Slack id, then
Slack profile email; web requests by the account's email. The join policy
(`domain/access-policy.ts`: org-domain or invite-only) is read the same way on
both paths, and invites and domain joins require a verified email. See
[`user-journeys.md`](user-journeys.md) and [`security.md`](security.md).
