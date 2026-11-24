import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BulkOperation, Product } from '../../helpers/package-entities.js';
import {
  collectTiedPages,
  expectTiesInIdOrder,
  placeholders,
  TIE_FUTURE,
  TIE_PAGE_SIZE,
  TIE_ROW_COUNT,
} from '../../helpers/paging-ties.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1760 — the catalog's admin lists page by offset, newest first, so
 * rows created in the same instant need `id` as the tie-breaker, or a page
 * boundary repeats one row and skips another. The seeded rows share a creation
 * time no other row holds, far in the future, so they lead every list.
 *
 * Products are read three ways: the plain list (`findAndCount`), the searched
 * list (a knex page of ids) and the batch-by-id read.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('admin catalog lists — paging through equal creation times (issue #1760)', () => {
  let h: BackendServerHandle;
  const marker = `TIES-${randomUUID().slice(0, 8)}`;
  let productIds: string[] = [];
  let operationIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const products = Array.from({ length: TIE_ROW_COUNT }, (_, i) =>
      em.create(Product, {
        sku: `${marker}-${i}`,
        slug: `${marker}-${i}`.toLowerCase(),
        type: 'simple',
        status: 'active',
        name: `Paging ties ${i}`,
        description: '',
        visibility: 'public',
        allowedOrganizationIds: [],
        attributeValues: {},
      }),
    );
    const operations = Array.from({ length: TIE_ROW_COUNT }, () =>
      em.create(BulkOperation, {
        requestedByAdminUserId: randomUUID(),
        total: 0,
        payload: { productIds: [], fields: {} },
        status: 'completed',
      } as never),
    );
    await em.persist([...products, ...operations]).flush();
    productIds = products.map((p) => p.id);
    operationIds = operations.map((o) => (o as unknown as { id: string }).id);
    const connection = em.getConnection();
    await connection.execute(`update products set created_at = ? where id in (${placeholders(productIds)})`, [
      TIE_FUTURE,
      ...productIds,
    ]);
    await connection.execute(
      `update catalog_bulk_operations set created_at = ? where id in (${placeholders(operationIds)})`,
      [TIE_FUTURE, ...operationIds],
    );
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    if (productIds.length > 0) {
      await connection.execute(`delete from products where id in (${placeholders(productIds)})`, productIds);
    }
    if (operationIds.length > 0) {
      await connection.execute(
        `delete from catalog_bulk_operations where id in (${placeholders(operationIds)})`,
        operationIds,
      );
    }
    await teardownBackendServer(h);
  });

  async function productPage(url: string): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url, cookies: ADMIN_COOKIE });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
  }

  it('GET /api/v1/admin/catalog/products sees every tied product once, ordered by id desc', async () => {
    const collected = await collectTiedPages(0, (page) =>
      productPage(`/api/v1/admin/catalog/products?page=${page}&pageSize=${TIE_PAGE_SIZE}`),
    );
    expectTiesInIdOrder(collected, productIds, 'desc');
  });

  it('GET /api/v1/admin/catalog/products?q= sees every tied product once, ordered by id desc', async () => {
    const collected = await collectTiedPages(0, (page) =>
      productPage(`/api/v1/admin/catalog/products?q=${marker}&page=${page}&pageSize=${TIE_PAGE_SIZE}`),
    );
    expectTiesInIdOrder(collected, productIds, 'desc');
  });

  it('POST /api/v1/admin/catalog/products/batch-by-id sees every tied product once, ordered by id desc', async () => {
    const collected = await collectTiedPages(0, async (page) => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products/batch-by-id',
        cookies: ADMIN_COOKIE,
        payload: { ids: productIds, page, pageSize: TIE_PAGE_SIZE },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
    });
    expectTiesInIdOrder(collected, productIds, 'desc');
  });

  it('GET /api/v1/admin/catalog/bulk-operations sees every tied operation once, ordered by id desc', async () => {
    const collected = await collectTiedPages(0, async (page) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/bulk-operations?limit=${TIE_PAGE_SIZE}&offset=${page * TIE_PAGE_SIZE}`,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
    });
    expectTiesInIdOrder(collected, operationIds, 'desc');
  });
});
