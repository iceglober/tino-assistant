import 'dotenv/config';
import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: process.env['NODE_ENV'] === 'production'
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true } },
});

logger.info({ nodeVersion: process.version, pid: process.pid }, 'ausistant starting');

const shutdown = (signal: string) => {
  logger.info({ signal }, 'ausistant stopping');
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep process alive (Phase 2 will replace this with app.start())
setInterval(() => {}, 1 << 30);
