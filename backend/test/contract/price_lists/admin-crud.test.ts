import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';

/**
 * T133 (pricing slice) — admin CRUD round-trip:
 *   - upsert customer-group → list
 *   - upsert price-list → create item → create assignment → list
 *   - preview endpoint returns the resolved price honouring the new list
 */

describe('Admin pricing CRUD + preview', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upserts a customer group and returns it from list', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/customer-groups/wholesale',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { code: 'wholesale', name: 'Wholesale buyers' },
    });
    expect(put.statusCode).toBe(200);
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/customer-groups',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = list.json() as { data: Array<{ code: string; name: string }> };
    expect(body.data.find((g) => g.code === 'wholesale')?.name).toBe('Wholesale buyers');
  });

  it('round-trips a price list with an item and an assignment, then previews', async () => {
    const product = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });

    const upsertList = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/price-lists/contract-test-list',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'contract-test-list',
        name: 'Contract test list',
        currency: 'PLN',
        priority: 50,
      },
    });
    expect(upsertList.statusCode).toBe(200);
    const listId = (upsertList.json() as { data: { id: string } }).data.id;

    const createItem = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists/${listId}/items`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        mode: 'fixed_unit',
        productId: product.id,
        minQuantity: 1,
        unitPrice: 9.99,
      },
    });
    expect(createItem.statusCode).toBe(201);

    const createAssignment = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists/${listId}/assignments`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { isDefault: true },
    });
    expect(createAssignment.statusCode).toBe(201);

    const preview = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-lists/preview?productSku=EXAMPLE-SIMPLE-001&quantity=1&salesChannelCode=pl_retail`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as {
      data: {
        unitPrice: { amount: number; currency: string };
        source: string;
        priceListId: string | null;
      };
    };
    expect(previewBody.data.source).toBe('list');
    expect(previewBody.data.unitPrice.amount).toBe(9.99);
    expect(previewBody.data.priceListId).toBe(listId);
  });

  it('rejects fixed_unit items without productId or unitPrice', async () => {
    const list = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/price-lists/contract-bad-item',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { code: 'contract-bad-item', name: 'Bad', currency: 'PLN' },
    });
    const listId = (list.json() as { data: { id: string } }).data.id;
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists/${listId}/items`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { mode: 'fixed_unit' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects assignment without exactly one target', async () => {
    const list = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/price-lists/contract-bad-assign',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { code: 'contract-bad-assign', name: 'Bad', currency: 'PLN' },
    });
    const listId = (list.json() as { data: { id: string } }).data.id;
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists/${listId}/assignments`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
