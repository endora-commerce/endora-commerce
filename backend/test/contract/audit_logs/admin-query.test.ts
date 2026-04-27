import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * T195 — `GET /api/v1/admin/audit-log` returns the append-only log with
 * filters by actor / action / objectType / objectId. The query is gated by
 * the `audit_log:read` permission.
 */

describe('GET /api/v1/admin/audit-log', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Trigger an audit row by mutating a product.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${SEED_PRODUCT_101_ID}`,
      payload: { attributeValues: { defaultPrice: 12.34 } },
      cookies: { b2b_session: 'stub-admin-session' },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the audit log filtered by action', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log?filter[action]=product.update',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ action: string; objectType: string; objectId: string }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach((entry) => expect(entry.action).toBe('product.update'));
    expect(body.data.some((e) => e.objectId === SEED_PRODUCT_101_ID)).toBe(true);
  });

  it('returns the audit log filtered by objectId', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${SEED_PRODUCT_101_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ objectId: string }> };
    body.data.forEach((entry) => expect(entry.objectId).toBe(SEED_PRODUCT_101_ID));
  });

  it('rejects callers without audit_log:read scope', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log',
      cookies: { b2b_session: 'stub-restricted-admin-session' },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
