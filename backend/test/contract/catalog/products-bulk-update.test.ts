import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 — `POST /api/v1/admin/catalog/products/bulk-update`.
 *
 * Foundational contract surface (T003) — exists ≠ 404, auth gated,
 * empty-fields and over-200 guards. Per-product behaviour
 * (succeeded / skipped / failed semantics) lives in T009–T012 / T024.
 */
describe('Feature 022 — POST /products/bulk-update (foundational contract)', () => {
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

  it('route exists (not 404) when called with auth', async () => {
    const id = await createProduct('BULK-FOUND-EXISTS');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { status: 'active' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).not.toBe(404);
  });

  it('rejects requests with no auth cookie (401)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: ['11111111-2222-4333-8444-555555555555'],
        fields: { status: 'active' },
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects empty `fields` with 400 VALIDATION_FAILED', async () => {
    const id = await createProduct('BULK-FOUND-EMPTY');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: {},
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message?: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects empty productIds with 400 VALIDATION_FAILED', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [],
        fields: { status: 'active' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects productIds.length > 200 with 400 BULK_TOO_LARGE', async () => {
    // 201 valid-v4 UUIDs (variant '8' + version '4' nibbles in place).
    const oversized = Array.from({ length: 201 }, (_, i) => {
      const tail = String(i + 1).padStart(12, '0');
      return `11111111-2222-4333-8444-${tail}`;
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: oversized,
        fields: { status: 'active' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: {
        code: string;
        details?: { maxBatchSize?: number; recommendedSplitInto?: number };
      };
    };
    expect(body.error.code).toBe('BULK_TOO_LARGE');
    expect(body.error.details?.maxBatchSize).toBe(200);
  });

  it('returns the bulk response shape on a minimal happy path', async () => {
    const id = await createProduct('BULK-FOUND-SHAPE');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { status: 'active' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        bulkOperationId: string;
        summary: {
          succeeded: number;
          skipped: number;
          failed: number;
          total: number;
        };
        results: Array<{ productId: string; status: string }>;
      };
    };
    expect(typeof body.data.bulkOperationId).toBe('string');
    expect(body.data.summary.total).toBe(1);
    expect(body.data.summary.succeeded + body.data.summary.skipped + body.data.summary.failed).toBe(1);
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]!.productId).toBe(id);
  });
});
