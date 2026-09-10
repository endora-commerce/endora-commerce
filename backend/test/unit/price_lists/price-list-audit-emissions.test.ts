import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
} from '../../helpers/seed-catalog.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

const adminCookie = { b2b_session: 'stub-admin-session' };

/**
 * Feature 024 / T038-T040 — price-lists gap-fill audit emissions.
 *
 * Drives each lifecycle / content mutation through the HTTP layer so
 * the audit context wiring (`resolveAdminAuditContext` → service) is
 * exercised end-to-end. Validates that the resulting audit row carries
 * the dashboard's expected action token + an identity-bearing snapshot.
 */
describe('PriceListService — audit emissions for lifecycle + content events', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createList(name: string, attachRule = false): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/price-lists-engine',
      payload: {
        name,
        type: 'base',
        ...(attachRule
          ? {
              applicationRule: {
                kind: 'criterion',
                type: 'currency',
                values: ['PLN'],
              },
            }
          : {}),
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('writes price_list.create on POST /price-lists-engine', async () => {
    const id = await createList('Audit Create List');
    const rows = await h.em().find(AuditLogEntry, {
      action: 'price_list.create',
      objectId: id,
    });
    expect(rows.length).toBe(1);
    const after = (rows[0]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(after['name']).toBe('Audit Create List');
    expect(after['type']).toBe('base');
    expect(after['status']).toBe('draft');
  });

  it('writes price_list.update on a name change', async () => {
    const id = await createList('Audit Update List');
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/price-lists-engine/${id}`,
      payload: { name: 'Audit Update List — renamed' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, {
      action: 'price_list.update',
      objectId: id,
    });
    expect(rows.length).toBe(1);
    const before = (rows[0]!.stateBefore ?? {}) as Record<string, unknown>;
    const after = (rows[0]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(before['name']).toBe('Audit Update List');
    expect(after['name']).toBe('Audit Update List — renamed');
    expect(Array.isArray(after['changedFields'])).toBe(true);
  });

  it('writes NO price_list.update row for a no-op patch (feature 054 skipAudit)', async () => {
    const id = await createList('Audit No-op List');
    // Patch the name to its current value → nothing mutates.
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/price-lists-engine/${id}`,
      payload: { name: 'Audit No-op List' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const rows = await h.em().find(AuditLogEntry, {
      action: 'price_list.update',
      objectId: id,
    });
    expect(rows.length).toBe(0);
  });

  it('writes price_list.activate on POST /:id/activate', async () => {
    const id = await createList('Audit Activate List', true);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists-engine/${id}/activate`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, {
      action: 'price_list.activate',
      objectId: id,
    });
    expect(rows.length).toBe(1);
    const before = (rows[0]!.stateBefore ?? {}) as Record<string, unknown>;
    expect(before['status']).toBe('draft');
  });

  it('writes price_list.draftify on POST /:id/draftify', async () => {
    const id = await createList('Audit Draftify List', true);
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists-engine/${id}/activate`,
      cookies: adminCookie,
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists-engine/${id}/draftify`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, {
      action: 'price_list.draftify',
      objectId: id,
    });
    expect(rows.length).toBe(1);
  });

  it('writes price_list.duplicate on POST /:id/duplicate (objectId = the NEW list id)', async () => {
    const sourceId = await createList('Audit Duplicate Source');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists-engine/${sourceId}/duplicate`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const dupId = (res.json() as { data: { id: string } }).data.id;
    expect(dupId).not.toBe(sourceId);

    const rows = await h.em().find(AuditLogEntry, {
      action: 'price_list.duplicate',
      objectId: dupId,
    });
    expect(rows.length).toBe(1);
    const after = (rows[0]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(after['sourcePriceListId']).toBe(sourceId);
    expect(after['sourceName']).toBe('Audit Duplicate Source');
  });

  it('writes price_list.products_replace with COUNTS ONLY (never a product-id list)', async () => {
    const id = await createList('Audit Products Replace List');
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/price-lists-engine/${id}/products`,
      payload: { productIds: [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID] },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, {
      action: 'price_list.products_replace',
      objectId: id,
    });
    expect(rows.length).toBe(1);
    const after = (rows[0]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(after['added']).toBe(2);
    expect(after['removed']).toBe(0);
    expect(after['kept']).toBe(0);
    // Critical: snapshot MUST NOT carry the raw product-id list.
    expect(after).not.toHaveProperty('productIds');
  });

  it('writes price_list.bracket_update with per-currency counts (never raw amounts)', async () => {
    const id = await createList('Audit Bracket Update List');
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/price-lists-engine/${id}/products`,
      payload: { productIds: [SEED_PRODUCT_101_ID] },
      cookies: adminCookie,
    });
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/price-lists-engine/${id}/products/${SEED_PRODUCT_101_ID}/brackets`,
      payload: {
        bracketsByCurrency: {
          PLN: [
            { minQuantity: 1, maxQuantity: 9, amount: '99.00' },
            { minQuantity: 10, maxQuantity: null, amount: '89.00' },
          ],
        },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, {
      action: 'price_list.bracket_update',
      objectId: id,
    });
    expect(rows.length).toBe(1);
    const after = (rows[0]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(after['productId']).toBe(SEED_PRODUCT_101_ID);
    const counts = after['bracketCountByCurrency'] as Record<string, number>;
    expect(counts['PLN']).toBe(2);
  });
});
