import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

/**
 * Feature 054 (US1 / T013) — the admin product-update route runs through the
 * Command Bus. Verifies exactly one `product.update` audit row (no double-audit
 * from a leftover manual record()), with the server-derived admin actor and the
 * before/after name + changedFields.
 */
describe('PATCH /admin/catalog/products/:id — audited via Command Bus [real DB]', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createProduct(sku: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku,
        type: 'simple',
        name: { 'en-US': 'Original name' },
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

  it('writes exactly one product.update audit row with actor + before/after on a name change', async () => {
    const id = await createProduct('CMDBUS-PROD-1');

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { name: { 'en-US': 'Renamed via command' } },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, { action: 'product.update', objectId: id });
    expect(rows).toHaveLength(1); // exactly one — no double-audit (FR-010)
    expect(rows[0]?.actorAdminUserId).toBeTruthy(); // server-derived admin actor
    const before = (rows[0]?.stateBefore ?? {}) as { name?: Record<string, string> };
    const after = (rows[0]?.stateAfter ?? {}) as {
      name?: Record<string, string>;
      changedFields?: string[];
    };
    expect(before.name?.['en-US']).toBe('Original name');
    expect(after.name?.['en-US']).toBe('Renamed via command');
    expect(after.changedFields).toContain('name');
  });
});
