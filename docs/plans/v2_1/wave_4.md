# wave 4: make it polished

observability, HTTPS, documentation, and cosmetic fixes. after this wave, tino is something you'd show to another team.

## items

### 4.1 HTTPS for the console (gap #8)

**problem:** the console runs on HTTP. browsers show "Not Secure". credentials (Google OAuth tokens, Slack tokens entered in the console) are transmitted in plaintext.

**fix:**
- add an optional `consoleDomain` arg to `TinoServiceArgs`
- when provided: create an ACM certificate, Route53 record, HTTPS listener on the ALB
- when not provided: keep HTTP (current behavior) with a console banner warning "running without HTTPS"

**files:**
- `packages/aws/src/pulumi/tino-service.ts` (EDIT) — `consoleDomain`/`hostedZoneId` already exist on `TinoServiceArgs` (lines 45/51) and ACM/Route53/HTTPS listener wiring is in place around lines 689-793. Verify end-to-end and add the no-HTTPS warning banner integration.
- `packages/core/src/console/html.ts` (EDIT) — add a top banner shown when `window.location.protocol === 'http:'` warning the user that the console is unencrypted

**mirror:**
- `consoleDomain` block at `tino-service.ts:732-793` already handles ACM cert + Route53 + HTTPS listener — that section IS the mirror; only validation gaps need closing.
- the existing `slack-connected-banner` element in `html.ts` (referenced from line 1604) is the visual mirror for the HTTPS warning banner — same placement and CSS class style.

**context (TinoServiceArgs ~lines 36-52):**
```ts
consoleDomain?: string;          // e.g. "tino.kayn.ai"
hostedZoneId?: pulumi.Input<string>;   // required when consoleDomain is set
```

**context (Pulumi listener port toggle ~lines 686-690):**
```ts
{ fromPort: args.consoleDomain ? 443 : 80,
  toPort:   args.consoleDomain ? 443 : 80, ... }
```

**Google OAuth note:** the redirect URI registered in the GCP console must match the protocol/domain. When `consoleDomain` is set, redirect URI is `https://<consoleDomain>/api/auth/callback/google`; document that in `docs/deployment.md`.

**conventions:**
- Pulumi resources: child resources of the component use `{ parent: this }`; preserve that pattern
- Pulumi naming: `${name}-cert`, `${name}-https-listener` etc. (already in place); don't change
- TypeScript: `pulumi.Input<T>` for stringly-typed inputs, `pulumi.Output<T>` for outputs
- console JS: vanilla ES; design tokens (`--err`, `--accent`) for the warning banner; never inline hex
- never log raw OAuth tokens — already enforced via `logger.info({ baseUrl, allowedDomain, ... })` (server.ts:60)

**acceptance:**
- [ ] with `consoleDomain`: console accessible at `https://tino.kayn.ai` (or whatever domain)
- [ ] without `consoleDomain`: console accessible at HTTP with a visible warning
- [ ] Google OAuth redirect URI works with HTTPS

### 4.2 audit logging wired to DynamoDB (gap #16)

**problem:** the audit logger uses the in-memory implementation even in production. audit entries are lost on restart.

**fix:**
- when `PERSISTENCE_ADAPTER=dynamodb`, use the DynamoDB audit logger (`@tino/aws/audit/dynamo`)
- the persistence factory should return the audit logger alongside history/tasks/preferences/config

**files:**
- `packages/core/src/persistence/factory.ts` (EDIT) — extend `Persistence` interface to include `auditLogger: AuditLogger`; return it from both adapters
- `packages/aws/src/persistence/dynamo/index.ts` (EDIT) — wire `createDynamoAuditLogger(table, retentionSeconds)` from `packages/aws/src/audit/dynamo.ts:53` into `DynamoPersistence`
- `packages/core/src/index.ts` (EDIT) — replace `createMemoryAuditLogger()` (line 21) with the audit logger from persistence
- `packages/aws/package.json` (EDIT, if needed) — add `./audit/dynamo` export path; mirror the existing `./persistence` export style

**mirror:**
- `packages/aws/src/persistence/factory.ts` (re-export of `createDynamoPersistence`) is the export-shape mirror for `audit/dynamo`.
- the Persistence factory destructure pattern in `index.ts:18` is the consumption mirror — keep both stores destructured from one factory call.

**context (current factory.ts ~all 49 lines):**
```ts
export interface Persistence {
  history: HistoryStore;
  tasks: TaskStore;
  preferences: PreferencesStore;
  config: ConfigStore;
  // ← add: auditLogger: AuditLogger;
}

export async function createPersistence(env: Env, logger: AppLogger): Promise<Persistence> {
  const adapter = env.PERSISTENCE_ADAPTER ?? 'sqlite';
  if (adapter === 'dynamodb') {
    const { createDynamoPersistence } = await import('@tino/aws/persistence');
    return createDynamoPersistence(env, logger);
  }
  // SQLite branch — for SQLite, return createMemoryAuditLogger() (no persistence in dev)
}
```

**context (current index.ts audit logger ~lines 18-21):**
```ts
const { history, tasks: taskStore, config: configStore } = await createPersistence(env, logger);
const auditLogger = createMemoryAuditLogger();   // ← replace with persistence.auditLogger
```

**context (DynamoAuditLogger factory `packages/aws/src/audit/dynamo.ts:53-57`):**
```ts
export function createDynamoAuditLogger(
  table: TinoTable,
  retentionSeconds = DEFAULT_RETENTION_SECONDS,   // 90 days
): AuditLogger
```

**conventions:**
- imports: dynamic `await import('@tino/aws/audit')` — keep AWS SDK out of the SQLite branch
- exports: named `export function`; `Persistence` interface lives in core
- TTL: pass `retentionSeconds` from `tino.deploy.json` `hipaa.auditRetentionDays * 86400`; default 90 days matches `DEFAULT_RETENTION_SECONDS` in `dynamo.ts:22`
- audit entries: never include PII in `inputKeys` (only key NAMES) — already enforced by `AuditEntry` type comment at `audit/logger.ts:9`
- tests: vitest, mock the dynamo client per `packages/core/tests/tools/preferences.test.ts` pattern

**acceptance:**
- [ ] audit entries visible in the console's compliance section
- [ ] audit entries survive ECS task restart
- [ ] `entry count` in the compliance dashboard shows real numbers

### 4.3 compliance dashboard shows real status (gap #17)

**problem:** encryption status, BAA status all show "unknown" because there's no way to query AWS resource state from the running container.

**fix:**
- read `tino.deploy.json` (if available) for BAA status
- for encryption: the component always creates CMK, so hardcode "cmk" when `PERSISTENCE_ADAPTER=dynamodb`
- for audit logging: read from the audit logger's stats

**files:**
- `packages/core/src/console/server.ts` (EDIT) — `GET /api/compliance` route at lines 229-284: replace the hardcoded `'unknown'`s in the `encryption` block (lines 257-261) with computed values
- `tino.deploy.json` (REFERENCE — already read at server.ts:239-244)

**mirror:**
- the existing `auditLogging` stats path at `server.ts:247-265` (already reads `auditLogger.count()` and `auditLogger.lastEntryAt()`) is the in-route data-fetch mirror — apply the same shape to encryption/BAA reads.
- `tino.deploy.json` schema lives in `packages/cli/src/commands/init/types.ts` (`DeployConfig.compliance.baaStatus`) — match those field names.

**context (server.ts compliance route ~lines 229-284):**
```ts
if (method === 'GET' && routePath === '/api/compliance') {
  void (async () => {
    let baaStatus: Record<string, string> = { aws: 'unknown', bedrock: 'unknown', github: 'unknown', slack: 'no-baa' };
    try {
      const deployJsonPath = new URL('../../../../tino.deploy.json', import.meta.url);
      const deployJson = JSON.parse(fs.readFileSync(deployJsonPath, 'utf8')) as { baa?: Record<string, string> };
      if (deployJson.baa) baaStatus = { ...baaStatus, ...deployJson.baa };
    } catch { /* file doesn't exist — use defaults */ }

    const entryCount   = auditLogger ? await auditLogger.count() : 0;
    const lastEntryAt  = auditLogger ? await auditLogger.lastEntryAt() : undefined;

    const body = JSON.stringify({
      hipaa: {
        encryption: {
          dynamodb:        'unknown',  // ← compute from PERSISTENCE_ADAPTER
          secretsManager:  'unknown',  // ← 'cmk' when adapter='dynamodb' (component always provisions CMK)
          cloudwatchLogs:  'unknown',  // ← 'cmk' when adapter='dynamodb'
        },
        auditLogging: { enabled, entryCount, lastEntryAt, retentionDays: 90 },
        // ...
      },
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  })();
}
```

**context (DeployConfig.compliance.baaStatus shape, `packages/cli/src/commands/init/types.ts`):**
```ts
baaStatus: {
  aws: 'verified' | 'manual-confirmed' | 'skipped';
  bedrock: 'verified' | 'manual-confirmed' | 'skipped';
  github?: 'confirmed' | 'no-baa' | 'unknown';
  google?: 'confirmed' | 'no-baa' | 'unknown';
  linear?: 'confirmed' | 'no-baa' | 'unknown';
};
```
note: existing route reads `deployJson.baa`, but `tino.deploy.json` writes `compliance.baaStatus` — the shape mismatch is part of why everything shows "unknown". Fix the path: `deployJson.compliance?.baaStatus`.

**conventions:**
- imports: `import fs from 'node:fs'` (already imported at server.ts:2)
- env reads: `process.env['PERSISTENCE_ADAPTER']` returning `'dynamodb' | 'sqlite' | undefined`
- never widen the `unknown` set — when in doubt return `'unknown'` rather than fabricate `'cmk'`
- error handling: existing `try { } catch { /* defaults */ }` pattern is fine; preserve it for the deploy.json read
- tests: vitest; for this route, integration-test by stubbing `auditLogger` with the in-memory implementation

**acceptance:**
- [ ] BAA status shows "verified" or "manual-confirmed" (from deploy config)
- [ ] encryption shows "cmk" for DynamoDB, Secrets Manager, CloudWatch Logs
- [ ] audit log health shows real entry count and last entry timestamp

### 4.4 fix `tino-tino` naming (gap #18)

**problem:** all AWS resources are named `tino-tino` because the Pulumi component name is "tino" and the resource prefix is also "tino".

**fix:**
- the component should use just the name without doubling: `tino` not `tino-tino`
- or: accept a `resourcePrefix` arg that defaults to the component name

**note:** changing resource names requires replacing resources (DynamoDB table rename = data loss). this should be done carefully, possibly as a migration.

**files:**
- `packages/aws/src/pulumi/tino-service.ts` (EDIT) — every `tino-${name}` literal (greppable: `tino-${name}` appears in `name:` fields at lines 356, 368, 398, 446, 467, 478, 485, 502, 675, 866). Decide on a `resourcePrefix` arg or drop the redundant `tino-` prefix.
- `packages/cli/src/commands/init/*.ts` (EDIT) — pass through the desired prefix; default the Pulumi component name to something other than "tino" (e.g., the user's deployment name) to avoid the doubling

**mirror:**
- existing arg pattern at `tino-service.ts:5-30` (every option doc-commented; defaults inline) is the mirror for adding `resourcePrefix?: string`.
- DynamoDB table-name pattern at `tino-service.ts:368` (`name: \`tino-${name}\``) is the rename target; replicate the change everywhere it appears.

**context (sample `tino-${name}` site at `tino-service.ts:368`):**
```ts
const table = new aws.dynamodb.Table(`${name}-table`, {
  name: `tino-${name}`,                    // ← becomes `${args.resourcePrefix ?? name}` (default `${name}`)
  billingMode: 'PAY_PER_REQUEST',
  // ...
}, { parent: this });
```

**all current `tino-${name}` occurrences (line numbers in `tino-service.ts`):**
- 356 (`alias/tino-${name}` — KMS alias)
- 368 (`tino-${name}` — DynamoDB table name)
- 398 (`/ecs/tino-${name}` — log group)
- 446 (`/vpc/tino-${name}` — flow log group)
- 467, 478, 485 (`tino-${name}-security-*`)
- 502 (`tino-${name}` — Secrets Manager secret name)
- 675 (`tino-${name}` — ECS cluster name)
- 866 (`tino-${name}` — DYNAMODB_TABLE_NAME env var)

**migration note (HIPAA-relevant — data loss risk):**
- DynamoDB tables CANNOT be renamed in place; rename = replace = data loss. Before renaming, backup → restore-into-new-table → cutover. Document that path in `docs/migration.md` (referenced by 4.6).

**conventions:**
- Pulumi: prefer `args.resourcePrefix ?? name` so callers can override, preserving the existing default for greenfield deploys
- arg docs: TSDoc above every new field — match the style at `tino-service.ts:5-52`
- never auto-rename in-place — gate any rename behind a `--migrate` flag in the CLI and require an explicit backup confirmation
- tests: typecheck-only for now (`packages/aws` has no test file in `tests/`, so add a `pulumi.runtime.runInPulumiStack`-style integration test if we add tests)

**acceptance:**
- [ ] new deployments use clean names (`tino` not `tino-tino`)
- [ ] existing deployments can migrate without data loss (or the migration path is documented)

### 4.5 fix VPC Flow Logs deprecation warning (gap #20)

**problem:** `log_group_name is deprecated. Use log_destination instead` on every `pulumi up`.

**fix:**
- in the `TinoService` component, change the `FlowLog` resource to use `logDestination` instead of `logGroupName`

**files:**
- `packages/aws/src/pulumi/tino-service.ts` (EDIT) — `aws.ec2.FlowLog` resource at lines 452-460

**mirror:**
- `aws.cloudwatch.LogGroup` declared at `tino-service.ts:445-450` already exposes `.arn` — that's the input the new `logDestination` field expects; same Pulumi `Output<string>` plumbing.

**context (current FlowLog ~lines 452-460):**
```ts
const flowLogGroup = new aws.cloudwatch.LogGroup(`${name}-flow-logs`, {
  name: `/vpc/tino-${name}`,
  retentionInDays: 90,
  kmsKeyId: kmsKey.arn,
  tags,
}, { parent: this });

new aws.ec2.FlowLog(`${name}-vpc-flow-log`, {
  vpcId: vpcId,
  trafficType: "ALL",
  logDestinationType: "cloud-watch-logs",
  logGroupName: flowLogGroup.name,         // ← DEPRECATED — change to logDestination: flowLogGroup.arn
  iamRoleArn: flowLogRole.arn,
  maxAggregationInterval: 60,
  tags: { ...tags, "tino:resource": "vpc-flow-log" },
}, { parent: this });
```

**target shape:**
```ts
new aws.ec2.FlowLog(`${name}-vpc-flow-log`, {
  vpcId: vpcId,
  trafficType: "ALL",
  logDestinationType: "cloud-watch-logs",
  logDestination: flowLogGroup.arn,        // ← NEW (ARN, not name)
  iamRoleArn: flowLogRole.arn,
  maxAggregationInterval: 60,
  tags: { ...tags, "tino:resource": "vpc-flow-log" },
}, { parent: this });
```

**conventions:**
- Pulumi: `logDestination` takes an ARN (`Output<string>`); `logGroupName` took a name. Use `flowLogGroup.arn`, not `flowLogGroup.name`.
- preserve the `{ parent: this }` option and the existing tags
- typecheck before `pulumi up` (deprecation warning may go away even with `logGroupName`; verify `pulumi preview` shows no replacement on existing stacks since the underlying resource just toggles which property is set)
- migration: `aws.ec2.FlowLog` does NOT support in-place updates between `logGroupName` ↔ `logDestination` cleanly in some provider versions; if `pulumi preview` shows replace, accept it (flow logs are not stateful — losing 1-minute granularity for a few seconds is fine)

**acceptance:**
- [ ] `pulumi up` produces no deprecation warnings

### 4.6 documentation

**files:**
- `README.md` (EDIT) — already exists at repo root; add the two installation paths
- `docs/deployment.md` (NEW) — step-by-step deployment guide
- `docs/console.md` (NEW) — how to use the console
- `docs/architecture.md` (NEW) — how tino works (packages, persistence, tools, scheduler)
- `docs/security.md` (NEW) — security model, compliance controls
- `CONTRIBUTING.md` (NEW) — local dev, tests, adding tools

**mirror:**
- existing `README.md` at the repo root sets the tone (warm, terse, second-person). Mirror that voice in new doc files.
- `docs/plans/v2_1/main.md` (this plan's overview file) is the structural mirror for `docs/architecture.md` — wave-style numbered sections with a short principles preamble.

**context (current README.md head — confirm tone):**
- read `README.md` at the repo root before drafting; do not rewrite the whole file, only add the "two installation paths" section near the top.

**conventions:**
- markdown: lowercase headings (matches the rest of `docs/plans/v2_1/*.md`); `##` for sections, `###` for subsections; never `#` inside a doc (file title is plaintext or `# <Title>` once at top)
- code blocks: triple-backtick with language tag (`bash`, `ts`, `dockerfile`)
- file paths: backticked (`` `packages/core/src/...` ``), not bold
- security/compliance docs: every claim that says "we do X" must point to the file/line that enforces it (e.g. "audit retention 90d → `packages/aws/src/audit/dynamo.ts:22`")
- screenshots in `docs/console.md`: store under `docs/img/` (NEW directory); reference relative paths
- never include real credentials, real account IDs, or customer domain names in examples — use `tino.example.com`, `123456789012`, etc.

**what's needed:**
- [ ] README updated with the two installation paths (standalone + npm install)
- [ ] `docs/deployment.md` — step-by-step deployment guide (what we just went through, but clean)
- [ ] `docs/console.md` — how to use the console (screenshots, capability setup)
- [ ] `docs/architecture.md` — how tino works (packages, persistence, tools, scheduler)
- [ ] `docs/security.md` — security model, compliance controls, what's enforced automatically
- [ ] `CONTRIBUTING.md` — how to develop locally, run tests, add a new tool
