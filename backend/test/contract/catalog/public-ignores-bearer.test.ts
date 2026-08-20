import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Feature 062 / T014 — thin "public ignores Bearer" regression test.
 *
 * The public catalog route files are untouched by construction (rev. 4);
 * this test pins the invariant: a bound or unbound `Bearer sk_live_*` on the
 * PUBLIC paths returns the public payload byte-identically — no org pricing
 * fields (`priceUnavailable` / `availability` / `priceTiers`) ever appear on
 * `/api/v1/catalog/…` (contracts/catalog-api-key-reads.md §0 + §6).
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('Public catalog endpoints ignore bearer credentials (062 / T014)', () => {
  let h: BackendServerHandle;
  let boundToken: string;
  let unboundToken: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Bind the key to the pl_retail channel so its pinned channel matches the
    // channel the anonymous baseline request names explicitly.
    const retail = await h.em().findOne(SalesChannel, { code: 'pl_retail' });
    expect(retail).not.toBeNull();

    const mint = async (payload: Record<string, unknown>): Promise<string> => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/api-keys',
        payload,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { data: { bearerToken: string } }).data.bearerToken;
    };
    boundToken = await mint({
      name: 'Bound key on public paths',
      scopes: ['catalog:read'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: retail!.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    unboundToken = await mint({ name: 'Unbound key on public paths', scopes: ['catalog:read'] });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const publicUrls = [
    '/api/v1/catalog/products',
    '/api/v1/catalog/products/example-simple-product',
  ];

  it('bound Bearer on public GETs returns the anonymous payload byte-identically', async () => {
    for (const url of publicUrls) {
      const anonymous = await h.app.inject({
        method: 'GET',
        url,
        headers: { 'x-sales-channel': 'pl_retail' },
      });
      expect(anonymous.statusCode).toBe(200);

      const withBearer = await h.app.inject({
        method: 'GET',
        url,
        headers: {
          'x-sales-channel': 'pl_retail',
          authorization: `Bearer ${boundToken}`,
        },
      });
      expect(withBearer.statusCode).toBe(200);
      expect(withBearer.body).toBe(anonymous.body);
      // No external-only decoration fields ever appear on the public surface.
      // (The word "availability" occurs legitimately inside the public
      // JSON-LD offer markup, so the org-field probes are the named keys.)
      expect(withBearer.body).not.toContain('priceUnavailable');
      expect(withBearer.body).not.toContain('"availability":{');
      expect(withBearer.body).not.toContain('priceTiers');
    }
  });

  it('unbound Bearer on public GETs returns the anonymous payload byte-identically', async () => {
    for (const url of publicUrls) {
      const anonymous = await h.app.inject({
        method: 'GET',
        url,
        headers: { 'x-sales-channel': 'pl_retail' },
      });
      expect(anonymous.statusCode).toBe(200);

      const withBearer = await h.app.inject({
        method: 'GET',
        url,
        headers: {
          'x-sales-channel': 'pl_retail',
          authorization: `Bearer ${unboundToken}`,
        },
      });
      expect(withBearer.statusCode).toBe(200);
      expect(withBearer.body).toBe(anonymous.body);
    }
  });
});
