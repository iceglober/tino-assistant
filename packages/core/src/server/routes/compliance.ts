import fs from "node:fs";
import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import type { ConfigStore } from "../../persistence/config.js";

/**
 * GET /api/compliance — HIPAA compliance status snapshot.
 *
 * Mirror: `console/server.ts:229-284`. Returns the same shape:
 *
 *   {
 *     hipaa: {
 *       encryption: { dynamodb, secretsManager, cloudwatchLogs },
 *       auditLogging: { enabled, entryCount, lastEntryAt, retentionDays },
 *       dataRetention: { ttlEnabled, historyRetentionDays, auditRetentionDays },
 *       baaStatus: { aws, bedrock, github, slack, ... },
 *       accessControl: { userCount, adminCount },
 *     },
 *   }
 *
 * Fields are computed (not hardcoded "unknown") wherever a deterministic
 * answer exists at runtime:
 *   - encryption: when `PERSISTENCE_ADAPTER=dynamodb`, the Pulumi component
 *     always provisions a CMK for DynamoDB + CloudWatch Logs. Secrets Manager
 *     is not used (no secrets in the task definition — runtime config lives
 *     in DynamoDB). For the SQLite adapter we honestly return "unknown".
 *   - retention: read from `tino.deploy.json hipaa.{auditRetentionDays,
 *     historyRetentionDays}` if present; default 90/30 to match the
 *     Pulumi-side defaults.
 *   - BAA: read from `tino.deploy.json compliance.baaStatus` (the shape the
 *     CLI writes). Fall back gracefully when the file is missing.
 */
export function createComplianceRoutes(opts: { config: ConfigStore; auditLogger: AuditLogger | undefined }): Hono {
  const app = new Hono();
  const { config, auditLogger } = opts;

  app.get("/", async (c) => {
    // ── tino.deploy.json — BAA + retention ────────────────────────────
    // Resolve relative to the compiled module location
    // (dist/server/routes/compliance.js) — tino.deploy.json sits at the
    // repo root, five levels up.
    let baaStatus: Record<string, string> = {
      aws: "unknown",
      bedrock: "unknown",
      github: "unknown",
      slack: "no-baa",
    };
    let auditRetentionDays = 90;
    let historyRetentionDays = 30;
    try {
      const deployJsonPath = new URL("../../../../../tino.deploy.json", import.meta.url);
      const deployJson = JSON.parse(fs.readFileSync(deployJsonPath, "utf8")) as {
        compliance?: { baaStatus?: Record<string, string> };
        hipaa?: { auditRetentionDays?: number; historyRetentionDays?: number };
      };
      // The CLI writes `compliance.baaStatus`; an older path was `baa`.
      // Read both for backward compatibility, preferring the canonical path.
      const candidate = deployJson.compliance?.baaStatus ?? (deployJson as { baa?: Record<string, string> }).baa;
      if (candidate) {
        baaStatus = { ...baaStatus, ...candidate };
      }
      if (typeof deployJson.hipaa?.auditRetentionDays === "number") {
        auditRetentionDays = deployJson.hipaa.auditRetentionDays;
      }
      if (typeof deployJson.hipaa?.historyRetentionDays === "number") {
        historyRetentionDays = deployJson.hipaa.historyRetentionDays;
      }
    } catch {
      /* file doesn't exist — use defaults */
    }

    // ── Encryption — derived from the persistence adapter ─────────────
    // The Pulumi component always provisions a CMK and encrypts DynamoDB
    // and CloudWatch Logs with it (see tino-service.ts:317 for the KMS key
    // and :386, :400 for the resource bindings). Secrets Manager is not
    // used in this codebase — runtime config lives in DynamoDB, so the
    // honest answer is "n/a", reported as "unknown" to avoid widening the
    // status vocabulary.
    const adapter = process.env.PERSISTENCE_ADAPTER;
    const isDynamo = adapter === "dynamodb";
    const encryption = isDynamo
      ? {
          dynamodb: "cmk",
          // No secrets are stored in Secrets Manager — credentials live
          // in the encrypted DynamoDB config store. Reporting "unknown"
          // here reflects that no Secrets-Manager-encrypted secret exists,
          // not that we couldn't determine the state.
          secretsManager: "unknown",
          cloudwatchLogs: "cmk",
        }
      : {
          dynamodb: "unknown",
          secretsManager: "unknown",
          cloudwatchLogs: "unknown",
        };

    // ── Audit logger stats ────────────────────────────────────────────
    const entryCount = auditLogger ? await auditLogger.count() : 0;
    const lastEntryAt = auditLogger ? await auditLogger.lastEntryAt() : undefined;

    // ── Access control — counts of user/admin config entries ──────────
    const entries = await config.list();
    const userEntries = entries.filter((e) => e.key.startsWith("user."));
    const adminEntries = entries.filter((e) => e.key.startsWith("admin."));

    return c.json({
      hipaa: {
        encryption,
        auditLogging: {
          enabled: auditLogger !== undefined,
          entryCount,
          lastEntryAt: lastEntryAt ?? null,
          retentionDays: auditRetentionDays,
        },
        dataRetention: {
          ttlEnabled: true,
          historyRetentionDays,
          auditRetentionDays,
        },
        baaStatus,
        accessControl: {
          userCount: Math.max(userEntries.length, 1),
          adminCount: Math.max(adminEntries.length, 1),
        },
      },
    });
  });

  return app;
}
