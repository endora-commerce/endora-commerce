import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { AdminRole } from '../../../src/modules/admin_roles/entities/admin-role.entity.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { OrganizationSalesRepAssignment } from '../../../src/modules/organizations/entities/organization-sales-rep-assignment.entity.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Feature 056 US3 — set credit-inheritance mode (T026 contract).
 *
 * PUT /api/v1/admin/organizations/:id/credit-inheritance-mode is a platform-
 * admin-only money-behavior switch: a scoped (sales-rep / roll-up) actor is
 * rejected 403 even with `customers:manage`; a platform admin persists the mode.
 */

describe('set organization credit-inheritance mode (US3)', () => {
  let h: BackendServerHandle;
  let orgId: string;
  let repCookie: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const org = em.create(Organization, {
      name: 'ICM Org',
      taxId: `PL056ICM${Date.now().toString().slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    org.path = `/${org.id}/`;
    await em.flush();
    orgId = org.id;

    // A scoped sales-rep WITH customers:manage — passes the permission gate but
    // must still be rejected by the platform-admin-only scoping guard.
    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: ['customers:manage'],
      });
    } else if (!role.permissions.includes('customers:manage')) {
      role.permissions = [...role.permissions, 'customers:manage'];
    }
    await em.persistAndFlush(role);
    const rep = em.create(AdminUser, {
      email: `icm-rep-${Date.now()}@p.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'ICM',
      lastName: 'Rep',
    });
    await em.persistAndFlush(rep);
    await em.persistAndFlush(
      em.create(OrganizationSalesRepAssignment, { organizationId: orgId, adminUserId: rep.id }),
    );
    repCookie = `stub-icm-rep-${Date.now()}`;
    ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[repCookie];
    await teardownBackendServer(h);
  });

  it('platform admin sets and clears the per-org credit-inheritance mode', async () => {
    const set = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/credit-inheritance-mode`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { mode: 'independent_default' },
    });
    expect(set.statusCode).toBe(200);
    expect((set.json() as { data: { creditInheritanceMode: string } }).data.creditInheritanceMode).toBe(
      'independent_default',
    );

    const em = h.em();
    em.clear();
    const org = await em.findOneOrFail(Organization, { id: orgId });
    expect(org.creditInheritanceMode).toBe('independent_default');

    // null resets to the Settings global default.
    const reset = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/credit-inheritance-mode`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { mode: null },
    });
    expect(reset.statusCode).toBe(200);
    em.clear();
    const org2 = await em.findOneOrFail(Organization, { id: orgId });
    expect(org2.creditInheritanceMode ?? null).toBeNull();
  });

  it('rejects a scoped (sales-rep) actor with 403 even though it has customers:manage', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/credit-inheritance-mode`,
      cookies: { b2b_session: repCookie },
      payload: { mode: 'shared_pool' },
    });
    expect(res.statusCode).toBe(403);
  });
});
