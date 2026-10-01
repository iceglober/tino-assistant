# console

The web console is where admins configure tino and where anyone can chat, browse knowledge, and manage their own MCP servers. It's a React SPA (`packages/core/src/console-app/`) served by the same process that runs the Slack bot.

For the flows people actually go through, see [`user-journeys.md`](user-journeys.md).

## pages

| page | who | what |
|---|---|---|
| Login | everyone | Google sign-in (email/password on localhost only) |
| Setup | admins | Slack tokens + OAuth client, what channel @mentions may use, model provider + key, Google OAuth client. Opens automatically until Slack and a model are configured. |
| Chat | everyone | Talk to tino. Shares one history with your Slack DMs. |
| Knowledge | everyone, when the KB is on | Your private KB and the workspace KB: facts, themes, excerpts, search, indexer activity |
| Tools | everyone | Workspace MCP servers (admins edit, and choose whether results may be used in channels) and your personal ones |
| Users | admins | Join policy, invites, roles, suspension |

## hot reload

Nothing needs a restart:

| change | takes effect |
|---|---|
| Slack tokens, model provider/keys | on save: `POST /api/reload/slack` rebuilds the model + tools and reconnects Slack |
| Google OAuth client | next sign-in (`POST /api/reload/auth`) |
| MCP servers | next message |
| Users, roles, join policy, channel-mention policy | next request / next mention |

## API

All routes need a session except `/api/health`, `/api/auth/*`, and the Slack OAuth routes (those carry a signed connect token).

| route | who |
|---|---|
| `GET /api/health` | public |
| `GET /api/me`, `GET /api/status` | any user |
| `POST /api/chat` | any user |
| `GET /api/kb/*` | any user (their private scope + workspace) |
| `GET/PUT/DELETE /api/mcp/servers/personal/*`, `POST /api/mcp/test` | any user, own servers |
| `PUT/DELETE /api/mcp/servers/workspace/*` | admin |
| `GET/PUT/DELETE /api/config*` | admin (holds every secret) |
| `GET/POST/PATCH /api/users*` | admin |
| `POST /api/reload/slack` | admin |
| `GET /api/oauth/google/*` | any user (connect Gmail + Calendar) |
| `GET /api/oauth/slack/*` | signed connect link from the bot |

## local dev

```sh
bun run dev        # http://localhost:3001, sqlite, email/password sign-in
```

The first account you create is the admin. Delete `tino.db` and `/tmp/tino-auth.db` to start over.

**Careful:** `bun run dev` reads `.env`. If it contains the production Slack tokens, your laptop joins the production Socket Mode connection pool and answers real users' DMs. Use a separate dev Slack app.
