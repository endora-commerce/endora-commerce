// Backend entry point.
//
// This is the production boot wiring. It composes every foundational module from
// Phase 2 of tasks.md (server, logger, error envelope, OpenAPI, ORM, event bus,
// webhook worker). Per-module HTTP routes plug into this server in Phases 3–9.

import { buildServer } from './http/server.js';

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3001);
  const sessionCookieSecret =
    process.env['SESSION_COOKIE_SECRET'] ?? (process.env['NODE_ENV'] === 'production' ? '' : 'dev-secret-change-me');

  if (!sessionCookieSecret) {
    console.error('SESSION_COOKIE_SECRET must be set in production');
    process.exit(1);
  }

  const app = await buildServer({
    sessionCookieSecret,
    openApi: {
      title: 'B2B Platform API',
      version: '0.0.0',
      serverUrl: `http://localhost:${port}`,
    },
  });

  try {
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info({ port }, 'backend listening');
  } catch (err) {
    app.log.error({ err }, 'failed to start backend');
    process.exit(1);
  }
}

void main();
