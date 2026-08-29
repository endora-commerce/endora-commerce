import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminRole, AdminUser, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import { randomUUID } from 'crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ReturnCase } from '../../helpers/package-entities.js';

/**
 * Feature 050 US1 — the tenant guard confines the returns admin surface. A
 * sales-rep granted `returns:read`/`returns:write` and assigned to Org A only
 * MUST NOT see or act on an Org B return case (historically `getByIdForAdmin`
 * / admin list loaded by id/params with no assignment filter).
 */
describe('Returns — cross-tenant scoping (feature 050 US1)', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  let orgAId: string;
  let orgBId: string;
  let returnAId: string;
  let returnBId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    orgAId = randomUUID();
    orgBId = randomUUID();

    await withSystemScope('test seed', async () => {
      const em = h.em();
      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) {
        role = em.create(AdminRole, {
          code: 'sales_representative',
          name: 'Sales Representative',
          permissions: ['returns:read', 'returns:write'],
        });
      } else {
        for (const p of ['returns:read', 'returns:write']) {
          if (!role.permissions.includes(p)) role.permissions = [...role.permissions, p];
        }
      }
      await em.persistAndFlush(role);

      const rep = em.create(AdminUser, {
        email: `sales-rep-050-ret-${Date.now()}@r.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '050',
        lastName: 'Rep',
      });
      await em.persistAndFlush(rep);
      await em.persistAndFlush(
        em.create(OrganizationSalesRepAssignment, { organizationId: orgAId, adminUserId: rep.id }),
      );

      repCookie = `stub-sales-rep-050-ret-${Date.now()}`;
      ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };

      const em2 = h.em();
      const rcA = em2.create(ReturnCase, {
        kind: 'return', orderId: randomUUID(), salesChannelId: randomUUID(),
        customerAccountId: randomUUID(), organizationId: orgAId, statusCode: 'requested',
        currency: 'PLN', submittedAt: new Date(),
      });
      const rcB = em2.create(ReturnCase, {
        kind: 'return', orderId: randomUUID(), salesChannelId: randomUUID(),
        customerAccountId: randomUUID(), organizationId: orgBId, statusCode: 'requested',
        currency: 'PLN', submittedAt: new Date(),
      });
      await em2.persistAndFlush([rcA, rcB]);
      returnAId = rcA.id;
      returnBId = rcB.id;
    });
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[repCookie];
    await teardownBackendServer(h);
  });

  it('scoped sales-rep admin returns list contains only assigned-org cases', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/returns',
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { rows: Array<{ id: string }> } };
    const ids = body.data.rows.map((r) => r.id);
    expect(ids).toContain(returnAId);
    expect(ids).not.toContain(returnBId);
  });

  it('scoped sales-rep cannot act on an unassigned org return (404)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${returnBId}/authorize`,
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('platform admin still sees both orgs', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/returns',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { rows: Array<{ id: string }> } };
    const ids = body.data.rows.map((r) => r.id);
    expect(ids).toContain(returnAId);
    expect(ids).toContain(returnBId);
  });
});
