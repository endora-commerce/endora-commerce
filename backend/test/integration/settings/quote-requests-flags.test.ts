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
 * Asserts the endpoint's shape and cache header only. The flags themselves
 * come from `quote_requests`' own settings read; that this read reflects what
 * the operator configured — rather than answering `true` forever, which it did
 * while the module passed a channel *code* where a channel id belongs — is
 * pinned in `test/integration/quote_requests/settings-channel.test.ts`.
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
