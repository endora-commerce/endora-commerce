import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `defaultLowStockThreshold` round-trip on the warehouse admin endpoints:
 *  - POST     /api/v1/admin/warehouses             accepts the field on create
 *  - GET      /api/v1/admin/warehouses/:id         surfaces it on read
 *  - PATCH    /api/v1/admin/warehouses/:id         updates it (incl. clear-to-null)
 */
describe('Admin warehouses — defaultLowStockThreshold', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('round-trips the threshold through create / read / update', async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/warehouses',
      payload: {
        name: 'Low-stock probe',
        code: `ls_probe_${suffix}`,
        active: true,
        defaultLowStockThreshold: 7,
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as {
      data: { id: string; defaultLowStockThreshold: number | null };
    };
    expect(createdBody.data.defaultLowStockThreshold).toBe(7);
    const id = createdBody.data.id;

    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/warehouses/${id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(read.statusCode).toBe(200);
    const readBody = read.json() as {
      data: { defaultLowStockThreshold: number | null };
    };
    expect(readBody.data.defaultLowStockThreshold).toBe(7);

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/warehouses/${id}`,
      payload: { defaultLowStockThreshold: null },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(patched.statusCode).toBe(200);
    const patchedBody = patched.json() as {
      data: { defaultLowStockThreshold: number | null };
    };
    expect(patchedBody.data.defaultLowStockThreshold).toBeNull();
  });
});
