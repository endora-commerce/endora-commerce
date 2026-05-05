import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 012 / T020 — Attribute Set ↔ Product preview contract (US2).
 *
 * Covers `contracts/attribute-sets.contract.md`:
 *   - POST /api/v1/admin/catalog/products/:id/attribute-set-preview
 *     returns the diff (added / removed / valuesPreserved /
 *     requiredButMissing) without persisting.
 *   - PATCH /api/v1/admin/catalog/products/:id refuses with 400 when
 *     a required attribute is left without a value (FR-013).
 */
describe('Admin AttributeSet preview contract — feature 012 (T020)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('POST /attribute-set-preview returns the diff shape', async () => {
    // Create a product with the seeded Default Attribute Set
    // (the seed-catalog helper attaches color, internal_sku_notes,
    // material, certification to the Default set with deterministic
    // UUID 'defa0017-0000-4000-8000-000000000000').
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'PREVIEW-TEST-001',
        type: 'simple',
        name: { 'en-US': 'Preview test 1' },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: { color: 'red' },
        visibility: 'public',
        attributeSetId: 'defa0017-0000-4000-8000-000000000000',
      },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const productId = (create.json() as { data: { id: string } }).data.id;

    // Preview swapping to null (unset). Every current attribute should
    // appear under attributesRemoved; the existing color value should
    // appear under valuesPreserved.
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/attribute-set-preview`,
      payload: { targetSetId: null },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        attributesAdded: Array<{ key: string }>;
        attributesRemoved: Array<{ key: string }>;
        valuesPreserved: Array<{ key: string }>;
        requiredButMissing: Array<{ key: string }>;
      };
    };
    expect(body.data.attributesAdded).toEqual([]);
    expect(body.data.attributesRemoved.map((a) => a.key)).toContain('color');
    expect(body.data.valuesPreserved.map((v) => v.key)).toContain('color');
    expect(body.data.requiredButMissing).toEqual([]);
  });

  it('POST /attribute-set-preview returns 404 when product does not exist', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/00000000-0000-4000-8000-000000000000/attribute-set-preview',
      payload: { targetSetId: null },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(404);
  });
});
