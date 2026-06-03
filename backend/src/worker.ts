// Background worker entry point (Constitution Principle X).
//
// Runs the platform's queue consumers as their own process, independently
// scalable from the API. It reuses the exact same composition + module wiring
// as the HTTP server (`src/index.ts`) so consumers need no separate service
// graph — it simply never calls `app.listen()`.
//
// Deployment:
//   - Default single-VPS: run only `pnpm --filter backend run start` (the API
//     process co-locates the workers; BACKEND_ROLE defaults to 'all').
//   - Split out under load: run the API with BACKEND_ROLE=api (HTTP only) and
//     run this process (`pnpm --filter backend run worker`) for the consumers.
//     Scale by starting N worker processes — BullMQ's atomic job claim keeps
//     them from double-processing.

import { buildServer } from './http/server.js';
import { composeApp } from './composition.js';

async function main(): Promise<void> {
  // Force the worker role so composition starts the queue consumers even if
  // BACKEND_ROLE was left unset for this process.
  if (!process.env['BACKEND_ROLE'] || process.env['BACKEND_ROLE'] === 'api') {
    process.env['BACKEND_ROLE'] = 'worker';
  }

  const sessionCookieSecret =
    process.env['SESSION_COOKIE_SECRET'] ??
    (process.env['NODE_ENV'] === 'production' ? '' : 'dev-secret-change-me');
  if (!sessionCookieSecret) {
    console.error('SESSION_COOKIE_SECRET must be set in production');
    process.exit(1);
  }

  const composition = await composeApp();

  // Build the server purely to register module plugins (this is what wires the
  // queue consumers). We never listen — this process serves no HTTP.
  const app = await buildServer({
    sessionCookieSecret,
    // Required by buildServer but unused — this process never serves HTTP.
    openApi: { title: 'B2B Platform Worker', version: '0.0.0', serverUrl: 'http://localhost' },
    modules: composition.modules,
    errorEnvelope: composition.errorEnvelope,
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down worker');
    try {
      await app.close();
      await composition.dispose();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  app.log.info('backend worker started — consuming queues');
}

void main();
