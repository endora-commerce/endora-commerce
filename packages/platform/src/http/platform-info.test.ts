import type { FastifyInstance } from 'fastify';
import { PlatformInfoSchema } from '@endora-commerce/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../composition/index.js';
import type { RequireAdminFactory } from '../kernel/ports/require-admin.js';
import { registerPlatformInfoRoutes } from './platform-info.js';
import { PLATFORM_VERSION } from './platform-version.js';

/**
 * `GET /api/v1/admin/platform-info` — the read behind the admin header's
 * version badge.
 *
 * It is a separate route from the liveness probe on purpose. The probe pings
 * three dependencies on every call and answers 503 while one of them is down,
 * which is the right behaviour for an orchestrator and the wrong one for a
 * header that renders on every admin screen; and the probe is public, so a
 * badge reading it would stop working the day its `version` is taken off the
 * unauthenticated payload.
 */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const admits: RequireAdminFactory = () => async () => {};

async function serve(
  requireAdmin: RequireAdminFactory,
  version?: string | null,
): Promise<FastifyInstance> {
  app = await buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: { title: 'platform info test', version: 'test', serverUrl: 'http://localhost' },
    disableRateLimit: true,
    modules: [
      (instance): void => {
        registerPlatformInfoRoutes(
          instance,
          version === undefined ? { requireAdmin } : { requireAdmin, version },
        );
      },
    ],
  });
  await app.ready();
  return app;
}

describe('GET /api/v1/admin/platform-info', () => {
  it('answers with the release of the platform package that serves it', async () => {
    const served = await serve(admits);

    const res = await served.inject({ method: 'GET', url: '/api/v1/admin/platform-info' });

    expect(res.statusCode).toBe(200);
    expect(PlatformInfoSchema.parse(res.json())).toEqual({ version: PLATFORM_VERSION });
    expect(PLATFORM_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('answers null — not a placeholder — when the release is unknown', async () => {
    const served = await serve(admits, null);

    const res = await served.inject({ method: 'GET', url: '/api/v1/admin/platform-info' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: null });
  });

  /**
   * Any signed-in admin, no permission code: the header is on every screen, so
   * a restricted code would hide the badge from most of the people who are
   * asked "which version are you on?". The guard is still the guard — an
   * anonymous caller gets its refusal and no number.
   */
  it('is behind the admin guard, with no permission code', async () => {
    const asked: Array<string | undefined> = [];
    const refuses: RequireAdminFactory = (permission) => {
      asked.push(permission);
      return async (_req, reply) => {
        await reply.status(401).send({ error: { code: 'UNAUTHENTICATED' } });
      };
    };
    const served = await serve(refuses);

    const res = await served.inject({ method: 'GET', url: '/api/v1/admin/platform-info' });

    expect(asked).toEqual([undefined]);
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain(PLATFORM_VERSION ?? 'no version');
  });
});
