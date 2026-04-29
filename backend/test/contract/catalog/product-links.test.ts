import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T098 — Contract test for Product Links admin surface (feature 002 US4).
 *
 * Endpoints:
 *   GET    /api/v1/admin/catalog/products/:id/links?kind=...
 *   POST   /api/v1/admin/catalog/products/:id/links     (bulk)
 *   DELETE /api/v1/admin/catalog/products/:id/links/:linkId
 *   PUT    /api/v1/admin/catalog/products/:id/links/:kind/order
 *
 * Errors:
 *   - 400 SELF_LINK_NOT_ALLOWED when source = target
 *   - 409 LINK_ALREADY_EXISTS when (source, target, kind) already present
 *   - 404 TARGET_PRODUCT_NOT_FOUND when target product missing
 *   - 404 PRODUCT_NOT_FOUND when source missing
 *   - bulk insert is all-or-nothing (one bad entry rolls back the batch)
 *
 * Per Constitution Principle III: written FIRST, fails for the right
 * reason — routes don't exist yet.
 */

describe('Admin Product Links contract (T098)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(suffix: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `LINK-${suffix}`,
        type: 'simple',
        name: { 'en-US': `Link product ${suffix}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('POST creates links in bulk; GET filters by kind', async () => {
    const source = await createProduct('SRC-A');
    const t1 = await createProduct('TGT-A1');
    const t2 = await createProduct('TGT-A2');
    const t3 = await createProduct('TGT-A3');

    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${source}/links`,
      payload: {
        links: [
          { targetProductId: t1, kind: 'related' },
          { targetProductId: t2, kind: 'up_sell' },
          { targetProductId: t3, kind: 'cross_sell' },
        ],
      },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const body = create.json() as { data: Array<{ id: string; kind: string }> };
    expect(body.data.length).toBe(3);

    const filtered = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${source}/links?kind=related`,
      cookies: adminCookie,
    });
    expect(filtered.statusCode).toBe(200);
    const filteredBody = filtered.json() as {
      data: Array<{ kind: string; targetProductId: string }>;
    };
    expect(filteredBody.data.length).toBe(1);
    expect(filteredBody.data[0]?.kind).toBe('related');
    expect(filteredBody.data[0]?.targetProductId).toBe(t1);
  });

  it('POST rejects 400 SELF_LINK_NOT_ALLOWED when source = target', async () => {
    const source = await createProduct('SELF');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${source}/links`,
      payload: {
        links: [{ targetProductId: source, kind: 'related' }],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.SELF_LINK_NOT_ALLOWED,
    );
  });

  it('POST rejects 409 LINK_ALREADY_EXISTS on duplicate (source, target, kind)', async () => {
    const source = await createProduct('DUP-S');
    const target = await createProduct('DUP-T');

    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${source}/links`,
      payload: { links: [{ targetProductId: target, kind: 'related' }] },
      cookies: adminCookie,
    });
    expect(first.statusCode).toBe(201);

    const second = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${source}/links`,
      payload: { links: [{ targetProductId: target, kind: 'related' }] },
      cookies: adminCookie,
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.LINK_ALREADY_EXISTS,
    );
  });

  it('POST rejects 404 TARGET_PRODUCT_NOT_FOUND when any target is missing', async () => {
    const source = await createProduct('MISSING-S');
    const real = await createProduct('REAL-T');
    const fake = '00000000-0000-4000-8000-00000000ffff';

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${source}/links`,
      payload: {
        links: [
          { targetProductId: real, kind: 'related' },
          { targetProductId: fake, kind: 'related' },
        ],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.TARGET_PRODUCT_NOT_FOUND,
    );

    // All-or-nothing: the `real` link must NOT be persisted because the
    // batch failed validation as a unit.
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${source}/links`,
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data.length).toBe(0);
  });

  it('DELETE removes a link', async () => {
    const source = await createProduct('DEL-S');
    const target = await createProduct('DEL-T');
    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${source}/links`,
      payload: { links: [{ targetProductId: target, kind: 'up_sell' }] },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const linkId = (create.json() as { data: Array<{ id: string }> }).data[0]!.id;

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${source}/links/${linkId}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${source}/links`,
      cookies: adminCookie,
    });
    expect((list.json() as { data: unknown[] }).data.length).toBe(0);
  });

  it('PUT order updates positions per (source, kind)', async () => {
    const source = await createProduct('REO-S');
    const t1 = await createProduct('REO-T1');
    const t2 = await createProduct('REO-T2');

    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${source}/links`,
      payload: {
        links: [
          { targetProductId: t1, kind: 'related' },
          { targetProductId: t2, kind: 'related' },
        ],
      },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const ids = (create.json() as { data: Array<{ id: string; targetProductId: string }> }).data;
    const id1 = ids.find((l) => l.targetProductId === t1)!.id;
    const id2 = ids.find((l) => l.targetProductId === t2)!.id;

    const reorder = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${source}/links/related/order`,
      payload: { linkIds: [id2, id1] },
      cookies: adminCookie,
    });
    expect(reorder.statusCode).toBe(200);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${source}/links?kind=related`,
      cookies: adminCookie,
    });
    const listBody = list.json() as {
      data: Array<{ id: string; position: number }>;
    };
    const sorted = [...listBody.data].sort((a, b) => a.position - b.position);
    expect(sorted[0]?.id).toBe(id2);
    expect(sorted[1]?.id).toBe(id1);
  });
});
