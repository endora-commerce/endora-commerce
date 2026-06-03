import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 / T024, T025 — Bulk Edit attribute values.
 *
 * Covers:
 *   - happy path: every selected product carries the flagged attribute
 *     in its set → all succeed and attribute value lands.
 *   - request-level rejection: a key without massEditable=true → whole
 *     batch refused with 400 ATTRIBUTE_NOT_MASS_EDITABLE.
 */
describe('Feature 022 — POST /products/bulk-update (attribute values)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createAttribute(payload: Record<string, unknown>): Promise<{
    id: string;
    key: string;
  }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; key: string } }).data;
  }

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

  it('rejects the whole request with 400 ATTRIBUTE_NOT_MASS_EDITABLE when a key is not flagged', async () => {
    // Create an attribute WITHOUT mass_editable=true.
    await createAttribute({
      key: 'unflagged_for_bulk',
      label: { 'en-US': 'Unflagged' },
      labelDefault: 'Unflagged',
      valueType: 'string',
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
    });
    const id = await createProduct('BULK-ATTR-REJECT-001');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { attributeValues: { unflagged_for_bulk: 'value' } },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: { code: string; details?: { attribute?: string } };
    };
    expect(body.error.code).toBe('ATTRIBUTE_NOT_MASS_EDITABLE');
    expect(body.error.details?.attribute).toBe('unflagged_for_bulk');
  });

  it('skips the per-product write when the attribute is not in that product\'s set, others succeed', async () => {
    // Attribute flagged mass_editable=true but NOT added to the Default
    // Attribute Set — so every product whose set is Default lacks it.
    await createAttribute({
      key: 'flagged_not_in_set',
      label: { 'en-US': 'Flagged' },
      labelDefault: 'Flagged',
      valueType: 'string',
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
      massEditable: true,
    });
    const id = await createProduct('BULK-ATTR-SKIP-001');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { attributeValues: { flagged_not_in_set: 'value' } },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        summary: { succeeded: number; skipped: number; failed: number };
        results: Array<{
          status: string;
          reason?: string;
          details?: { attribute?: string };
        }>;
      };
    };
    expect(body.data.summary.skipped).toBe(1);
    expect(body.data.summary.succeeded).toBe(0);
    expect(body.data.results[0]!.status).toBe('skipped');
    expect(body.data.results[0]!.reason).toBe('attribute_not_in_set');
    expect(body.data.results[0]!.details?.attribute).toBe('flagged_not_in_set');
  });

  it('queues a large selection instead of running the synchronous pre-flight', async () => {
    // Above the async threshold the mass-editable pre-flight no longer
    // runs inline — the request is delegated to a background bulk
    // operation (the worker validates per-product). So a 201-id list with
    // an unflagged attribute is accepted with a queued ack rather than
    // rejected synchronously.
    const oversized = Array.from({ length: 201 }, (_, i) => {
      const tail = String(i + 1).padStart(12, '0');
      return `11111111-2222-4333-8444-${tail}`;
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: oversized,
        fields: { attributeValues: { unflagged_for_bulk: 'value' } },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { data?: { queued?: boolean } };
    expect(body.data?.queued).toBe(true);
  });
});
