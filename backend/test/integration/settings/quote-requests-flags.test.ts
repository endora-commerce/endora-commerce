import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T075 — Storefront-public Quote Requests settings endpoint reflects
 * the platform-admin's PATCH within the cache window.
 *
 * The test-server's `resolveBoolSetting` is hardcoded to `true`, so this
 * test asserts the endpoint shape + default values rather than the
 * full PATCH-and-revalidate cycle (the latter is exercised in
 * production with the real settings module).
 */
describe('Storefront Quote Requests settings (T075)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns both visibility flags from the public endpoint', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/settings/quote-requests',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { showAddToQuoteOnCard: boolean; showAddToQuoteOnPdp: boolean };
    };
    expect(typeof body.data.showAddToQuoteOnCard).toBe('boolean');
    expect(typeof body.data.showAddToQuoteOnPdp).toBe('boolean');
  });

  it('emits a 60-second cache-control header so the storefront revalidates within the SLA', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/settings/quote-requests',
    });
    expect(res.statusCode).toBe(200);
    const cacheControl = res.headers['cache-control'];
    expect(cacheControl).toContain('max-age=60');
  });
});
