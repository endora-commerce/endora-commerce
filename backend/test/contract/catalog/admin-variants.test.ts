import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T054 (backend prereq) — Admin variants CRUD endpoints for
 * `type='configurable'` Products. Foundation 001 ships the
 * ProductVariant entity but no admin write surface; feature 002
 * needs full CRUD so admins can populate variants on a configurable
 * Product (specs/002-catalog-module/spec.md US2 acceptance scenarios
 * AS1 + AS5).
 *
 * Endpoints:
 *   POST   /api/v1/admin/catalog/products/:productId/variants
 *   PATCH  /api/v1/admin/catalog/products/:productId/variants/:variantId
 *   DELETE /api/v1/admin/catalog/products/:productId/variants/:variantId
 *
 * Errors:
 *   - 404 PRODUCT_NOT_FOUND when parent missing
 *   - 400 PRODUCT_TYPE_MISMATCH when parent.type !== 'configurable'
 *   - 409 SKU_ALREADY_EXISTS when variant SKU collides with any
 *     product or variant SKU
 *   - 404 NOT_FOUND for variant id under PATCH/DELETE
 *
 * Per Constitution Principle III: written FIRST, fails for the right
 * reason — routes don't exist yet, expect 404 from Fastify until
 * the impl lands in this iteration.
 */

describe('Admin Variants CRUD (T054 backend)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createConfigurableProduct(
    suffix: string,
  ): Promise<{ id: string; sku: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `CONF-PARENT-${suffix}`,
        type: 'configurable',
        name: { 'en-US': `Configurable parent ${suffix}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; sku: string } };
    return body.data;
  }

  it('POST creates a Variant under a configurable Product', async () => {
    const parent = await createConfigurableProduct('A');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/variants`,
      payload: {
        sku: 'CONF-VAR-A-RED',
        variantAttributeValues: { color: 'red', size: 'M' },
        priceOverride: 49.99,
        stockLevel: 10,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { id: string; sku: string; parentProductId: string };
    };
    expect(body.data.sku).toBe('CONF-VAR-A-RED');
    expect(body.data.parentProductId).toBe(parent.id);
  });

  it('POST rejects when parent type is not configurable', async () => {
    const simple = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'SIMPLE-FOR-VAR',
        type: 'simple',
        name: { 'en-US': 'Simple parent for variant test' },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(simple.statusCode).toBe(201);
    const simpleId = (simple.json() as { data: { id: string } }).data.id;

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${simpleId}/variants`,
      payload: {
        sku: 'BAD-VAR-SIMPLE',
        variantAttributeValues: { color: 'blue' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST rejects when variant SKU collides with another product/variant SKU', async () => {
    const parent = await createConfigurableProduct('B');
    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/variants`,
      payload: {
        sku: 'CONF-VAR-DUPE',
        variantAttributeValues: { color: 'green' },
      },
      cookies: adminCookie,
    });
    expect(first.statusCode).toBe(201);

    const dupe = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/variants`,
      payload: {
        sku: 'CONF-VAR-DUPE',
        variantAttributeValues: { color: 'red' },
      },
      cookies: adminCookie,
    });
    expect(dupe.statusCode).toBe(409);
    expect((dupe.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.SKU_ALREADY_EXISTS,
    );
  });

  it('PATCH updates a Variant', async () => {
    const parent = await createConfigurableProduct('C');
    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/variants`,
      payload: {
        sku: 'CONF-VAR-PATCH',
        variantAttributeValues: { color: 'red' },
      },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const variantId = (create.json() as { data: { id: string } }).data.id;

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${parent.id}/variants/${variantId}`,
      payload: { priceOverride: 99.99, stockLevel: 5 },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { priceOverride: number | string; stockLevel: number };
    };
    expect(Number(body.data.priceOverride)).toBe(99.99);
    expect(body.data.stockLevel).toBe(5);
  });

  it('DELETE removes a Variant', async () => {
    const parent = await createConfigurableProduct('D');
    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/variants`,
      payload: {
        sku: 'CONF-VAR-DEL',
        variantAttributeValues: { color: 'red' },
      },
      cookies: adminCookie,
    });
    const variantId = (create.json() as { data: { id: string } }).data.id;

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${parent.id}/variants/${variantId}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  it('POST returns 404 PRODUCT_NOT_FOUND when parent does not exist', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/00000000-0000-4000-8000-000000000fff/variants`,
      payload: {
        sku: 'CONF-VAR-ORPHAN',
        variantAttributeValues: {},
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(404);
  });
});
