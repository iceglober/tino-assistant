import { Hono } from 'hono';
import fs from 'node:fs';
import type { ConfigStore } from '../../persistence/config.js';
import type { AuditLogger } from '../../audit/logger.js';

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
 */
export function createComplianceRoutes(opts: {
  config: ConfigStore;
  auditLogger: AuditLogger | undefined;
}): Hono {
  const app = new Hono();
  const { config, auditLogger } = opts;

  app.get('/', async (c) => {
    // BAA status — read from tino.deploy.json if it exists
    let baaStatus: Record<string, string> = {
      aws: 'unknown',
      bedrock: 'unknown',
      github: 'unknown',
      slack: 'no-baa',
    };
    try {
      // Resolve relative to the compiled module location (dist/server/routes/compliance.js)
      // — tino.deploy.json sits at the repo root, four levels up.
      const deployJsonPath = new URL('../../../../../tino.deploy.json', import.meta.url);
      const deployJson = JSON.parse(fs.readFileSync(deployJsonPath, 'utf8')) as {
        baa?: Record<string, string>;
      };
      if (deployJson.baa) baaStatus = { ...baaStatus, ...deployJson.baa };
    } catch {
      /* file doesn't exist — use defaults */
    }

    const entryCount = auditLogger ? await auditLogger.count() : 0;
    const lastEntryAt = auditLogger ? await auditLogger.lastEntryAt() : undefined;

    const entries = await config.list();
    const userEntries = entries.filter((e) => e.key.startsWith('user.'));
    const adminEntries = entries.filter((e) => e.key.startsWith('admin.'));

    return c.json({
      hipaa: {
        encryption: {
          dynamodb: 'unknown',
          secretsManager: 'unknown',
          cloudwatchLogs: 'unknown',
        },
        auditLogging: {
          enabled: auditLogger !== undefined,
          entryCount,
          lastEntryAt: lastEntryAt ?? null,
          retentionDays: 90,
        },
        dataRetention: {
          ttlEnabled: true,
          historyRetentionDays: 30,
          auditRetentionDays: 90,
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
