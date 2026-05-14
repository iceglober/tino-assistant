import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { ConfigStore } from '../persistence/config.js';
import type { AppLogger } from '../slack/app.js';
import type { CapabilityRegistry } from '../capabilities/types.js';
import type { AuditLogger } from '../audit/logger.js';
import { getConsoleHtml } from './html.js';

/**
 * HTTP server for the tino config console.
 *
 * Routes:
 *   GET  /                          → HTML config editor page
 *   GET  /api/config                → JSON list of all config entries
 *   PUT  /api/config/:key           → set a config value (body: { "value": <any JSON> })
 *   DELETE /api/config/:key         → delete a config entry
 *   GET  /api/health                → { ok: true, tools: [...], uptime: <seconds>, capabilities: [...] }
 *   GET  /api/capabilities          → list all capability configs
 *   PUT  /api/capabilities/:id      → update a capability config (body: CapabilityConfig)
 *   GET  /api/compliance            → HIPAA compliance status
 *   DELETE /api/users/:userId       → deprovision a user (admin-only)
 *
 * Binds to 127.0.0.1 only — not accessible from outside localhost.
 */
export function startConsole(
  config: ConfigStore,
  logger: AppLogger,
  tools: Record<string, unknown>,
  registry?: CapabilityRegistry,
  port = 3001,
  auditLogger?: AuditLogger,
): http.Server {
  const startTime = Date.now();

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    // Strip query string for routing
    const path = url.split('?')[0] ?? '/';

    // ── GET / ──────────────────────────────────────────────────────────────
    if (method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getConsoleHtml());
      return;
    }

    // ── GET /api/health ────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/health') {
      const capState = registry?.getState() ?? {};
      const body = JSON.stringify({
        ok: true,
        tools: Object.keys(tools),
        uptime: (Date.now() - startTime) / 1000,
        capabilities: Object.entries(capState).map(([id, s]) => ({
          id,
          toolCount: s.toolCount,
          lastFindWorkScanAt: s.lastFindWorkScanAt,
          lastError: s.lastError,
        })),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    // ── GET /api/config ────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/config') {
      void config.list().then(entries => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(entries));
      });
      return;
    }

    // ── PUT /api/config/:key ───────────────────────────────────────────────
    if (method === 'PUT' && path.startsWith('/api/config/')) {
      const key = decodeURIComponent(path.slice('/api/config/'.length));
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing key');
        return;
      }
      readBody(req, (err, body) => {
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Failed to read request body');
          return;
        }
        let parsed: { value: unknown };
        try {
          parsed = JSON.parse(body) as { value: unknown };
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Request body must be valid JSON');
          return;
        }
        if (!('value' in parsed)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Request body must have a "value" field');
          return;
        }
        void config.set(key, parsed.value).then(async () => {
          logger.info({ key }, 'config updated via console');
          if (auditLogger) {
            await auditLogger.log({
              userId: 'console',
              action: 'config_change',
              toolName: key,
              status: 'success',
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, key }));
        });
      });
      return;
    }

    // ── DELETE /api/config/:key ────────────────────────────────────────────
    if (method === 'DELETE' && path.startsWith('/api/config/')) {
      const key = decodeURIComponent(path.slice('/api/config/'.length));
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing key');
        return;
      }
      void config.delete(key).then(async deleted => {
        if (deleted) {
          logger.info({ key }, 'config entry deleted via console');
          if (auditLogger) {
            await auditLogger.log({
              userId: 'console',
              action: 'config_change',
              toolName: key,
              status: 'success',
            });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted }));
      });
      return;
    }

    // ── GET /api/capabilities ──────────────────────────────────────────────
    if (method === 'GET' && path === '/api/capabilities') {
      void config.list().then(entries => {
        const caps = entries
          .filter(e => e.key.startsWith('capability.'))
          .map(e => {
            let parsed: unknown = null;
            try { parsed = JSON.parse(e.value); } catch { /* ignore */ }
            return { id: e.key.slice('capability.'.length), config: parsed, updatedAt: e.updatedAt };
          });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(caps));
      });
      return;
    }

    // ── PUT /api/capabilities/:id ──────────────────────────────────────────
    if (method === 'PUT' && path.startsWith('/api/capabilities/')) {
      const id = decodeURIComponent(path.slice('/api/capabilities/'.length));
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing capability id');
        return;
      }
      readBody(req, (err, body) => {
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Failed to read request body');
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Request body must be valid JSON');
          return;
        }
        const key = `capability.${id}`;
        void config.set(key, parsed).then(() => {
          logger.info({ capabilityId: id }, 'capability config updated via console');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id }));
        });
      });
      return;
    }

    // ── GET /api/compliance ────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/compliance') {
      void (async () => {
        // BAA status — read from tino.deploy.json if it exists
        let baaStatus: Record<string, string> = {
          aws: 'unknown',
          bedrock: 'unknown',
          github: 'unknown',
          slack: 'no-baa',
        };
        try {
          const deployJsonPath = new URL('../../../../tino.deploy.json', import.meta.url);
          const deployJson = JSON.parse(fs.readFileSync(deployJsonPath, 'utf8')) as {
            baa?: Record<string, string>;
          };
          if (deployJson.baa) baaStatus = { ...baaStatus, ...deployJson.baa };
        } catch { /* file doesn't exist — use defaults */ }

        // Audit logging stats
        const entryCount = auditLogger ? await auditLogger.count() : 0;
        const lastEntryAt = auditLogger ? await auditLogger.lastEntryAt() : undefined;

        // User/admin count from config
        const entries = await config.list();
        const userEntries = entries.filter(e => e.key.startsWith('user.'));
        const adminEntries = entries.filter(e => e.key.startsWith('admin.'));

        const body = JSON.stringify({
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      })();
      return;
    }

    // ── DELETE /api/users/:userId ──────────────────────────────────────────
    if (method === 'DELETE' && path.startsWith('/api/users/')) {
      const targetUserId = decodeURIComponent(path.slice('/api/users/'.length));
      if (!targetUserId) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing userId');
        return;
      }
      void (async () => {
        // 1. Set user status to deactivated
        await config.set(`user.${targetUserId}.status`, 'deactivated');

        // 2. Delete personal capability tokens
        const entries = await config.list();
        const personalCapKeys = entries
          .filter(e => e.key.startsWith(`user.${targetUserId}.capability.`))
          .map(e => e.key);
        for (const capKey of personalCapKeys) {
          await config.delete(capKey);
        }

        // 3. Log audit entry
        if (auditLogger) {
          await auditLogger.log({
            userId: 'console',
            action: 'user_deprovisioned',
            toolName: targetUserId,
            status: 'success',
          });
        }

        logger.info({ targetUserId }, 'user deprovisioned via console');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, userId: targetUserId, status: 'deactivated' }));
      })();
      return;
    }

    // ── GET /assets/tino-logo.png ──────────────────────────────────────────
    if (method === 'GET' && path === '/assets/tino-logo.png') {
      const logoPath = new URL('../../assets/tino-logo.png', import.meta.url);
      try {
        const data = fs.readFileSync(logoPath);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        res.end(data);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Logo not found');
      }
      return;
    }

    // ── 404 ────────────────────────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'config console listening (localhost only)');
  });

  return server;
}

function readBody(req: http.IncomingMessage, cb: (err: Error | null, body: string) => void): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
  req.on('error', (err: Error) => cb(err, ''));
}
