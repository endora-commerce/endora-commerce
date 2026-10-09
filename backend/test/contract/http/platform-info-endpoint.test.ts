import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformInfoSchema } from '@endora-commerce/contracts';
import { healthResponseSchema } from '@endora-commerce/platform/composition';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Contract — `GET /api/v1/admin/platform-info` against a composed deployment,
 * and the one property its unit test cannot show: that the number a real
 * composition answers with is the **installed platform package's** version,
 * read through the same resolution the application itself uses.
 *
 * The expectation is derived from the package's manifest rather than written
 * down, so it does not need touching at a release. It is deliberately not the
 * backend's own `package.json` version — that one is `0.0.0`, which is the
 * number this endpoint exists not to report.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

function installedPlatformVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = JSON.parse(
    readFileSync(require.resolve('@endora-commerce/platform/package.json'), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

describe('GET /api/v1/admin/platform-info', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses an anonymous caller and gives it no number', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/platform-info' });

    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain(installedPlatformVersion());
  });

  it('answers a signed-in admin with the installed platform release', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/platform-info',
      cookies: ADMIN,
    });

    expect(res.statusCode).toBe(200);
    const body = PlatformInfoSchema.parse(res.json());
    expect(body.version).toBe(installedPlatformVersion());
    expect(body.version).not.toBe('0.0.0');
  });

  /** One source for both readers: the badge and the probe cannot disagree. */
  it('agrees with the liveness probe’s `version`', async () => {
    const info = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/platform-info',
      cookies: ADMIN,
    });
    const health = await h.app.inject({ method: 'GET', url: '/api/v1/_health' });

    expect(healthResponseSchema.parse(health.json()).version).toBe(
      PlatformInfoSchema.parse(info.json()).version,
    );
  });
});
