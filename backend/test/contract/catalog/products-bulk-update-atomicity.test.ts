import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 / T012 — per-product atomicity (no batch abort).
 *
 * Sends a mixed batch — two real product ids interleaved with one
 * missing id — and asserts:
 *   - the missing id is reported as `skipped` with `product_not_found`;
 *   - both real products commit successfully;
 *   - the batch summary totals match (succeeded: 2, skipped: 1).
 *
 * Together with `products-bulk-update-attributes.test.ts` (which already
 * exercises the `skipped { attribute_not_in_set }` partition), this
 * covers the spec's no-batch-abort guarantee end-to-end.
 */
describe('Feature 022 — POST /products/bulk-update (per-product atomicity)', () => {
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
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function readProductStatus(id: string): Promise<string | null> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ status: string }>>(`select status from products where id = ?`, [id])) as Array<{
      status: string;
    }>;
    return rows[0]?.status ?? null;
  }

  it('skips a missing id with product_not_found and still commits the rest of the batch', async () => {
    const a = await createProduct('BULK-ATOMIC-001');
    const missing = '00000000-0000-4000-8000-9999999b00b1';
    const b = await createProduct('BULK-ATOMIC-002');

    // Pre-flight: confirm products start in draft so the active write is observable.
    expect(await readProductStatus(a)).toBe('draft');
    expect(await readProductStatus(b)).toBe('draft');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [a, missing, b],
        fields: { status: 'active' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        summary: { succeeded: number; skipped: number; failed: number; total: number };
        results: Array<{
          productId: string;
          status: string;
          reason?: string;
        }>;
      };
    };

    expect(body.data.summary.total).toBe(3);
    expect(body.data.summary.succeeded).toBe(2);
    expect(body.data.summary.skipped).toBe(1);
    expect(body.data.summary.failed).toBe(0);

    // Per-product outcomes — order matches the request, so index 1 is
    // the missing id.
    expect(body.data.results).toHaveLength(3);
    expect(body.data.results[0]!.productId).toBe(a);
    expect(body.data.results[0]!.status).toBe('succeeded');
    expect(body.data.results[1]!.productId).toBe(missing);
    expect(body.data.results[1]!.status).toBe('skipped');
    expect(body.data.results[1]!.reason).toBe('product_not_found');
    expect(body.data.results[2]!.productId).toBe(b);
    expect(body.data.results[2]!.status).toBe('succeeded');

    // DB-level: both real products have been written; the missing id
    // was never created and is still absent.
    expect(await readProductStatus(a)).toBe('active');
    expect(await readProductStatus(b)).toBe('active');
    expect(await readProductStatus(missing)).toBeNull();
  });
});
