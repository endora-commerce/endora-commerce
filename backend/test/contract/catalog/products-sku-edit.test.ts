import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 012 / T027 — Editable SKU contract (US3).
 *
 * Covers `contracts/products-sku-edit.contract.md`:
 *   - PATCH /api/v1/admin/catalog/products/:id accepts the `sku` field.
 *   - Renaming to a SKU already in use by another product is refused
 *     with 400 sku_in_use.
 *   - Renaming to an invalid SKU (empty / whitespace only / >160) is
 *     refused with 400 invalid_sku.
 *   - Renaming the same SKU back to itself is a no-op (no error).
 *   - Renaming to a different value persists.
 */
describe('Admin Products contract — feature 012 editable SKU (T027)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(sku: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku,
        type: 'simple',
        name: { 'en-US': sku },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string } };
    return body.data.id;
  }

  it('PATCH renames a SKU and persists', async () => {
    const id = await createProduct('SKU-EDIT-001');
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { sku: 'SKU-EDIT-001-renamed' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { sku: string } };
    expect(body.data.sku).toBe('SKU-EDIT-001-renamed');

    // Re-read confirms the rename stuck.
    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(200);
    const after = get.json() as { data: { sku: string } };
    expect(after.data.sku).toBe('SKU-EDIT-001-renamed');
  });

  it('PATCH refuses a SKU already in use by another product (400 sku_in_use)', async () => {
    await createProduct('SKU-EDIT-A');
    const idB = await createProduct('SKU-EDIT-B');
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${idB}`,
      payload: { sku: 'SKU-EDIT-A' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { message: string } };
    expect(body.error.message).toMatch(/sku_in_use/);
  });

  it('PATCH refuses an empty SKU with 400 invalid_sku', async () => {
    const id = await createProduct('SKU-EDIT-EMPTY');
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { sku: '   ' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { message: string } };
    expect(body.error.message).toMatch(/invalid_sku/);
  });

  it('PATCH allows the same SKU (no-op) without error', async () => {
    const id = await createProduct('SKU-EDIT-NOOP');
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { sku: 'SKU-EDIT-NOOP' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
  });
});
