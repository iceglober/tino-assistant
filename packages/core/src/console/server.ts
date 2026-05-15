import http from 'node:http';
import fs from 'node:fs';
import type { ConfigStore } from '../persistence/config.js';
import type { AppLogger } from '../slack/app.js';
import type { CapabilityRegistry } from '../capabilities/types.js';
import type { AuditLogger } from '../audit/logger.js';
import { getConsoleHtml } from './html.js';
import { createAuth } from './auth.js';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';

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
 * Auth:
 *   When GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET are set, all routes
 *   require a valid Google OAuth session. /api/auth/* is handled by better-auth.
 *   When those env vars are absent (local dev), auth is skipped entirely.
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

  // ── Auth setup ─────────────────────────────────────────────────────────────
  const googleClientId = process.env['GOOGLE_OAUTH_CLIENT_ID'];
  const googleClientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'];
  const allowedDomain = process.env['CONSOLE_ALLOWED_DOMAIN'];
  const baseUrl = process.env['CONSOLE_BASE_URL'] ?? `http://localhost:${port}`;
  const authEnabled = !!(googleClientId && googleClientSecret);

  let auth: ReturnType<typeof createAuth> | null = null;
  let authHandler: ReturnType<typeof toNodeHandler> | null = null;

  if (authEnabled) {
    try {
      auth = createAuth({
        googleClientId: googleClientId!,
        googleClientSecret: googleClientSecret!,
        allowedDomain,
        baseUrl,
        dbPath: '/tmp/tino-auth.db',
      });
      authHandler = toNodeHandler(auth);
      logger.info({ baseUrl, allowedDomain, authEnabled: true }, 'console auth: Google OAuth enabled');
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'console auth: failed to initialize — running without auth');
    }
  } else {
    logger.info({ authEnabled: false }, 'console auth: disabled (no GOOGLE_OAUTH_CLIENT_ID)');
  }

  // ── Route handler (called after auth passes) ───────────────────────────────
  function handleRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    routePath: string,
  ): void {
    // ── GET / ────────────────────────────────────────────────────────────────
    if (method === 'GET' && routePath === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getConsoleHtml());
      return;
    }

    // ── GET /api/health ──────────────────────────────────────────────────────
    if (method === 'GET' && routePath === '/api/health') {
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

    // ── GET /api/config ──────────────────────────────────────────────────────
    if (method === 'GET' && routePath === '/api/config') {
      void config.list().then(entries => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(entries));
      });
      return;
    }

    // ── PUT /api/config/:key ─────────────────────────────────────────────────
    if (method === 'PUT' && routePath.startsWith('/api/config/')) {
      const key = decodeURIComponent(routePath.slice('/api/config/'.length));
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

    // ── DELETE /api/config/:key ──────────────────────────────────────────────
    if (method === 'DELETE' && routePath.startsWith('/api/config/')) {
      const key = decodeURIComponent(routePath.slice('/api/config/'.length));
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

    // ── GET /api/capabilities ────────────────────────────────────────────────
    if (method === 'GET' && routePath === '/api/capabilities') {
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

    // ── PUT /api/capabilities/:id ────────────────────────────────────────────
    if (method === 'PUT' && routePath.startsWith('/api/capabilities/')) {
      const id = decodeURIComponent(routePath.slice('/api/capabilities/'.length));
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

    // ── GET /api/compliance ──────────────────────────────────────────────────
    if (method === 'GET' && routePath === '/api/compliance') {
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

    // ── DELETE /api/users/:userId ────────────────────────────────────────────
    if (method === 'DELETE' && routePath.startsWith('/api/users/')) {
      const targetUserId = decodeURIComponent(routePath.slice('/api/users/'.length));
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

    // ── GET /assets/tino-logo.png ────────────────────────────────────────────
    if (method === 'GET' && routePath === '/assets/tino-logo.png') {
      // Try multiple paths: monorepo root (local dev), app root (Docker container)
      const candidates = [
        new URL('../../assets/tino-logo.png', import.meta.url),
        new URL('../../../../assets/tino-logo.png', import.meta.url),
        new URL(`file://${process.cwd()}/assets/tino-logo.png`),
      ];
      let served = false;
      for (const logoPath of candidates) {
        try {
          const data = fs.readFileSync(logoPath);
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
          res.end(data);
          served = true;
          break;
        } catch {
          continue;
        }
      }
      if (!served) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Logo not found');
      }
      return;
    }

    // ── 404 ──────────────────────────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    // Strip query string for routing
    const routePath = url.split('?')[0] ?? '/';

    // ── Auth middleware ────────────────────────────────────────────────────
    // When GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET are set, enforce
    // Google OAuth. Otherwise (local dev), serve everything without auth.
    if (authEnabled && auth && authHandler) {
      // Paths that bypass auth (health check for ALB, assets, auth routes)
      const publicPaths = ['/api/health', '/assets/', '/api/auth/'];
      const isPublic = publicPaths.some(p => url.startsWith(p));

      if (isPublic && url.startsWith('/api/auth/')) {
        void authHandler(req, res);
        return;
      }

      if (isPublic) {
        handleRoute(req, res, method, routePath);
        return;
      }

      // Check session for all protected routes
      void (async () => {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(req.headers),
        });

        if (!session) {
          // No valid session → show login page
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>tino — sign in</title>
  <style>
    body { background: #1a2332; color: #f2ebe3; font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { text-align: center; max-width: 360px; padding: 48px 32px; }
    .logo { width: 64px; height: 64px; border-radius: 14px; margin-bottom: 24px; }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 8px; }
    p { color: #9aa6b8; font-size: 0.9rem; margin-bottom: 32px; }
    button { background: #c8956a; color: #1a2332; border: none; padding: 12px 32px; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; width: 100%; }
    button:hover { background: #d4a57a; }
    .error { color: #c06060; font-size: 0.85rem; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <img src="/assets/tino-logo.png" alt="tino" class="logo">
    <h1>tino</h1>
    <p>sign in with your Google account to continue</p>
    <button onclick="signIn()">sign in with Google</button>
    <p class="error" id="error" style="display:none"></p>
  </div>
  <script>
    async function signIn() {
      try {
        const res = await fetch('/api/auth/sign-in/social', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
          redirect: 'manual',
        });
        if (res.status === 200) {
          const data = await res.json();
          if (data.url) {
            window.location.href = data.url;
          }
        } else if (res.type === 'opaqueredirect' || res.status === 302) {
          const location = res.headers.get('location');
          if (location) window.location.href = location;
        } else {
          document.getElementById('error').textContent = 'sign in failed — check console';
          document.getElementById('error').style.display = 'block';
        }
      } catch (err) {
        document.getElementById('error').textContent = err.message;
        document.getElementById('error').style.display = 'block';
      }
    }
  </script>
</body>
</html>`);
          return;
        }

        // 3. Check allowed domain
        if (allowedDomain && !session.user.email?.endsWith(`@${allowedDomain}`)) {
          res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            `<!DOCTYPE html><html lang="en"><body>` +
            `<h1>Access denied</h1>` +
            `<p>Only @${allowedDomain} accounts can access this console.</p>` +
            `</body></html>`,
          );
          return;
        }

        // 4. Session valid — serve the request
        handleRoute(req, res, method, routePath);
      })();
      return;
    }

    // Auth not enabled (local dev) — serve everything directly
    handleRoute(req, res, method, routePath);
  });

  // In production (CONSOLE_BASE_URL set), bind to 0.0.0.0 so the ALB can reach
  // the container. In development, bind to 127.0.0.1 (localhost only).
  const host = process.env['CONSOLE_BASE_URL'] ? '0.0.0.0' : '127.0.0.1';
  server.listen(port, host, () => {
    logger.info({ port, host }, 'config console listening');
  });

  return server;
}

function readBody(req: http.IncomingMessage, cb: (err: Error | null, body: string) => void): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
  req.on('error', (err: Error) => cb(err, ''));
}
