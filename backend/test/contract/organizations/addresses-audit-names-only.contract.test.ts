import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #470 (D-288) — the platform-wide audit screen, `GET /api/v1/admin/audit-log`, is
 * read under `audit_log:read` without Organization reach, so an Organization address's
 * entries name what changed and never carry the address or the Organization it belongs
 * to. The rows read are this test's own address's, by id.
 */
describe('Organization address entries in the platform audit log (#470)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a created, updated and deleted address leaves names, never values, in GET /admin/audit-log', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/addresses',
      payload: {
        kind: 'delivery',
        recipientName: 'S470-NAME',
        street: 'S470-STREET',
        city: 'S470-CITY',
        postalCode: 'S470-PC',
        country: 'PL',
        phone: '+48470470470',
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { id } = (created.json() as { data: { id: string } }).data;

    const updated = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/mine/addresses/${id}`,
      payload: { street: 'S470-STREET-NEW', phone: '+48470470471' },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/mine/addresses/${id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(removed.statusCode, removed.body).toBeLessThan(300);

    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(read.statusCode, read.body).toBe(200);
    const rows = (read.json() as { data: Array<{ action: string; stateBefore: unknown; stateAfter: unknown }> }).data;
    expect(rows.map((row) => row.action).sort()).toEqual(['address.create', 'address.delete', 'address.update']);
    const recorded = JSON.stringify(rows.map((row) => [row.stateBefore, row.stateAfter]));
    for (const sentinel of ['S470', '470470', '470471', TEST_ORGANIZATION_ID]) {
      expect(recorded, sentinel).not.toContain(sentinel);
    }
    expect(rows.find((row) => row.action === 'address.update')?.stateAfter).toEqual({
      kind: 'delivery',
      changedFields: ['phone', 'street'],
    });
  });
});
