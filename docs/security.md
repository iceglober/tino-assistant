# security

What tino protects, how, and where it doesn't. Each control names the code that enforces it.

## who can get in

- **Console sign-in** is Google OAuth through better-auth (`infrastructure/driving/http/auth.ts`). `CONSOLE_ALLOWED_DOMAIN` (or `console.allowedDomain`) rejects other domains server-side. Also restrict the OAuth client to your domain in Google Cloud as a second layer.
- **Slack senders** are mapped to tino users by Slack id, then by Slack profile email (`application/sender.ts`, `infrastructure/driven/identity/resolver.ts`). Unverifiable senders are refused, never guessed.
- **Join policy**: org-domain (auto-create members on your domain) or invite-only. Both paths read it identically (`routes/users.ts` → `readAccessPolicy`).
- **Suspended users** get 403 in the console and a refusal in Slack, and the KB indexer skips them.
- **First user**: on an install with zero users and no domain configured, the first console sign-in becomes admin. Set a domain before exposing the URL.

## who can do what

- **Admins**: Setup (`/api/config`, which contains every deployment secret), `/api/users`, `/api/reload/slack`, and workspace MCP servers. Enforced by `requireAdmin` in `auth.ts`.
- **Members**: chat, their own KB scope, their own OAuth connections, and personal MCP servers. They see configuration only as booleans (`/api/status`).
- The last active admin can't be demoted or suspended.

## data isolation between users

- **Tools are built per user per message**, from that user's own credentials (`infrastructure/driven/tools/provider.ts`). The personal Slack tools use the user's own `xoxp` token, so Slack itself limits them to what that person can see.
- **KB tools bind the user id in the closure**, never in the tool schema, so the model can't point a search at someone else's private KB (`infrastructure/driven/tools/kb.ts`).
- **Personal MCP servers** are stored under the owner's id and only loaded into the owner's toolset.

## secrets at rest

- **Per-user credentials** (Slack user tokens, Google refresh tokens, MCP tokens) are AES-256-GCM encrypted. The `(userId, capabilityId, fieldName)` context is bound as AAD, so ciphertext can't be replayed across users or fields (`infrastructure/driven/crypto/local-adapter.ts`). The key comes from `LOCAL_DEV_CRYPTO_KEY` (Secret Manager in production). Rotating it makes every stored credential unreadable.
- **Deployment secrets** set in Setup (Slack bot/app tokens, model API keys, OAuth client secrets) sit **in plaintext** in the `config` table. Protect the database accordingly.
- MCP tokens are write-only through the API. Responses carry `hasToken`, never the value.

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

MCP server URLs are admin/user-supplied, and tino connects to them from inside the cluster with a token attached. `domain/mcp.ts` requires https and refuses loopback, private, link-local (including `169.254.169.254`), CGNAT, `*.local`, and `*.internal` hosts. The client also refuses redirects.

This is a literal-host check. A public DNS name that resolves to a private address gets through, so add an egress policy if that matters to you.

## known gaps

- **No audit log.** Actions are in structured application logs only.
- **No admin-side data deletion.** Only the user can wipe their KB data (`forget me confirm`). Suspension stops indexing but keeps what's there.
- **Prompt injection.** Indexed messages, emails, and MCP tool output reach the model verbatim. Tools that write are limited to whatever MCP servers you connect, and the system prompt asks the model to confirm before changing data. That is a mitigation, not a guarantee.
- **Single replica only** (Socket Mode + singleton indexer). There is no HA.
