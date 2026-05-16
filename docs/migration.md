# migration

How to move existing tino deployments through breaking changes.

## v2.0 → v2.1: the `tino-tino` rename

In v2.0 the Pulumi component generated resource names like `tino-tino` (DynamoDB table, ECR repo, ECS cluster, log group, KMS alias) because the component was instantiated with `name: "tino"` and the source code embedded a hardcoded `tino-` prefix. v2.1 drops the hardcoded prefix — new deployments get `tino` instead of `tino-tino`.

If you're on v2.0, you have two options.

### option A — keep the old names (zero-downtime)

Pin `resourcePrefix` to the old value. No resources change.

In your `infra-tino/index.ts`:

```ts
const tino = new TinoService("tino", {
  // …existing args…
  resourcePrefix: "tino-tino",   // ← keep legacy names
});
```

`pulumi up` should report no changes to stateful resources. Audit log retention, encryption, and everything else continue as-is.

### option B — rename to clean names (data migration required)

DynamoDB tables cannot be renamed in place. Renaming = replacing = data loss for the audit trail and runtime config. To rename safely:

1. **Export the table.**

   ```sh
   aws dynamodb create-backup \
     --table-name tino-tino \
     --backup-name tino-pre-rename-$(date +%Y%m%d)
   ```

   Or use point-in-time recovery to a continuous export — the table has PITR enabled (`tino-service.ts:384`).

2. **Stop the ECS service** so no new writes land while you migrate:

   ```sh
   aws ecs update-service \
     --cluster tino-tino \
     --service tino-tino \
     --desired-count 0
   ```

3. **Restore into the new table.** The component will create `tino` (the new default name) on the next `pulumi up`. Restore the backup into the new table:

   ```sh
   aws dynamodb restore-table-from-backup \
     --target-table-name tino \
     --backup-arn <backup-arn-from-step-1>
   ```

   This creates a *new* table, separate from what Pulumi will manage. You'll need to import it, or restore into a parallel name and use AWS Data Pipeline / a custom script to copy items into the Pulumi-managed `tino` table. Either way: validate item counts before continuing.

4. **Run `pulumi up` without `resourcePrefix`.** The component creates `tino`, `/ecs/tino`, `alias/tino`, the new ECR repo, the new ECS cluster.

5. **Push your container image to the new ECR repo.** The docker-build provider does this as part of `pulumi up`.

6. **Cut over.** The new ECS service starts with the new task. Verify the console loads and the compliance dashboard shows the expected entry count.

7. **Delete the old resources.** Once you've verified, disable deletion protection on `tino-tino` and run `pulumi destroy` against the old stack (or remove the resources individually if they're in the same stack).

Audit-trail continuity: if you need queryable history across the rename, keep the old table read-only for the audit retention window (90 days by default), then delete.

## SQLite → DynamoDB

If you started in local dev and want to promote to AWS:

1. Run `tino init` to generate the Pulumi project.
2. Run `pulumi up` to provision the table.
3. **Export local config from SQLite.** The config keys you set via the local console (`http://localhost:3001`) are in `./tino.db`:

   ```sh
   sqlite3 tino.db "SELECT key, value FROM config;"
   ```

4. **Import into the deployed instance.** Open the deployed console (the URL Pulumi printed), sign in, and re-enter the credentials in the capability cards. There's no bulk import yet — capability creds are sensitive enough that re-entry is the cleanest path. Slack and Google OAuth credentials are tied to specific apps/clients you'll likely need to recreate anyway (the redirect URI changes — see `docs/deployment.md`).

5. **Audit log.** SQLite mode uses the in-memory audit logger; entries don't survive the move. The first DynamoDB-backed entries will start fresh.

## v0.x → v0.1 (history)

Pre-v0.1 there was no plan to migrate anything. If you have a deployment from before v2.0, the cleanest path is a fresh deploy with `tino init`.
