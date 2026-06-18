import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 045 (T033) — Rule Builder picker endpoints return option lists,
 * gated by promotions:read.
 */
describe('Promotion rule-target pickers (feature 045)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const restricted = { b2b_session: 'stub-restricted-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const kinds = [
    'sales-channels',
    'customer-groups',
    'organizations',
    'categories',
    'payment-methods',
    'delivery-methods',
  ];

  it('returns an items array for every picker', async () => {
    for (const kind of kinds) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/promotions/rule-targets/${kind}`,
        cookies: adminCookie,
      });
      expect(res.statusCode, kind).toBe(200);
      const body = res.json() as { data: { items: unknown[] } };
      expect(Array.isArray(body.data.items), kind).toBe(true);
    }
  });

  it('gates the pickers behind promotions:read', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/promotions/rule-targets/categories',
      cookies: restricted,
    });
    expect(res.statusCode).toBe(403);
  });
});
