import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

/**
 * Feature 024 / T022-T024 — catalog gap-fill audit emissions.
 *
 * `CatalogAdminService.createProduct()` and `archiveProduct()` must
 * write append-only audit entries with the same shape used by the
 * existing `updateProduct()` emission, so the dashboard's
 * `/recent-activity` endpoint surfaces them.
 *
 * Tests run through the HTTP layer (same pattern as feature 022 / T002)
 * so the audit context wiring (`resolveAdminAuditContext` → service)
 * is exercised end-to-end.
 */
describe('CatalogAdminService — audit emissions for create / archive', () => {
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
        name: { 'en-US': `Audit ${sku}` },
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

  it('writes a product.create audit entry on POST /catalog/products', async () => {
    const id = await createProduct('AUDIT-CREATE-001');

    const rows = await h
      .em()
      .find(AuditLogEntry, { action: 'product.create', objectId: id });
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.objectType).toBe('product');
    expect(row.actorAdminUserId).toBe('00000000-0000-4000-8000-0000000000b1');
    const after = (row.stateAfter ?? {}) as Record<string, unknown>;
    expect(after).toMatchObject({
      sku: 'AUDIT-CREATE-001',
      status: 'draft',
      visibility: 'public',
    });
    expect(after['name']).toBeTruthy();
  });

  it('writes a product.delete audit entry on DELETE /catalog/products/:id', async () => {
    const id = await createProduct('AUDIT-DEL-001');

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);

    const rows = await h
      .em()
      .find(AuditLogEntry, { action: 'product.delete', objectId: id });
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.objectType).toBe('product');
    const after = (row.stateAfter ?? {}) as Record<string, unknown>;
    expect(after['deletedAt']).toBeTruthy();
  });
});
