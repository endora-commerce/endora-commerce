import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { Product } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * T182 — A catalog product update by an Admin User MUST land an
 * AuditLogEntry with action='product.update' (or the agreed catalog price
 * action), object_type='product', object_id=<the product id>, and a
 * stateBefore + stateAfter diff that includes the changed attributeValues.
 */

describe('Audit log on catalog product update', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('writes an AuditLogEntry with stateBefore + stateAfter on product update', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'product.update' });
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${SEED_PRODUCT_101_ID}`,
      // Feature 002 (T023) — attributeValues keys MUST belong to the
      // Product's AttributeSet. `internal_sku_notes` is seeded in the
      // foundation test seed and assigned to the system Default set.
      payload: { attributeValues: { internal_sku_notes: 'audit-test-99.99' } },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);

    const after = await h.em().count(AuditLogEntry, { action: 'product.update' });
    expect(after).toBe(before + 1);

    const entry = await h.em().findOne(
      AuditLogEntry,
      { action: 'product.update', objectId: SEED_PRODUCT_101_ID },
      { orderBy: { actedAt: 'desc' } },
    );
    expect(entry).not.toBeNull();
    expect(entry!.objectType).toBe('product');
    expect(entry!.actorAdminUserId).toBe('00000000-0000-4000-8000-0000000000b1');
    expect(entry!.stateBefore).toBeDefined();
    expect(entry!.stateAfter).toBeDefined();

    // Sanity: the row reflects the new attribute value.
    const product = await h.em().findOne(Product, { id: SEED_PRODUCT_101_ID });
    expect(product!.attributeValues['internal_sku_notes']).toBe('audit-test-99.99');
  });
});
