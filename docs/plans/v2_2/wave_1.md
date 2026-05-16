# wave 1: dead code + cleanup

delete dead files, remove unused deps, fix Dockerfile inefficiencies, clean up stale comments. after this wave, every file in the repo is either imported or documented.

## items

### 1.1 delete `src/tools/index.ts`

**what:** `buildTools()` (171 lines) is never imported. the capability registry (`capabilities/registry.ts`) replaced it entirely. the file is dead code that confuses contributors.

**files:**
- `packages/core/src/tools/index.ts` — DELETE

**mirror:** `packages/core/src/capabilities/registry.ts` is the live replacement — read its top doc comment to understand what `buildTools()` was superseded by; no other "delete a single dead file" precedent in this repo, so the pattern is just `git rm <path>`.

**context:** `packages/core/src/tools/index.ts` (171 lines) — verify-before-delete. The single export is `buildTools`, signature at line 42:
```ts
// imports (lines 1-40): pulls every tool module from ./github, ./cloudwatch,
// ./google, ./slack, ./linear, ./preferences, ./tasks, plus persistence stores
// and the slack user-client factory.

export async function buildTools(
  env: Env,
  logger: AppLogger,
  taskStore?: TaskStore,
  configStore?: ConfigStore,
  preferencesStore?: PreferencesStore,
): Promise<ToolSet> {
  // 130+ lines: try/catch each client constructor (createOctokit,
  // createCloudWatchLogsClient, createGoogleAuth, createSlackUserClient,
  // createLinearClient), register the matching tools on success, log+skip on
  // failure. Returns one merged ToolSet.
}
```
Verified dead: `grep -rn "buildTools" packages/ --include="*.ts"` shows only the definition itself plus the four stale doc-comments in 1.8 — no real importers. `dist/` hits are build output and clear on next build.

**conventions:** ESM with `.js` extensions on relative imports (e.g. `'../env.js'`); named exports only (no defaults); `bun:test`/`vitest` for tests; `pino` for logging; errors thrown as plain `Error` and caught at registry boundaries.

**verify:** `grep -r "from.*tools/index" packages/ --include="*.ts"` returns nothing (only a comment in `capabilities/linear.ts` mentions it — update that comment).

**acceptance:**
- [x] file deleted
- [x] `bun run build` succeeds
- [x] `bun run test` passes

### 1.2 delete `src/scheduler/linear-poller.ts`

**what:** `startLinearPoller()` (74 lines) is never imported. the logic was migrated into `capabilities/linear.ts`.

**files:**
- `packages/core/src/scheduler/linear-poller.ts` — DELETE

**mirror:** `packages/core/src/capabilities/linear.ts` is where the poller logic now lives (its `findWork` hook replaces `startLinearPoller`). Same pattern as 1.1 — straight delete.

**context:** `packages/core/src/scheduler/linear-poller.ts` (74 lines) — verify-before-delete. Exports `LinearPollerDeps` (interface) and `startLinearPoller` (function). Top of file:
```ts
import type { LinearClient } from '@linear/sdk';
import type { AppLogger } from '../slack/app.js';

export interface LinearPollerDeps {
  linearClient: LinearClient;
  logger: AppLogger;
  onNewIssue: (issue: { id: string; identifier: string; title: string; description?: string; url: string }) => Promise<void>;
  intervalMs?: number; // default 15 minutes
}

/** Polls Linear every 15 minutes for issues assigned to tino (the viewer)
 *  that are in a "Todo" or "Backlog" state... (full doc-comment in file) */
export function startLinearPoller(deps: LinearPollerDeps): () => void {
  // setInterval loop: fetch viewer's assigned Todo/Backlog issues,
  // dedup against in-memory Set<string>, call onNewIssue for each new one.
  // Returns a stop() function that clears the interval.
}
```
Verified dead: `grep -rn "startLinearPoller\|from.*scheduler/linear-poller" packages/ --include="*.ts"` shows only the definition itself and one comment in `capabilities/linear.ts` (`Migrated from src/scheduler/linear-poller.ts.`) — no real importers.

**conventions:** ESM with `.js` extensions on relative imports; named exports; pino logging via `AppLogger`; in-memory dedup state replaced by capability runtime state in the registry.

**verify:** `grep -r "from.*scheduler/linear-poller" packages/ --include="*.ts"` returns nothing.

**acceptance:**
- [x] file deleted
- [x] `bun run build` succeeds

### 1.3 delete `infra/` directory

**what:** empty CDK scaffold with `package.json`, `pnpm-lock.yaml`, `cdk.out/`, but zero source files. the project uses Pulumi (`packages/aws/src/pulumi/`). this is leftover from an early prototype.

**files:**
- `infra/` — DELETE entire directory

**mirror:** `packages/aws/src/pulumi/` is the live infra-as-code home for this project (Pulumi). `infra/` is a CDK scaffold with only `package.json`, `pnpm-lock.yaml`, `cdk.context.json`, `cdk.out/`, `tsconfig.json` — no `*.ts` source files. Pattern is straight `git rm -rf infra/`.

**context:** `infra/` directory listing (no source code present):
```
infra/
  .gitignore
  cdk.context.json
  cdk.out/
  node_modules/
  package.json
  pnpm-lock.yaml
  tsconfig.json
```
Verified `find infra -name "*.ts" -not -path "*/node_modules/*" -not -path "*/cdk.out/*"` returns nothing — no source to preserve.

**conventions:** `infra/` is NOT in the root `package.json` workspaces list (workspaces are `packages/*`). Removing the directory has zero effect on `bun install` or any build. The repo's actual infra lives in `packages/aws/src/pulumi/` (Pulumi, not CDK).

**acceptance:**
- [x] directory deleted
- [x] `bun run build` succeeds (infra/ was never part of the workspace)

### 1.4 fix Dockerfile: remove `src/` copies from runner stage

**what:** the runner stage copies `packages/core/src` and `packages/aws/src` into the production image. these are TypeScript source files — the runner only needs `dist/`. removing them shrinks the image and avoids shipping source code.

**files:**
- `Dockerfile` — remove these two lines from the runner stage:
  ```dockerfile
  COPY packages/core/src ./packages/core/src
  COPY packages/aws/src ./packages/aws/src
  ```

**mirror:** the existing runner-stage `COPY --from=builder /app/packages/core/dist ./packages/core/dist` and `COPY --from=builder /app/packages/aws/dist ./packages/aws/dist` lines (Dockerfile:32-33) are the live pattern — runner ships only `dist/`, never `src/`. The `src/` copies on lines 30-31 are the anomaly being removed.

**context:** runner stage as-is (Dockerfile:21-43, lines to delete shown):
```dockerfile
FROM node:22-slim AS runner
WORKDIR /app
RUN npm install -g bun
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/aws/node_modules ./packages/aws/node_modules
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/aws/package.json ./packages/aws/
COPY packages/core/src ./packages/core/src     # ← DELETE
COPY packages/aws/src ./packages/aws/src       # ← DELETE
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/aws/dist ./packages/aws/dist
COPY assets ./assets
COPY scripts ./scripts
```
The builder stage (lines 10-19) still copies `src/` because tsc/vite need it; only the runner stage is affected.

**conventions:** Dockerfile is a multi-stage build (`deps` → `builder` → `runner`). Runner CMD is `node packages/core/dist/index.js` — only `dist/` is referenced at runtime. Workspace symlinks under `node_modules/@tino/*` are created in the runner stage (lines 38-40); they point to `/app/packages/core` (the directory containing `package.json` + `dist/`), so removing `src/` does not break resolution.

**acceptance:**
- [x] `docker build -t tino .` succeeds
- [x] `docker run --rm tino ls packages/core/src 2>&1` shows "No such file or directory"
- [x] `docker run --rm tino bun run packages/core/dist/index.js` starts (may fail on missing env vars, but shouldn't crash on missing source files)

### 1.5 fix Dockerfile: add `tino.deploy.json` copy

**what:** the compliance endpoint (`GET /api/compliance`) reads `tino.deploy.json` for BAA status and retention config. the file is generated by `tino init` but never copied into the Docker image. the endpoint falls back to defaults (not a crash), but compliance data is incomplete.

**files:**
- `Dockerfile` — add to runner stage:
  ```dockerfile
  COPY tino.deploy.json* ./
  ```
  (the `*` glob makes it optional — the build won't fail if the file doesn't exist)

**mirror:** existing `COPY assets ./assets` and `COPY scripts ./scripts` lines (Dockerfile:34-35) — same pattern of copying a root-level resource into `/app` in the runner stage. Place the new line near them (just before or after).

**context:** `compliance.ts:53-58` reads the file relative to the compiled module path (`dist/server/routes/compliance.js`), going five levels up to the repo root:
```ts
try {
  const deployJsonPath = new URL('../../../../../tino.deploy.json', import.meta.url);
  const deployJson = JSON.parse(fs.readFileSync(deployJsonPath, 'utf8')) as {
    compliance?: { baaStatus?: Record<string, string> };
    hipaa?: { auditRetentionDays?: number; historyRetentionDays?: number };
  };
```
With `WORKDIR /app` and `dist/` ending up at `/app/packages/core/dist/server/routes/compliance.js`, the `../../../../../` resolves to `/app/tino.deploy.json` — exactly where this `COPY` lands the file.

**conventions:** Dockerfile uses `COPY <src> <dst>` form. The trailing `*` after a filename makes the source a glob — matches zero-or-more files; if the file doesn't exist, the build does NOT fail (verified pattern). No need for a `.dockerignore` change — `tino.deploy.json` is already not ignored.

**note:** `tino.deploy.json` is generated by `tino init` in the project root. it contains deployment config (compliance flags, BAA status, region). it's not sensitive (no secrets).

**acceptance:**
- [x] `docker build -t tino .` succeeds (with or without `tino.deploy.json` present)
- [x] if `tino.deploy.json` exists, `docker run --rm tino cat tino.deploy.json` shows the file

### 1.6 remove unused deps from `@tino/core`

**what:** `@smithy/fetch-http-handler` and `@smithy/node-http-handler` are declared in `@tino/core`'s `dependencies` but never imported in core's source. they're only used in `@tino/aws` (which declares them separately).

**files:**
- `packages/core/package.json` — remove `@smithy/fetch-http-handler` and `@smithy/node-http-handler` from `dependencies`
- `bun.lock` — regenerated

**mirror:** `packages/aws/package.json`'s `dependencies` block already declares `@smithy/node-http-handler` directly — that's the correct pattern, since `packages/aws/src/persistence/dynamo/client.ts:3` actually imports it. Mirror that ownership: AWS-package smithy deps stay in `packages/aws`, never in core.

**context:** `packages/core/package.json:60-79` (current `dependencies`):
```json
"dependencies": {
  "@ai-sdk/amazon-bedrock": "^4.0.105",
  "@aws-sdk/client-cloudwatch-logs": "^3.1045.0",
  "@aws-sdk/credential-providers": "^3.1045.0",
  "@hono/node-server": "^2.0.2",
  "@linear/sdk": "^84.0.0",
  "@octokit/rest": "^22.0.1",
  "@slack/bolt": "^4.7.2",
  "@smithy/fetch-http-handler": "^5.4.1",   // ← REMOVE
  "@smithy/node-http-handler": "^4.7.1",    // ← REMOVE
  "ai": "^6.0.178",
  "better-auth": "^1.6.11",
  ...
```
Verified: `grep -rn "@smithy" packages/core/src --include="*.ts"` returns nothing. `grep -rn "@smithy" packages/aws/src --include="*.ts"` returns one hit (`packages/aws/src/persistence/dynamo/client.ts:3: import { NodeHttpHandler } from '@smithy/node-http-handler';`).

**conventions:** root workspace uses Bun (`bun.lock`, not `package-lock.json` or `pnpm-lock.yaml`). Run `bun install` after editing the package.json — Bun rewrites `bun.lock` deterministically. Dependencies are alphabetically sorted in this file; preserve that ordering when removing entries.

**acceptance:**
- [x] `grep -r "@smithy" packages/core/src/ --include="*.ts"` returns nothing
- [x] `bun install` succeeds
- [x] `bun run build` succeeds

### 1.7 fix `InsecureBanner.tsx` inline rgba

**what:** `InsecureBanner.tsx:33-34` uses `rgba(192, 96, 96, 0.08)` and `rgba(192, 96, 96, 0.35)` instead of design tokens. the wave 0 convention says "design tokens go to `styles/tokens.css`; never hex inline."

**files:**
- `packages/core/src/console-app/styles/tokens.css` — add `--err-bg: rgba(192, 96, 96, 0.08)` and `--err-border: rgba(192, 96, 96, 0.35)` to the `:root` block
- `packages/core/src/console-app/components/InsecureBanner.tsx` — replace inline rgba with `var(--err-bg)` and `var(--err-border)`

**mirror:** existing `:root` declarations in `tokens.css:15-38` — vars like `--err: #c06060;` (line 29), `--ok: #6aab7a;` (line 28). Place the two new tokens directly after `--err:` to keep the error-related tokens grouped. For the `var(--err-*)` substitution in TSX, mirror how `color: 'var(--err)'` is already used inline at `InsecureBanner.tsx:35`.

**context:** `tokens.css:15-38` (`:root` block, with insertion point):
```css
:root {
  --bg-deep:    #141c27;
  --bg-base:    #1a2332;
  --bg-raised:  #1f2b3d;
  --bg-inset:   #162030;
  --border:     #2a3a50;
  --border-sub: #223040;
  --text-prim:  #f2ebe3;
  --text-sec:   #9aa6b8;
  --text-dim:   #5a6a7e;
  --accent:     #c8956a;
  --accent-dim: #7a4e2a;
  --silver:     #a8b0bc;
  --ok:         #6aab7a;
  --err:        #c06060;
  // ← INSERT --err-bg and --err-border here
  --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  ...
}
```

`InsecureBanner.tsx:28-40` (the inline `style` block to fix):
```tsx
<div
  role="alert"
  aria-live="polite"
  style={{
    background: 'rgba(192, 96, 96, 0.08)',           // ← var(--err-bg)
    borderBottom: '1px solid rgba(192, 96, 96, 0.35)', // ← '1px solid var(--err-border)'
    color: 'var(--err)',
    padding: '10px 16px',
    fontSize: '0.857rem',
    textAlign: 'center',
  }}
>
```

**conventions:** CSS custom properties live ONLY in `tokens.css` `:root` (single source of truth). Components reference them via `var(--name)` — never raw hex/rgba inline. Existing inline `var()` references in this same component (line 35: `color: 'var(--err)'`, line 47: `fontFamily: 'var(--mono)'`) are the established pattern. Token names use kebab-case; group related tokens (e.g. all `--err-*` adjacent). Vite build (`vite build`) inlines CSS imports — no separate build step needed for new tokens.

**acceptance:**
- [x] no inline `rgba` in `InsecureBanner.tsx`
- [x] `bun run build` succeeds (vite build includes the new tokens)

### 1.8 update stale comments referencing `buildTools`

**what:** 4 files have doc-comments mentioning `buildTools` or "Caller (buildTools) catches". the function is deleted (1.1). update to reference the capability registry.

**files:**
- `packages/core/src/tools/github/client.ts` — update comment
- `packages/core/src/tools/linear/client.ts` — update comment
- `packages/core/src/tools/google/oauth.ts` — update comment
- `packages/core/src/slack/userClient.ts` — update comment

**mirror:** `packages/core/src/capabilities/registry.ts` (top doc-comment, lines 1-13) and the per-capability files in `packages/core/src/capabilities/` (e.g. `linear.ts:24-42`) — they're the new location of "construct client, register tools, handle missing-creds gracefully". Replace `buildTools` references with the matching capability module (e.g. `githubCapability.registerTools` in `capabilities/github.ts`, `linearCapability.registerTools` in `capabilities/linear.ts`). For the comment style itself, mirror the doc-comment tone in `linear.ts:1-9` — short, factual, ends with a `migrated from <old-path>` note when relevant.

**context:** the four stale comment sites:

`packages/core/src/tools/github/client.ts:6-9`:
```ts
 *
 * Throws if GITHUB_TOKEN is unset. Caller (`buildTools`) catches and
 * degrades gracefully — the bot keeps running without the GitHub tools.
 */
```

`packages/core/src/tools/linear/client.ts:6-9`:
```ts
 *
 * Throws if LINEAR_DEVELOPER_TOKEN is unset. Caller (`buildTools`) catches and
 * degrades gracefully — the bot keeps running without the Linear tools.
 */
```

`packages/core/src/tools/google/oauth.ts:10-12`:
```ts
 * Throws if any of the three required env vars are missing. Caller
 * (buildTools) catches and degrades gracefully.
 */
```

`packages/core/src/slack/userClient.ts:10-13`:
```ts
 *
 * Throws if SLACK_USER_TOKEN is not set. Caller (buildTools) catches
 * and degrades gracefully.
 */
```
Replace each `buildTools` reference with the appropriate capability module: github → `githubCapability.registerTools` (`capabilities/github.ts`); linear → `linearCapability.registerTools` (`capabilities/linear.ts`); google → `gmailCapability` / `calendarCapability` (`capabilities/gmail.ts`, `capabilities/calendar.ts`); slack user client → `slackCapability.registerTools` (`capabilities/slack.ts`).

**conventions:** comments only — no code changes in this item. Use `/** ... */` JSDoc-style block comments (existing pattern across `packages/core/src/`). Be specific: name the actual capability module (`githubCapability.registerTools` in `capabilities/github.ts`), not just "the capability registry". Keep wording terse and factual; match the surrounding voice.

**acceptance:**
- [x] `grep -r "buildTools" packages/core/src/ --include="*.ts"` returns nothing

## what does NOT change

- the server, React SPA, capabilities, persistence interfaces — all unchanged
- test files — unchanged (they test the interfaces, not the implementation details)
- `@tino/aws` and `@tino/cli` packages — unchanged
