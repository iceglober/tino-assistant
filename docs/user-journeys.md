# user journeys

What each kind of person actually does with tino, step by step, and what the
system does underneath. Each step names the code that handles it so the doc can
be checked against the code.

Three roles:

- **Operator**: deploys the container and owns the infrastructure (see [`gcp.md`](gcp.md)).
- **Admin**: a tino user with `role=admin`. Configures Setup, manages users, and adds workspace MCP servers.
- **Member**: everyone else. Chats, connects their own accounts, and adds personal MCP servers.

---

## 1. first install (operator → first admin)

1. **Operator deploys** the Helm chart with `DATABASE_URL`, `LOCAL_DEV_CRYPTO_KEY`, `CONNECT_SECRET`, and the Google OAuth client (`GOOGLE_OAUTH_CLIENT_ID`/`SECRET`). Without a Google client and outside localhost, nobody can sign in. The console runs with auth off, and every admin API returns 401.
   *Set `allowedEmailDomain` (Helm) / `CONSOLE_ALLOWED_DOMAIN` before exposing the URL.* Otherwise the first person to reach it becomes admin.
2. **First sign-in** at the console with Google.
   - The auth middleware finds no users at all and provisions this person as **admin** (`infrastructure/driving/http/auth.ts`).
   - When a domain is configured, only an address on that domain can be the first user.
   - Google sign-in requests `gmail.readonly` + `calendar.readonly` with offline access. The refresh token is copied into the encrypted credential store (`syncGoogleCredentials`), so **the admin's Gmail and Calendar are connected by signing in**.
3. **Setup** opens automatically because `/api/status` reports Slack or the model as unconfigured (`console-app/App.tsx`). The admin fills in:
   - Slack bot token (`xoxb-`) + app token (`xapp-`). Socket Mode, so no public webhook.
   - Optionally, the Slack OAuth client id/secret. This enables the per-user `connect` flow.
   - Model provider + credentials: Azure OpenAI, OpenAI, or Anthropic.
   - Optionally, the Google OAuth client, if it isn't already in env.
4. **Save & connect** writes the config and calls `POST /api/reload/slack`. That rebuilds the model and toolset and reconnects Slack without a restart (`refreshRuntime` in `bootstrap/main.ts`).
5. **Users → who can join**: the admin picks either
   - *anyone with an email on my domain* (org-domain: people are created on first contact), or
   - *only people I invite* (invite-only).
6. **Tools**: optionally add workspace MCP servers (see journey 6).

Done when: the admin can chat in the console and DM the bot in Slack.

---

## 2. new user: first contact through Slack

This is the most common way a teammate meets tino. They see it in Slack and DM it.

1. **They DM the bot.** The Bolt handler (`infrastructure/driving/slack/slack.ts`) passes the Slack user id to the sender resolver (`application/sender.ts`).
2. **tino decides who they are:**

   | situation | result |
   |---|---|
   | Slack id already linked | That user. Suspended → refused. Invited → flipped to active. |
   | Slack profile email matches an existing/invited account | The Slack id is linked to that account, and an invite is activated. Works in both join modes. |
   | New email, org-domain mode, email on the domain | A new **member** is created and linked. |
   | New email, invite-only mode | Refused: *"i don't recognize you. ask your admin to invite you to tino."* |
   | New email, wrong domain, or no email visible | Refused, and told to ask an admin to invite their Slack email. tino never guesses by linking them to some other account. |
   | No users exist yet | Refused: an admin must sign in at the console first. |

   Email lookup needs the bot's `users:read.email` scope. Without it every new person is refused.
3. **First answer.** Their message runs through the same agent as everyone's (`application/assistant.ts`). At this point they only have **shared** context:
   - Slack channel tools (channels the bot is in).
   - The workspace knowledge base (public channels).
   - Workspace MCP servers.
4. **Connect Slack (to get their own context).** They DM `connect`.
   - tino replies with a personal link, signed and valid for 15 minutes (`security/connect-token.ts`). No console login needed.
   - Slack OAuth grants a user token with read scopes on their DMs, private channels, and search (`routes/slack-oauth.ts`). It is stored encrypted under their user id.
   - On the next message they get `slack_search_my_messages` and the other personal Slack tools.
   - Within one indexer cycle (≤5 min), their DMs, group DMs, and private channels start indexing into their **private** KB. Public channels they belong to go to the shared **workspace** KB. Distillation then turns that history into facts.
5. **Optionally sign in to the console** with Google, using the same email. That links their Google identity to the same account and connects Gmail + Calendar (see journey 3).

Commands available in the DM:

- `connect`: personal Slack link.
- `reset`: clear your own conversation history.
- `forget me` → `forget me confirm`: delete everything indexed about you and stop indexing until you reconnect.

---

## 3. new user: first contact through the web console

1. **They open the console** and sign in with Google.
2. **The auth middleware resolves them** (`infrastructure/driving/http/auth.ts`):
   - Invited → activated.
   - Existing → signed in.
   - New and on the org domain (org-domain mode) → created as a member.
   - Otherwise → 403: *"account not provisioned in tino — ask your admin"*.
   - Suspended → 403.
3. **Gmail + Calendar connect automatically** from the sign-in grant. The `connect Google` button in the chat header re-runs consent if the token is missing or revoked. Gmail starts indexing into their private KB on the next indexer cycle, with a 90-day backfill.
4. **What they see:** chat, *knowledge* (when the KB is on), and *tools*. Members never see Setup or Users, and `/api/config` returns 403 for them. If an admin hasn't finished Setup yet, members get a "tino isn't set up yet" page.
5. **Chat.** `POST /api/chat` runs the same assistant as Slack, keyed to the same user. **Slack DMs and web chat share one conversation history.**
6. **To add their private Slack context** they still need to DM the bot `connect`. The chat empty state says so when Slack OAuth is configured.

---

## 4. everyday use

**Ask in a DM or the web chat.** Every turn:

1. Builds this user's toolset fresh (`infrastructure/driven/tools/provider.ts`):
   - shared Slack channel tools
   - their Gmail/Calendar tools
   - their personal Slack tools
   - KB tools (only if the relevant KB has rows)
   - reachable MCP servers
2. Builds the system prompt with the clock and tool guidance (`domain/prompt.ts`).
3. Runs the model's tool loop and saves the turn to history (cap of 40 messages).

A just-completed `connect` works on the very next message.

**@mention in a channel.** tino reads the last ~20 messages of the channel or thread for context and replies in-thread. Everyone in the channel reads the reply, so it only uses what everyone there may see (see [`security.md`](security.md#who-may-see-what)):

| channel | tino may use |
|---|---|
| internal (public or private) | public channels, this channel, the workspace knowledge base, workspace MCP servers marked shareable |
| shared with outsiders (Slack Connect, guests) | this channel only |

It never uses the asker's Gmail, Calendar, DMs, private channels, private knowledge base, or personal MCP servers there. Each thread has its own history, shared by everyone asking in it; the asker's DMs never enter it.

**When the answer needs private context**, tino answers what it can in the thread and calls `continue_in_dm`: a moment later the asker gets a DM answering their original question with their full private context. Nothing from that DM comes back to the channel.

An admin can switch mentions to "the asker's private context too" (Setup). Then only a prompt instruction stands between private data and the channel.

**Continuity across places.** In a DM or the web chat, tino remembers recent messages from the person's channel threads — as long as they're still in that channel. It runs one way: nothing said in a DM is ever recalled in a channel.

> *In #sales: "@tino where are we on Acme?" → answers from the channel and the workspace KB, sends the email details to your DM. Later, in a DM: "what did the team say in that thread?" → tino remembers the #sales thread.*

**Browse knowledge.** The console *knowledge* page shows private and workspace facts, themes, raw excerpts, semantic search, and the indexer's activity.

**Keep noise out ("don't learn from").** On the knowledge page, in your private view, exclude mail that looks real but isn't — domain warmup, bots, test sends:
- pick one of your **Gmail labels** (matched by id, so renaming is fine), or
- pick one of your **Gmail filters** — tino turns its criteria into a search, useful when the filter only archives, or
- type a **Gmail search**.

Excluded mail is never indexed. Mail tino already learned from that matches is forgotten on the next indexing cycle (≤5 min): its excerpts are deleted, facts that rested only on it are removed, and facts with other evidence lose those citations. Removing an exclusion only affects new mail. Live Gmail searches you ask for still see everything. The idiomatic setup: let your Gmail filter label the mail, and exclude that label — Gmail stays the one place that decides what's noise.

---

## 5. admin: managing people

In the console, go to **users** (`console-app/pages/Users.tsx`, API `/api/users`, admin-only).

- **Invite.** Enter an email and a role. This creates an `invited` account plus an email identity. The person becomes active the first time they sign in to the console or DM tino from Slack with that email, even in invite-only mode.
- **Promote/demote.** Toggle admin ↔ member.
- **Suspend.** Blocks them in Slack and the console, and stops KB indexing for them. Their indexed data stays. **Reactivate** reverses it.
- **Guard rail.** The last active admin can't be demoted or suspended.
- **Join policy.** Org-domain or invite-only. Stored as `org.accessControl.*` and read identically by the Slack resolver and console auth.

The list shows each person's Slack link and what they've connected (Slack, Gmail, MCP).

---

## 6. MCP tools

Remote MCP servers add tools from other systems: issue trackers, CRMs, internal APIs. Manage them on the console **tools** page (`console-app/pages/Tools.tsx`, API `/api/mcp`).

| | workspace server | personal server |
|---|---|---|
| who adds it | admins | any user, for themselves |
| whose token | one shared token | their own |
| who gets the tools | every user's agent | only theirs |
| usable in channels | only if an admin marks results "anyone in the workspace", and never with outsiders present | never |

1. **Add.** Enter a name (which becomes the id), an https URL, a transport (streamable HTTP or SSE), and auth: bearer, a custom header, or none. For workspace servers, choose **who may see what it returns**: "only the person asking" (default — DMs and web chat only) or "anyone in the workspace" (also usable in internal channels). Pick "anyone" only if everyone may see everything that token can reach.
   - Private, loopback, link-local, and `*.internal` hosts are refused, and so are redirects (`domain/mcp.ts`).
   - Tokens are encrypted at rest and never returned by the API.
2. **Test connection** connects, lists the tools, and disconnects without saving.
3. **Use.** Tools appear to the model as `mcp_<server>_<tool>` on the next message.
   - Connections are cached and closed after 5 idle minutes (`infrastructure/driven/mcp/client-pool.ts`).
   - A server that fails to connect within 10s is skipped for a minute, so a dead server never blocks replies.
4. **Turn off / edit / remove.** Takes effect on the next message.

Not supported: MCP servers that require an OAuth login flow (as opposed to a pasted token), and local stdio servers.

---

## 7. leaving

- **A user leaves the company:** an admin **suspends** them. To delete their indexed data, the user sends `forget me confirm` before they go. There is no admin-side "forget" yet.
- **A user wants their data gone:** `forget me confirm` in a Slack DM. This wipes their chunks, facts, topics, and cursors, and tombstones indexing until they `connect` again.
- **A revoked token:** the indexer pauses that user's source and DMs them. For example: *"my slack connection for you stopped working… DM me 'connect' to fix it."*

---

## gaps worth knowing

- **Public Google Workspace content** (shared Drives, shared docs) is not ingested into the workspace KB. Google content today is Gmail → private KB plus live Gmail/Calendar tools.
- **Private questions asked in a channel are answered in the asker's DM**, not in the thread (see journey 4). Without Slack connected for DMs, tino just tells them to DM it.
- **Recall is recent and literal**: the last few messages from other conversations the readers may see, not a summary of everything. Messages from before this change continue their threads but aren't recalled elsewhere.
- **Sign-in is Google-only in production**, with email/password only on localhost. A workspace without Google accounts can only use tino through Slack.
