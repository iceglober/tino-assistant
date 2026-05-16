# tino v2.2 — stack cleanup

## what this is

v2.1 shipped the full feature set (Hono server, React SPA, capability config, hot-reload, HTTPS, docs). but the stack has friction: `better-sqlite3` can't run in Bun's runtime, the Dockerfile uses Node instead of Bun, there's no linter, dead code is piling up, and new server routes have zero test coverage. v2.2 cleans all of this up so the project is a clean, all-Bun stack with enforced code quality.

## principles

1. **one runtime everywhere.** Bun for dev, test (vitest), Docker, and production. no Node dependency in the runtime path.
2. **`bun run test` is the canonical test command.** vitest stays (27 test files use its APIs, it's mature, all 314 tests pass). `bun test` (Bun's built-in runner) is not supported — it's a different command with different semantics.
3. **dead code gets deleted, not commented.** if nothing imports it, it's gone.
4. **every new file gets a test.** the v2.1 autopilot added 19 server route and React component files with zero tests. fix that.

## waves

- **wave 0: bun:sqlite migration** — replace `better-sqlite3` with `bun:sqlite` across all persistence files and `better-auth`. switch Docker from `node:22-slim` to `oven/bun`. this is the architectural change that unblocks everything else.
- **wave 1: dead code + cleanup** — delete dead files, remove unused deps, fix Dockerfile inefficiencies, clean up stale comments.
- **wave 2: biome linter** — add biome, configure it, fix all lint errors, add a `lint` script.
- **wave 3: test coverage** — add tests for untested server routes, capability modules, and critical React components.
- **wave 4: deploy verification** — build, push, deploy to ECS, verify end-to-end (console, Slack, hot-reload, compliance).

each wave has its own file with detailed acceptance criteria.

## execution order

for "deploy ASAP": wave 0 → wave 4 → wave 1 → waves 2-3.
waves 0 and 4 are the critical path. waves 1-3 improve quality but don't block a working deployment.

## known gaps (complete inventory)

### critical (architectural)

| # | gap | impact | wave |
|---|-----|--------|------|
| 1 | **`better-sqlite3` incompatible with Bun runtime** — native Node addon can't load in Bun. blocks all-Bun Docker image and causes `bun test` confusion | can't run `bun packages/core/src/index.ts` directly; Docker must use `node` | 0 |
| 2 | **no linter configured** — zero static analysis beyond TypeScript's type checker. no formatting enforcement | code quality drift, inconsistent style | 2 |

### high (developer friction)

| # | gap | impact | wave |
|---|-----|--------|------|
| 3 | **dead code: `src/tools/index.ts`** (171 lines) — `buildTools()` never imported, replaced by `capabilities/registry.ts` | confusing for new contributors | 1 |
| 4 | **dead code: `src/scheduler/linear-poller.ts`** (74 lines) — migrated into `capabilities/linear.ts` | same | 1 |
| 5 | **dead code: `infra/` directory** — empty CDK scaffold, project uses Pulumi | same | 1 |
| 6 | **Dockerfile copies `src/` to runner stage** — unnecessary, bloats image | ~100KB wasted, source code in production image | 1 |
| 7 | **Dockerfile missing `tino.deploy.json`** — compliance endpoint can't read BAA status | compliance dashboard shows defaults instead of real values | 1 |
| 8 | **unused deps in `@tino/core`** — `@smithy/fetch-http-handler`, `@smithy/node-http-handler` never imported | dependency bloat | 1 |
| 9 | **`@tino/cli` has zero tests** — 15 source files, no test script | silent regression risk | 3 |

### medium (test coverage)

| # | gap | impact | wave |
|---|-----|--------|------|
| 10 | **server routes untested** — `bedrock.ts`, `health.ts`, `compliance.ts`, `users.ts`, `capabilities.ts`, `config.ts` have no route-level tests | regressions undetected | 3 |
| 11 | **React components untested** — 19 files in `console-app/` with only 1 test file (`header-restart-button.test.ts`) | UI regressions undetected | 3 |
| 12 | **`InsecureBanner.tsx` uses inline rgba** — should use design tokens | style consistency | 1 |

### low (cosmetic)

| # | gap | impact | wave |
|---|-----|--------|------|
| 13 | **stale comments referencing `buildTools`** — 4 files mention the dead function | misleading | 1 |
| 14 | **`dotenv` is a runtime dep** — only needed in local dev, no-op in Docker | minor image bloat | 1 |
