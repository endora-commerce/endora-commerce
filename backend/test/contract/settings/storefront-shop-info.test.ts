import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShopInfoResponseSchema } from '@b2b/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature: public shop-info storefront read (404 "need help?" block, footer).
 *
 * GET /api/v1/storefront/shop-info resolves the `shop.*` settings for the
 * request's sales channel. The endpoint must always answer with the full
 * ShopInfo shape (every field a string) and must never 500 when a setting is
 * unset / not registered in the active scope.
 */
describe('Settings — GET /api/v1/storefront/shop-info', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the full shop-info shape with string fields', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/shop-info',
    });
    expect(res.statusCode).toBe(200);
    const parsed = ShopInfoResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
  });

  it('is a public route (no admin session required) and returns string fields', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/shop-info',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Record<'name' | 'address' | 'contactEmail' | 'supportEmail' | 'phone', unknown>;
    };
    for (const field of ['name', 'address', 'contactEmail', 'supportEmail', 'phone'] as const) {
      expect(typeof body.data[field], field).toBe('string');
    }
  });
});
