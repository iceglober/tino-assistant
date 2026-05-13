# Tino Assistant - Project Overview

## Purpose
Personal Slack bot assistant for one user. Runs locally, communicates via Slack DM. Integrates with GitHub, CloudWatch, Google Calendar/Gmail, and Slack reading tools.

## Tech Stack
- TypeScript (ESM, Node >=22)
- Slack Bolt (@slack/bolt) for Slack integration
- AI SDK (ai, @ai-sdk/amazon-bedrock) for Claude via Bedrock
- Zod for schema validation
- Better-SQLite3 for persistence
- Vitest for testing
- pnpm as package manager

## Key Commands
- `pnpm typecheck` — TypeScript type check (no emit)
- `pnpm test` — run all tests with vitest
- `pnpm dev` — tsx watch mode (DO NOT run in agent context)
- `pnpm start` — run once

## Project Structure
- `src/` — source code
  - `agent/` — agent loop, history, bedrock model, system prompt
  - `slack/` — Slack app, user client, types, mrkdwn, proactive, reset
  - `tools/` — tool implementations (github, cloudwatch, google, slack, preferences, tasks)
  - `persistence/` — SQLite stores
  - `scheduler/` — task scheduler
  - `env.ts` — env schema (Zod)
  - `index.ts` — entrypoint
- `tests/` — mirrors src structure, uses vitest
- `plans/` — plan files

## Code Style
- TypeScript strict mode, ESM modules (.js imports)
- No default exports — named exports only
- Zod schemas for all tool inputs
- Each tool category in try/catch in buildTools — missing creds disable only that category
- Test files use vitest (describe/it/expect/vi)
