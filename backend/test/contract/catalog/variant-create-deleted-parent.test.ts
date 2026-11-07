import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';

import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #869 — a variant cannot be added to a deleted product.
 *
 * `createVariant` read the parent by id alone, so
 * `POST /api/v1/admin/catalog/products/:productId/variants` accepted a parent
 * that had been soft-deleted and gave it a new variant. A deleted product
 * answers as an unknown one does: `404 PRODUCT_NOT_FOUND`, and no variant is
 * written.
 */
describe('POST /admin/catalog/products/:productId/variants — deleted parent (issue #869)', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function configurableProduct(sku: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku,
        type: 'configurable',
        name: `Configurable ${sku}`,
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      ...admin,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  function addVariant(productId: string, sku: string): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/variants`,
      payload: { sku, variantAttributeValues: { color: 'red' }, stockLevel: 1 },
      ...admin,
    });
  }

  it('adds a variant to a live configurable product (positive control)', async () => {
    const productId = await configurableProduct('I869-LIVE');
    const res = await addVariant(productId, 'I869-LIVE-RED');
    expect(res.statusCode).toBe(201);
  });

  it('answers 404 PRODUCT_NOT_FOUND for a deleted product, as for an unknown one, and writes nothing', async () => {
    const productId = await configurableProduct('I869-DELETED');
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${productId}`,
      ...admin,
    });
    expect(del.statusCode).toBeLessThan(300);

    const res = await addVariant(productId, 'I869-DELETED-RED');
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PRODUCT_NOT_FOUND,
    );

    const unknown = await addVariant('00000000-0000-4000-8000-000000000869', 'I869-UNKNOWN-RED');
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PRODUCT_NOT_FOUND,
    );

    const variants = await h
      .em()
      .getConnection()
      .execute<{ count: string }[]>(
        `select count(*)::text as count from product_variants where sku = 'I869-DELETED-RED'`,
      );
    expect(variants[0]?.count).toBe('0');
  });
});
