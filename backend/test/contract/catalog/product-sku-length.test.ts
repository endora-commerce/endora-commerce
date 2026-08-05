import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 068 / T011 — the product identifier is 255 characters wide.
 *
 * Ergonode's `Sku` scalar allows up to 255 characters (research §A5), while
 * Endora capped `products.sku` / `product_variants.sku` at 64. This contract
 * pins the widened boundary end to end — Zod contract, service guard and the
 * database column — so an importer can never be silently refused or truncated:
 *
 *   - POST   /api/v1/admin/catalog/products                    accepts 255
 *   - PATCH  /api/v1/admin/catalog/products/:id                 accepts 255
 *   - POST   /api/v1/admin/catalog/products/:id/variants        accepts 255
 *   - 256 characters is still refused with a validation error on all three
 *
 * The upper bound matters as much as the lower one: an unbounded SKU would
 * fail at the column rather than at the contract.
 */
describe('Admin catalog contract — feature 068 SKU length (T011)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    // The widening migration's `down()` deliberately refuses to narrow the
    // column while any row exceeds 64 characters (data-model §12), and
    // `attributes-migration-parity.test.ts` steps every newer migration down
    // on the shared test database. Leaving a long SKU behind would therefore
    // break an unrelated suite, so this file removes exactly what it created.
    const conn = h.orm.em.getConnection();
    await conn.execute('delete from "product_variants" where length("sku") > 64');
    await conn.execute('delete from "products" where length("sku") > 64');
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  /** A SKU of exactly `length` characters, unique per `tag`. */
  function skuOfLength(tag: string, length: number): string {
    const prefix = `SKU-LEN-${tag}-`;
    return prefix + 'X'.repeat(length - prefix.length);
  }

  function createProduct(sku: string, type: 'simple' | 'configurable' = 'simple') {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku,
        type,
        name: { 'en-US': `Long SKU ${sku.slice(0, 16)}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
  }

  it('POST accepts a 255-character SKU and round-trips it', async () => {
    const sku = skuOfLength('C255', 255);
    expect(sku).toHaveLength(255);

    const res = await createProduct(sku);
    expect(res.statusCode).toBe(201);
    const created = res.json() as { data: { id: string; sku: string } };
    expect(created.data.sku).toBe(sku);

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${created.data.id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { data: { sku: string } }).data.sku).toBe(sku);
  });

  it('POST refuses a 256-character SKU with a validation error', async () => {
    const sku = skuOfLength('C256', 256);
    expect(sku).toHaveLength(256);

    const res = await createProduct(sku);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('PATCH accepts a 255-character SKU and persists it', async () => {
    const create = await createProduct('SKU-LEN-U255-SEED');
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { data: { id: string } }).data.id;

    const sku = skuOfLength('U255', 255);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { sku },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { sku: string } }).data.sku).toBe(sku);

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect((get.json() as { data: { sku: string } }).data.sku).toBe(sku);
  });

  it('PATCH refuses a 256-character SKU with a validation error', async () => {
    const create = await createProduct('SKU-LEN-U256-SEED');
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { data: { id: string } }).data.id;

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { sku: skuOfLength('U256', 256) },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('POST /variants accepts a 255-character SKU and round-trips it', async () => {
    const parent = await createProduct('SKU-LEN-V255-PARENT', 'configurable');
    expect(parent.statusCode).toBe(201);
    const parentId = (parent.json() as { data: { id: string } }).data.id;

    const sku = skuOfLength('V255', 255);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parentId}/variants`,
      payload: { sku, variantAttributeValues: { color: 'red' } },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { data: { sku: string } }).data.sku).toBe(sku);
  });

  it('POST /variants refuses a 256-character SKU with a validation error', async () => {
    const parent = await createProduct('SKU-LEN-V256-PARENT', 'configurable');
    expect(parent.statusCode).toBe(201);
    const parentId = (parent.json() as { data: { id: string } }).data.id;

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parentId}/variants`,
      payload: {
        sku: skuOfLength('V256', 256),
        variantAttributeValues: { color: 'red' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
