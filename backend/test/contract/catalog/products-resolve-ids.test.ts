import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 033 — POST /api/v1/admin/catalog/products/resolve-ids
 */

describe('POST /api/v1/admin/catalog/products/resolve-ids', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns { data: { productIds, total } } matching admin list filters', async () => {
    const listRes = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products?status=active&pageSize=500',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as {
      data: Array<{ id: string }>;
      pagination: { total: number };
    };

    const resolveRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/resolve-ids',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { status: 'active', includeArchived: true },
    });
    expect(resolveRes.statusCode).toBe(200);
    const resolveBody = resolveRes.json() as {
      data: { productIds: string[]; total: number };
    };
    expect(resolveBody.data.total).toBe(resolveBody.data.productIds.length);
    expect(resolveBody.data.total).toBe(listBody.pagination.total);
    const listIds = new Set(listBody.data.map((p) => p.id));
    for (const id of resolveBody.data.productIds) {
      expect(listIds.has(id)).toBe(true);
    }
  });

  it('returns 400 SELECTION_TOO_LARGE when matches exceed cap', async () => {
    const prev = process.env['CATALOG_MAX_RESOLVE_IDS'];
    process.env['CATALOG_MAX_RESOLVE_IDS'] = '1';
    try {
      const listRes = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/catalog/products?pageSize=1',
        cookies: { b2b_session: 'stub-admin-session' },
      });
      const listBody = listRes.json() as { pagination: { total: number } };
      if (listBody.pagination.total < 2) {
        return;
      }

      const resolveRes = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products/resolve-ids',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { includeArchived: true },
      });
      expect(resolveRes.statusCode).toBe(400);
      const body = resolveRes.json() as { error: { code: string; details?: { total: number } } };
      expect(body.error.code).toBe(ERROR_CODES.SELECTION_TOO_LARGE);
      expect(body.error.details?.total).toBeGreaterThan(1);
    } finally {
      if (prev === undefined) delete process.env['CATALOG_MAX_RESOLVE_IDS'];
      else process.env['CATALOG_MAX_RESOLVE_IDS'] = prev;
    }
  });
});
