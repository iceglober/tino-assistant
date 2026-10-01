# security

What tino protects, how, and where it doesn't. Each control names the code that enforces it.

## who can get in

- **Accounts** are better-auth email + password (minimum 10 characters) or "Sign in with Google" on tino's own client with `openid email profile` only (`infrastructure/driving/http/auth.ts`). In production sign-in requires a verified email (`requireEmailVerification`); verification and reset links are emailed through Resend.
- **Membership is per org** and resolved on every org-scoped request by the `orgScope` middleware: non-members get **404** (the same as a missing org, so slugs don't reveal who uses tino), suspended members 403.
- **Invites and domain joins honour only verified emails.** Otherwise anyone could register `ceo@yourcompany.com` and inherit an invite or a domain join. (Local dev skips this.)
- **Join policy** per org: invite-only (default for a new org) or org-domain. Both the web and Slack paths read it through `domain/access-policy.ts`.
- **Slack senders** map to members of the org whose app received the event, by Slack id then Slack profile email (`application/sender.ts`, `infrastructure/driven/identity/resolver.ts`). Unverifiable senders are refused, never guessed.
- **Closed beta** (`SIGNUPS=closed`): anyone may sign up and accept an invite, but only `ORG_CREATORS` may create orgs.

## who can do what

- **Admins** of an org: its settings (write-only secrets), members and the join policy, the Slack install, workspace MCP servers, and rebuilding its knowledge base. Enforced by `requireAdmin`.
- **Members**: chat, their own KB scope, their own connections, personal MCP servers. They see the org's setup only as booleans (`GET /api/orgs/:slug`).
- The last active admin can't be demoted or suspended.
- **The operator** (platform environment) has database access to every org. Keep that set of people small; there is no in-app super-admin.

## isolation between orgs

- Every tenant table has `org_id` first in its keys, and org-bound stores (`persistence/postgres/index.ts → forOrg`) put it in every statement. Slack ids and channel ids can repeat across workspaces; each org resolves its own.
- Slack events are accepted per org only with that org's signing secret (HMAC, 5-minute window), and refused when their team isn't the org's installed workspace.
- A Slack workspace can be installed into one org only.
- Covered by `tests/persistence/stores.test.ts`, `tests/kb/pg-store.test.ts` (isolation blocks) and `tests/server/platform-flow.test.ts` (over HTTP).

## data isolation between users

- **Tools are built per user per message**, from that user's own credentials (`infrastructure/driven/tools/provider.ts`). The personal Slack tools use the user's own `xoxp` token, so Slack itself limits them to what that person can see.
- **KB tools bind the user id in the closure**, never in the tool schema, so the model can't point a search at someone else's private KB (`infrastructure/driven/tools/kb.ts`).
- **Personal MCP servers** are stored under the owner's id and only loaded into the owner's toolset.

## OAuth connections

- **State is signed and short-lived** (HMAC with `AUTH_SECRET`, 15 minutes) and names the org, member, purpose and which client started the flow (`security/signed-state.ts`).
- **Callbacks finish only as the person who started them.** Google and Slack installs require the console session to be that member. A personal Slack connect from the bot's DM link must come back as the member's already-linked Slack user, or with their console session — so a connect link forwarded to someone else can't attach *their* Slack to the sender's account. A Slack identity already linked to another member is refused.
- **Refresh tokens record the client that minted them**; client secrets are never copied into per-person records (`oauth/org-clients.ts`).

## secrets at rest

- **Per-person credentials** (Slack user tokens, Google refresh tokens, MCP tokens) and **org secrets** (client secrets, signing secrets, bot tokens, model keys) are AES-256-GCM encrypted with the owner, capability and field bound as AAD (`crypto/local-adapter.ts`). One org's ciphertext doesn't decrypt as another's.
- The key comes from `ENCRYPTION_KEY`. Rotating it makes every stored credential unreadable; back it up.
- Secrets are write-only through the API: responses say whether one is set, never what it is. Logs record changed setting *names* only.

## who may see what

Every piece of context — a tool's results, a stored message — is labelled with
who may see it, and every reply knows who will read it. A reply only uses what
all of its readers may see (`domain/who-can-see.ts`, described in
[`architecture.md`](architecture.md#who-may-see-what)). Consequences:

- **Channel mentions** (default policy) never build the asker's private tools —
  Gmail, Calendar, their Slack token, their knowledge base, personal MCP
  servers, workspace MCP servers not marked shareable — and never load their DM
  history. Keeping private data out is decided by what is *loaded*, not by what
  the model is *told*; a message planted in the channel has nothing private to
  reach.
- **Channels with outsiders** (Slack Connect, guests, anyone Slack can't vouch
  for) get nothing but that channel itself.
- **Recall runs one way.** A DM may recall a channel thread its reader is
  currently in; a channel never recalls a DM; leaving a channel stops recall of
  its threads (after the 2-minute membership cache).
- **Shared threads** show each asker only the replies they may see — under the
  `asker` policy, one person's private turn is hidden from the next asker in the
  same thread.
- **The DM hand-off** (`continue_in_dm`) takes no input: the asker's original
  message is re-asked in their DM, so planted text can't choose what gets asked
  with their private tools. The private answer is sent to their DM only.
- **Bot-token channel reads** are limited to public channels in every mode;
  the channel tino was asked in is read through tools locked to that channel.
- **The `asker` policy** (Setup → *When @mentioned in a channel*) opts out of
  all this for mentions: the asker's private context is used, and only a prompt
  instruction keeps it out of the channel.

Slack bot scopes this relies on: `channels:read`, `groups:read`, `mpim:read`
(channel info, members, a person's channels), `users:read` (guest and team
checks), `im:write` + `chat:write` (the DM follow-up). Missing scopes fail
closed: an undescribable channel is treated as having outsiders, and a person
whose channels can't be listed recalls none.

## outbound requests (MCP)

MCP server URLs are admin/user-supplied, and tino connects to them from its own network with a token attached. `domain/mcp.ts` requires https and refuses loopback, private, link-local (including `169.254.169.254`), CGNAT, `*.local`, and `*.internal` hosts. The client also refuses redirects.

This is a literal-host check. A public DNS name that resolves to a private address gets through, so add an egress policy if that matters to you.

## known gaps

- **No org deletion flow yet.** Members can wipe their own KB data (`forget me confirm`) and admins can wipe the org's KB (rebuild), but deleting an org's account, settings and history is a database operation today.
- **No platform audit log.** Actions are in structured application logs only.
- **Prompt injection.** Indexed messages, emails, and MCP tool output reach the model verbatim. Tools that write are limited to whatever MCP servers you connect, and the system prompt asks the model to confirm before changing data. That is a mitigation, not a guarantee.
- **Single replica** (in-process KB scheduler). Slack is over HTTP, so this is a deployment choice — see [scaling](managed-service.md#scaling-past-one-box).
