# tino

Personal Claude agent running locally in Slack DM.

## Setup

```sh
git clone <repo>
cd tino
nvm use          # picks up .nvmrc → Node 22
cp .env.example .env
# fill in .env with your tokens and credentials
pnpm install
pnpm dev
```

## Development

| Command | What it does |
|---|---|
| `pnpm dev` | Start with `tsx watch` — restarts on file changes |
| `pnpm test` | Run vitest test suite once |
| `pnpm typecheck` | TypeScript type-check (no emit) |

## Troubleshooting

_(Phase 2 will add "bot doesn't respond" debugging steps here.)_

---

See [plans/tino.md](plans/tino.md) for the full buildout plan.
