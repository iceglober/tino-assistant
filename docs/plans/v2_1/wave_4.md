# wave 4: make it polished

observability, HTTPS, documentation, and cosmetic fixes. after this wave, tino is something you'd show to another team.

## items

### 4.1 HTTPS for the console (gap #8)

**problem:** the console runs on HTTP. browsers show "Not Secure". credentials (Google OAuth tokens, Slack tokens entered in the console) are transmitted in plaintext.

**fix:**
- add an optional `consoleDomain` arg to `TinoServiceArgs`
- when provided: create an ACM certificate, Route53 record, HTTPS listener on the ALB
- when not provided: keep HTTP (current behavior) with a console banner warning "running without HTTPS"

**acceptance:**
- [ ] with `consoleDomain`: console accessible at `https://tino.kayn.ai` (or whatever domain)
- [ ] without `consoleDomain`: console accessible at HTTP with a visible warning
- [ ] Google OAuth redirect URI works with HTTPS

### 4.2 audit logging wired to DynamoDB (gap #16)

**problem:** the audit logger uses the in-memory implementation even in production. audit entries are lost on restart.

**fix:**
- when `PERSISTENCE_ADAPTER=dynamodb`, use the DynamoDB audit logger (`@tino/aws/audit/dynamo`)
- the persistence factory should return the audit logger alongside history/tasks/preferences/config

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

**acceptance:**
- [ ] new deployments use clean names (`tino` not `tino-tino`)
- [ ] existing deployments can migrate without data loss (or the migration path is documented)

### 4.5 fix VPC Flow Logs deprecation warning (gap #20)

**problem:** `log_group_name is deprecated. Use log_destination instead` on every `pulumi up`.

**fix:**
- in the `TinoService` component, change the `FlowLog` resource to use `logDestination` instead of `logGroupName`

**acceptance:**
- [ ] `pulumi up` produces no deprecation warnings

### 4.6 documentation

**what's needed:**
- [ ] README updated with the two installation paths (standalone + npm install)
- [ ] `docs/deployment.md` — step-by-step deployment guide (what we just went through, but clean)
- [ ] `docs/console.md` — how to use the console (screenshots, capability setup)
- [ ] `docs/architecture.md` — how tino works (packages, persistence, tools, scheduler)
- [ ] `docs/security.md` — security model, compliance controls, what's enforced automatically
- [ ] `CONTRIBUTING.md` — how to develop locally, run tests, add a new tool
