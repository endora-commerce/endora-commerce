// Backend entry point.
//
// Composes every business module via `composeApp()` (see composition.ts) on
// top of the bare HTTP server from http/server.ts. The dev script
// (`pnpm --filter backend run dev`) and production both go through this.

import { buildServer } from './http/server.js';
import { parseTrustedProxy, type TrustedProxy } from './http/trusted-proxy.js';
import { composeApp } from './composition.js';

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3001);
  const sessionCookieSecret =
    process.env['SESSION_COOKIE_SECRET'] ?? (process.env['NODE_ENV'] === 'production' ? '' : 'dev-secret-change-me');

  if (!sessionCookieSecret) {
    console.error('SESSION_COOKIE_SECRET must be set in production');
    process.exit(1);
  }

  // Issue #220 — behind a reverse proxy, `request.ip` is the proxy unless this
  // deployment says which hop it trusts. Parsed here rather than in
  // http/server.ts because that is a platform root and takes its configuration
  // by injection (D-52/D-53). Refused early and loudly: a value we cannot make
  // sense of means the operator believes client IPs are being resolved when
  // they are not.
  let trustedProxy: TrustedProxy | undefined;
  try {
    trustedProxy = parseTrustedProxy({
      hops: process.env['TRUSTED_PROXY_HOPS'],
      addresses: process.env['TRUSTED_PROXY_ADDRESSES'],
    });
  } catch (err) {
    console.error(`[boot] ${(err as Error).message}`);
    process.exit(1);
  }

  // composeApp() wires every module and instantiates services eagerly (cipher
  // keys, registries, queue consumers). A misconfiguration (bad secret, missing
  // env) throws here — outside the listen try/catch below — which would surface
  // as an unhandled rejection with no context. Catch it and fail loud + clean.
  let composition: Awaited<ReturnType<typeof composeApp>>;
  try {
    composition = await composeApp();
  } catch (err) {
    console.error(
      '[boot] composeApp() failed — the backend cannot start. ' +
        'This is almost always a configuration problem (a required secret/env var ' +
        'missing or malformed). Original error follows:',
    );
    console.error(err);
    process.exit(1);
  }

  // Rate-limit knobs:
  //   BACKEND_RATE_LIMIT_DISABLED=true → bypass the limiter entirely
  //   BACKEND_RATE_LIMIT_MAX=<int>     → override the per-IP req/min ceiling
  // Default ceiling is 1000/min (set in buildServer); local SSR dev can
  // easily fire 10+ calls per page render across layout hooks, cart, /me,
  // upsells, etc. — a tighter limit makes every navigation flaky.
  const disableRateLimit =
    process.env['BACKEND_RATE_LIMIT_DISABLED'] === 'true' ||
    process.env['BACKEND_RATE_LIMIT_DISABLED'] === '1';
  const rateLimitMaxEnv = process.env['BACKEND_RATE_LIMIT_MAX'];
  const rateLimitMax = rateLimitMaxEnv ? Number(rateLimitMaxEnv) : undefined;

  let app: Awaited<ReturnType<typeof buildServer>>;
  try {
    app = await buildServer({
      sessionCookieSecret,
      openApi: {
        title: 'B2B Platform API',
        version: '0.0.0',
        serverUrl: `http://localhost:${port}`,
      },
      modules: composition.modules,
      errorEnvelope: composition.errorEnvelope,
      apiInterceptors: composition.apiInterceptors,
      ...(trustedProxy === undefined ? {} : { trustedProxy }),
      ...(disableRateLimit ? { disableRateLimit: true } : {}),
      ...(rateLimitMax && Number.isFinite(rateLimitMax) ? { rateLimitMax } : {}),
    });
  } catch (err) {
    console.error('[boot] buildServer() failed — backend cannot start. Original error follows:');
    console.error(err);
    await composition.dispose();
    process.exit(1);
  }

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
