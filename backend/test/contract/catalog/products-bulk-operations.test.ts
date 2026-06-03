import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Queued product bulk-edit — the async delegation surface.
 *
 * Selections above the synchronous threshold are persisted as a
 * background bulk operation (202 + queued ack) and surfaced through the
 * bulk-operations list / detail endpoints. The test harness keeps the
 * sweeper off, so a freshly-queued operation stays `pending` — which is
 * exactly what we assert here.
 */
describe('Queued product bulk-edit — bulk operations endpoints', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function manyUuids(n: number): string[] {
    return Array.from({ length: n }, (_, i) => {
      const tail = String(i + 1).padStart(12, '0');
      return `22222222-3333-4444-8555-${tail}`;
    });
  }

  it('queues a >50 selection and surfaces it in the bulk-operations list', async () => {
    const ids = manyUuids(51);
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: { productIds: ids, fields: { status: 'active' } },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(202);
    const created = create.json() as {
      data: { queued: boolean; bulkOperationId: string; total: number };
    };
    expect(created.data.queued).toBe(true);
    expect(created.data.total).toBe(51);
    const opId = created.data.bulkOperationId;

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/bulk-operations?limit=100',
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as {
      data: Array<{ id: string; status: string; total: number; touchedFields: string[] }>;
      pagination: { total: number };
    };
    const row = listBody.data.find((r) => r.id === opId);
    expect(row).toBeDefined();
    expect(row?.status).toBe('pending');
    expect(row?.total).toBe(51);
    expect(row?.touchedFields).toContain('status');
  });

  it('returns a single bulk operation by id', async () => {
    const ids = manyUuids(60);
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: { productIds: ids, fields: { visibility: 'public' } },
      cookies: adminCookie,
    });
    const opId = (create.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/bulk-operations/${opId}`,
      cookies: adminCookie,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as { data: { id: string; total: number } };
    expect(body.data.id).toBe(opId);
    expect(body.data.total).toBe(60);
  });

  it('404s for an unknown bulk operation id', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/bulk-operations/99999999-8888-4777-8666-555555555555',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it('filters the list by status', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/bulk-operations?status=pending&limit=100',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ status: string }> };
    expect(body.data.every((r) => r.status === 'pending')).toBe(true);
  });

  it('requires auth', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/bulk-operations',
    });
    expect(res.statusCode).toBe(401);
  });
});
