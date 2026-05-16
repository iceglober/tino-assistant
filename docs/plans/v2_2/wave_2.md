# wave 2: biome linter

add biome as the project linter and formatter. configure it, fix all lint errors, add a `lint` script to every package and the root. after this wave, every PR gets static analysis beyond TypeScript's type checker.

## why biome

- **fast:** written in Rust, 10-100x faster than eslint for large codebases
- **zero-config for TS/TSX:** works out of the box with TypeScript and React
- **replaces eslint + prettier:** one tool for linting AND formatting
- **growing ecosystem:** biome is the successor to Rome; actively maintained

## items

### 2.1 install biome

**files:**
- root `package.json` — add `@biomejs/biome` to `devDependencies`
- `biome.json` — NEW, root-level config

**config shape:**
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "files": {
    "ignore": ["dist/", "node_modules/", "cdk.out/", "*.lock", "*.json"]
  }
}
```

**acceptance:**
- [ ] `bunx biome check .` runs without crashing
- [ ] config file exists at repo root

### 2.2 fix all lint errors

run `bunx biome check --write .` to auto-fix what biome can. manually fix the rest.

**expected categories of fixes:**
- unused imports
- `var` → `const`/`let`
- unnecessary type assertions
- import ordering
- formatting (indentation, trailing commas, semicolons)

**files:** potentially any `.ts`/`.tsx` file in the repo. biome's `--write` flag auto-fixes most issues.

**acceptance:**
- [ ] `bunx biome check .` exits 0 (no errors)
- [ ] `bun run test` still passes (lint fixes didn't break anything)
- [ ] `bun run typecheck` still passes

### 2.3 add `lint` scripts

**files:**
- root `package.json` — add `"lint": "biome check ."` and `"lint:fix": "biome check --write ."`
- `packages/core/package.json` — add `"lint": "biome check ."`
- `packages/aws/package.json` — add `"lint": "biome check ."`
- `packages/cli/package.json` — add `"lint": "biome check ."`

**acceptance:**
- [ ] `bun run lint` from root exits 0
- [ ] `bun run lint` from each package exits 0

### 2.4 remove stale eslint references

the codebase has `// eslint-disable-next-line` comments but no eslint config. these are dead comments.

**files:** grep for `eslint-disable` across all `.ts`/`.tsx` files and remove the comments (biome uses different directives: `// biome-ignore`).

**acceptance:**
- [ ] `grep -r "eslint-disable" packages/ --include="*.ts" --include="*.tsx"` returns nothing (or only in `node_modules`)

## what does NOT change

- no behavioral changes to any code
- test files may get formatting fixes but no logic changes
- biome is a devDependency only — not shipped in the Docker image
