# user journeys

What each kind of person actually does with tino, step by step, and what the
system does underneath. Each step names the code that handles it so the doc can
be checked against the code.

Four roles:

- **Operator**: runs the platform on Railway (see [`managed-service.md`](managed-service.md#running-it-on-railway)). Never needs to touch a customer's setup.
- **Admin**: a member of an org with `role=admin`. Sets up the org's model, Slack app and Google client, manages members, adds workspace MCP servers.
- **Member**: everyone else in an org. Chats, connects their own accounts, adds personal MCP servers.
- **Account**: a person signed in to the platform. One account can be a member of several orgs.

---

## 1. a company starts using tino (account → org → setup)

1. **Sign up** at `/signup` with email + password, or "Sign in with Google" when the operator configured tino's Google client. In production the emailed confirmation link must be clicked first (`routes/platform.ts` refuses unverified emails for creating or joining orgs).
2. **Create an org** at `/new`: a name, and a URL slug checked live (`GET /api/orgs/slug-available`). The creator becomes its first **admin**. New orgs are invite-only. During a closed beta only `ORG_CREATORS` can do this; everyone else needs an invite.
3. **The overview checklist** (`GET /api/orgs/:slug` → `status`) walks the admin through:
   - **Model** (Settings → Model): provider and their own API key. An OpenAI key, or an Azure text-embedding-3-large deployment, also turns on the knowledge base (`kb/embedders.ts`). Settings take effect on *Apply*, which rebuilds the org's runtime (`POST /settings/apply`).
   - **Slack app** (Settings → Slack): *Create app from manifest* opens Slack with a manifest generated for this org (bot + user scopes, `/slack/events/<orgId>`, tino's redirect URL; `infrastructure/driven/slack/manifest.ts`). Paste back the Client ID, Client secret and Signing secret, then *Install to Slack* (`POST /slack/install` → Slack consent → `/api/oauth/slack/callback`). The install stores the bot token, binds the workspace to this org (one org per workspace), and connects the installing admin's own Slack too.
   - **Google client** (Settings → Google): in their Google Cloud project, consent screen type **Internal**, Gmail API + Calendar API enabled, an OAuth client of type *Web application* with tino's redirect URI (shown, with the scopes). Paste the client ID and secret. The page shows which client a new connection would use, live (`GET /google/setup`). If tino offers a managed client, this step is optional — see [whose OAuth client?](managed-service.md#whose-oauth-client).
4. **Members → who can join**: invite people by email (they get an email link), and/or let anyone with a verified address on the company domain join.

Done when: the admin can chat on the web, DM the bot in Slack, and the knowledge base shows activity.

---

## 2. new member: first contact through Slack

1. **They DM the bot.** Slack sends the event to `/slack/events/<orgId>`; the signature is checked with that org's signing secret and the org's Bolt app handles it (`driving/slack/slack.ts`). The sender resolver maps the Slack id to a member (`application/sender.ts`):

   | situation | result |
   |---|---|
   | Slack id already linked | That member. Suspended → refused. Invited → activated. |
   | Slack profile email matches an existing/invited member | Linked; an invite is activated. Works in both join modes. |
   | New email, org-domain mode, email on the domain | A new **member** is created and linked. |
   | New email, invite-only mode | Refused: *"i don't recognize you. ask your admin to invite you to tino."* |
   | New email, wrong domain, or no email visible | Refused — never guessed onto another account. |

   Email lookup needs the bot's `users:read.email` scope, which the manifest includes.
2. **First answer** uses shared context only: channel tools, the workspace knowledge base, workspace MCP servers.
3. **`connect`** in the DM returns a personal link (signed, 15 minutes). It finishes only if the person consents *as the Slack user the bot was talking to*, so a forwarded link can't attach someone else's Slack. Their DMs, group DMs and private channels start indexing into their private KB within one cycle.
4. **Mail and calendar** are connected on the web: sign up with the same email and use Connections (journey 3).

DM commands: `connect`, `reset` (clear your history), `forget me` → `forget me confirm` (delete what's indexed about you and stop indexing until you reconnect).

---

## 3. new member: first contact through the web

1. **They follow an invite email** (`/signup?email=…&org=…`), sign up with that address, and confirm it. The first org request activates the invite (`orgScope` in `http/auth.ts`). Or they sign up on their own and `/orgs` lists any org whose policy admits their domain, with *Join*.
2. **Connections**: *Connect Google* (mail + calendar, or calendar only) goes through the org's client — or tino's, per the policy — and comes back to `/<slug>/connections`. *Connect Slack* uses the org's Slack app. Both callbacks only complete for the person who started them.
3. **Chat** runs the same assistant as Slack (`POST /api/orgs/:slug/chat`); Slack DMs and web chat share one conversation.

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

An admin can switch mentions to "the asker's private context too" (Settings → Assistant). Then only a prompt instruction stands between private data and the channel.

**Continuity across places.** In a DM or the web chat, tino remembers recent messages from the person's channel threads — as long as they're still in that channel. It runs one way: nothing said in a DM is ever recalled in a channel.

> *In #sales: "@tino where are we on Acme?" → answers from the channel and the workspace KB, sends the email details to your DM. Later, in a DM: "what did the team say in that thread?" → tino remembers the #sales thread.*

**Browse knowledge.** The *Knowledge* page shows private and workspace facts, themes, raw excerpts, semantic search, and the indexer's activity.

**Keep noise out ("don't learn from").** On the Knowledge page, in your private view, exclude mail that looks real but isn't — domain warmup, bots, test sends:
- pick one of your **Gmail labels** (matched by id, so renaming is fine), or
- pick one of your **Gmail filters** — tino turns its criteria into a search, useful when the filter only archives, or
- type a **Gmail search**.

Excluded mail is never indexed. Mail tino already learned from that matches is forgotten on the next indexing cycle (≤5 min): its excerpts are deleted, facts that rested only on it are removed, and facts with other evidence lose those citations. Removing an exclusion only affects new mail. Live Gmail searches you ask for still see everything. The idiomatic setup: let your Gmail filter label the mail, and exclude that label — Gmail stays the one place that decides what's noise.

---

## 5. admin: managing people

In the web app, go to **Team** (API `/api/orgs/:slug/users`, admin-only).

- **Invite.** Enter an email and a role. This creates an `invited` member and emails them a sign-up link. They become active the first time they reach the org on the web with that (verified) email, or DM tino from Slack with it — even in invite-only mode.
- **Promote/demote.** Toggle admin ↔ member.
- **Suspend.** Blocks them in Slack and on the web, and stops KB indexing for them. Their indexed data stays. **Reactivate** reverses it.
- **Guard rail.** The last active admin can't be demoted or suspended.
- **Join policy.** Org-domain or invite-only. Stored as `org.accessControl.*` in the org's settings and read identically by the Slack resolver and the web (`domain/access-policy.ts`).

The list shows each person's Slack link and what they've connected (Slack, Gmail, MCP).

---

## 6. MCP tools

Remote MCP servers add tools from other systems: issue trackers, CRMs, internal APIs. Manage them on the **Tools** page (API `/api/orgs/:slug/mcp`).

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

- **A member leaves the company:** an admin **suspends** them. To delete their indexed data, they send `forget me confirm` before they go; an admin can also rebuild the whole org KB.
- **A user wants their data gone:** `forget me confirm` in a Slack DM. This wipes their chunks, facts, topics, and cursors, and tombstones indexing until they `connect` again.
- **A revoked token:** the indexer pauses that user's source and DMs them. For example: *"my slack connection for you stopped working… DM me 'connect' to fix it."*

---

## gaps worth knowing

- **Public Google Workspace content** (shared Drives, shared docs) is not ingested into the workspace KB. Google content today is Gmail → private KB plus live Gmail/Calendar tools.
- **Private questions asked in a channel are answered in the asker's DM**, not in the thread (see journey 4). Without Slack connected for DMs, tino just tells them to DM it.
- **Recall is recent and literal**: the last few messages from other conversations the readers may see, not a summary of everything. Messages from before this change continue their threads but aren't recalled elsewhere.
- **Google data needs a Workspace account** while orgs bring their own Internal client: `@gmail.com` users can't use an Internal client. Tino's own verified client (stage 1–2 in [`managed-service.md`](managed-service.md#when-to-switch-on-managed-clients)) is what serves them.
- **No org deletion flow yet** — see [`security.md`](security.md#known-gaps).
