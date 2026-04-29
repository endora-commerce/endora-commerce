import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T117 — Contract test for Grouped + Bundle admin surfaces (feature 002 US5).
 *
 * Endpoints:
 *   /products/:id/grouped-items[/:itemId]  GET / POST / PATCH / DELETE
 *   /products/:id/bundle-slots[/:slotId]   GET / POST / PATCH / DELETE
 *   /products/:id/bundle-slots/:slotId/options[/:optionId]  POST / DELETE
 *
 * Errors:
 *   - 400 PRODUCT_TYPE_MISMATCH when called against the wrong parent type
 *   - 400 NESTED_COMPOSITE_NOT_ALLOWED when child is grouped/bundle (R-8)
 *   - 400 INVALID_QUANTITY_RANGE when min > max on slot create
 *   - 409 OPTION_ALREADY_EXISTS when same option product reused in a slot
 *
 * Per Constitution Principle III: written FIRST, fails for the right
 * reason — services + routes don't exist yet.
 */

describe('Admin Composite (Grouped + Bundle) contract (T117)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(
    suffix: string,
    type: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual' = 'simple',
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      sku: `COMP-${type.toUpperCase()}-${suffix}`,
      type,
      name: { 'en-US': `Composite ${type} ${suffix}` },
      description: { 'en-US': '' },
      categoryIds: [],
      attributeValues: {},
      visibility: 'public',
    };
    if (type === 'virtual') {
      payload['downloadUrl'] = 'https://example.test/file.pdf';
    }
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  // ------------------------- Grouped --------------------------------------

  it('Grouped: POST adds child + GET lists items', async () => {
    const parent = await createProduct('GA-PARENT', 'grouped');
    const child = await createProduct('GA-CHILD');

    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/grouped-items`,
      payload: { childProductId: child, quantity: 3 },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${parent}/grouped-items`,
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: Array<{ childProductId: string; quantity: number }>;
    };
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.childProductId).toBe(child);
    expect(body.data[0]?.quantity).toBe(3);
  });

  it('Grouped: 400 PRODUCT_TYPE_MISMATCH when parent is not grouped', async () => {
    const parent = await createProduct('GB-PARENT', 'simple');
    const child = await createProduct('GB-CHILD');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/grouped-items`,
      payload: { childProductId: child, quantity: 1 },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PRODUCT_TYPE_MISMATCH,
    );
  });

  it('Grouped: 400 NESTED_COMPOSITE_NOT_ALLOWED when child is grouped/bundle', async () => {
    const parent = await createProduct('GC-PARENT', 'grouped');
    const childGrouped = await createProduct('GC-CHILD', 'grouped');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/grouped-items`,
      payload: { childProductId: childGrouped, quantity: 1 },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.NESTED_COMPOSITE_NOT_ALLOWED,
    );
  });

  // ------------------------- Bundle ---------------------------------------

  it('Bundle: POST creates slot + adds option', async () => {
    const parent = await createProduct('BA-PARENT', 'bundle');
    const optionProduct = await createProduct('BA-OPT');

    const slot = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots`,
      payload: {
        name: { 'en-US': 'Color' },
        minQuantity: 1,
        maxQuantity: 1,
      },
      cookies: adminCookie,
    });
    expect(slot.statusCode).toBe(201);
    const slotId = (slot.json() as { data: { id: string } }).data.id;

    const option = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots/${slotId}/options`,
      payload: { optionProductId: optionProduct },
      cookies: adminCookie,
    });
    expect(option.statusCode).toBe(201);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots`,
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: Array<{ id: string; options: Array<{ optionProductId: string }> }>;
    };
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.options.length).toBe(1);
    expect(body.data[0]?.options[0]?.optionProductId).toBe(optionProduct);
  });

  it('Bundle: 400 INVALID_QUANTITY_RANGE when min > max', async () => {
    const parent = await createProduct('BB-PARENT', 'bundle');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots`,
      payload: {
        name: { 'en-US': 'Bad' },
        minQuantity: 5,
        maxQuantity: 2,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect([
      ERROR_CODES.VALIDATION_FAILED,
      ERROR_CODES.INVALID_QUANTITY_RANGE,
    ]).toContain((res.json() as { error: { code: string } }).error.code);
  });

  it('Bundle: 409 OPTION_ALREADY_EXISTS on duplicate option in same slot', async () => {
    const parent = await createProduct('BC-PARENT', 'bundle');
    const optionProduct = await createProduct('BC-OPT');
    const slot = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots`,
      payload: { name: { 'en-US': 'X' }, minQuantity: 0, maxQuantity: 5 },
      cookies: adminCookie,
    });
    const slotId = (slot.json() as { data: { id: string } }).data.id;

    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots/${slotId}/options`,
      payload: { optionProductId: optionProduct },
      cookies: adminCookie,
    });
    expect(first.statusCode).toBe(201);

    const second = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots/${slotId}/options`,
      payload: { optionProductId: optionProduct },
      cookies: adminCookie,
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.OPTION_ALREADY_EXISTS,
    );
  });

  it('Bundle: 400 NESTED_COMPOSITE_NOT_ALLOWED on grouped option product', async () => {
    const parent = await createProduct('BD-PARENT', 'bundle');
    const groupedOption = await createProduct('BD-OPT', 'grouped');
    const slot = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots`,
      payload: { name: { 'en-US': 'Y' }, minQuantity: 0, maxQuantity: 1 },
      cookies: adminCookie,
    });
    const slotId = (slot.json() as { data: { id: string } }).data.id;

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots/${slotId}/options`,
      payload: { optionProductId: groupedOption },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.NESTED_COMPOSITE_NOT_ALLOWED,
    );
  });

  it('Bundle: 400 PRODUCT_TYPE_MISMATCH when parent is not bundle', async () => {
    const parent = await createProduct('BE-PARENT', 'simple');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/bundle-slots`,
      payload: { name: { 'en-US': 'Z' }, minQuantity: 0, maxQuantity: 1 },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PRODUCT_TYPE_MISMATCH,
    );
  });
});
