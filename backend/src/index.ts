// Backend entry point.
//
// Composes every business module via `composeApp()` (see composition.ts) on
// top of the bare HTTP server from http/server.ts. The dev script
// (`pnpm --filter backend run dev`) and production both go through this.

import { buildServer } from './http/server.js';
import { composeApp } from './composition.js';

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3001);
  const sessionCookieSecret =
    process.env['SESSION_COOKIE_SECRET'] ?? (process.env['NODE_ENV'] === 'production' ? '' : 'dev-secret-change-me');

  if (!sessionCookieSecret) {
    console.error('SESSION_COOKIE_SECRET must be set in production');
    process.exit(1);
  }

  const composition = await composeApp();

  const app = await buildServer({
    sessionCookieSecret,
    openApi: {
      title: 'B2B Platform API',
      version: '0.0.0',
      serverUrl: `http://localhost:${port}`,
    },
    modules: composition.modules,
    errorEnvelope: composition.errorEnvelope,
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down backend');
    try {
      await app.close();
      await composition.dispose();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info({ port }, 'backend listening');
  } catch (err) {
    app.log.error({ err }, 'failed to start backend');
    await composition.dispose();
    process.exit(1);
  }
}

void main();
