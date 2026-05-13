import http from 'node:http';
import type { ConfigStore } from '../persistence/config.js';
import type { AppLogger } from '../slack/app.js';
import { getConsoleHtml } from './html.js';

/**
 * Minimal HTTP server for the tino config console.
 *
 * Routes:
 *   GET  /              → HTML config editor page
 *   GET  /api/config    → JSON list of all config entries
 *   PUT  /api/config/:key → set a config value (body: { "value": <any JSON> })
 *   DELETE /api/config/:key → delete a config entry
 *   GET  /api/health    → { ok: true, tools: [...], uptime: <seconds> }
 *
 * Binds to 127.0.0.1 only — not accessible from outside localhost.
 */
export function startConsole(
  config: ConfigStore,
  logger: AppLogger,
  tools: Record<string, unknown>,
  port = 3001,
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
      const body = JSON.stringify({
        ok: true,
        tools: Object.keys(tools),
        uptime: (Date.now() - startTime) / 1000,
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
        void config.set(key, parsed.value).then(() => {
          logger.info({ key }, 'config updated via console');
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
      void config.delete(key).then(deleted => {
        if (deleted) {
          logger.info({ key }, 'config entry deleted via console');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted }));
      });
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
