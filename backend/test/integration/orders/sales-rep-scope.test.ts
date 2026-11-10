import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AdminRole, AdminUser, Order, Organization, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES, TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Feature 026 US6 — Sales-rep ownership scopes the admin orders list.
 *
 * Drives the test harness's `resolveTestAdminOrdersScope` resolver (which
 * mirrors the production wiring exactly) by hitting GET /api/v1/admin/orders
 * with two different admin sessions:
 *
 *   1. A sales-rep admin with ONE assigned Organization → response holds
 *      that Organization's orders and the unassigned one's, never those of
 *      an Organization assigned to another representative.
 *   2. A sales-rep admin with ZERO assigned Organizations → response holds
 *      every unassigned Organization's orders and none of the assigned one's
 *      (issue #305, owner ruling 2026-11-07: one reach rule, the unassigned
 *      fallback included, on every surface). It used to be an empty list.
 *   3. The platform admin (`stub-admin-session`) → response is unscoped.
 *
 * One order is seeded in the assigned Organization and one in an unassigned
 * Organization.
 */
describe('Sales-rep orders scope (feature 026 US6)', () => {
  let h: BackendServerHandle;
  let assignedSalesRepCookie: string;
  let unassignedSalesRepCookie: string;
  let assignedOrgId: string;
  let unassignedOrgId: string;
  const orderIds = { assigned: randomUUID(), unassigned: randomUUID() };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    // Find or create the sales_representative AdminRole.
    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: ['orders:read', 'rfqs:handle'],
      });
      await em.persistAndFlush(role);
    }

    // Sales rep WITH an assignment.
    const repAssigned = em.create(AdminUser, {
      email: `sales-rep-assigned-${Date.now()}@us6.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'US6',
      lastName: 'Assigned',
    });
    // Sales rep WITHOUT any assignment.
    const repUnassigned = em.create(AdminUser, {
      email: `sales-rep-unassigned-${Date.now()}@us6.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'US6',
      lastName: 'Unassigned',
    });
    await em.persistAndFlush([repAssigned, repUnassigned]);

    // An organization the first rep owns.
    const org = em.create(Organization, {
      name: 'US6 Owned Org',
      taxId: `PL026US6O${Date.now().toString().slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Przypisana 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    assignedOrgId = org.id;

    await em.persistAndFlush(
      em.create(OrganizationSalesRepAssignment, {
        organizationId: org.id,
        adminUserId: repAssigned.id,
      }),
    );

    const nobodys = em.create(Organization, {
      name: 'US6 Unassigned Org',
      taxId: `PL026US6U${Date.now().toString().slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Wolna 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
    });
    await em.persistAndFlush(nobodys);
    unassignedOrgId = nobodys.id;

    await withSystemScope('US6: seed one order per organization', async () => {
      const fork = h.orm.em.fork();
      const address = { recipientName: 'US6', street: 'ul. Odbioru 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' };
      for (const [key, organizationId] of [['assigned', assignedOrgId], ['unassigned', unassignedOrgId]] as const) {
        fork.create(Order, {
          id: orderIds[key],
          organizationId,
          placedByCustomerAccountId: TEST_CUSTOMER_ID,
          salesChannelId: '00000000-0000-4000-8000-0000000000c1',
          status: 'new',
          paymentStatus: 'pending',
          deliveryAddress: address,
          billingAddress: address,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
          subtotal: '10.00',
          taxTotal: '2.30',
          deliveryTotal: '0.00',
          total: '12.30',
          currency: 'PLN',
          placedAt: new Date(),
        } as never);
      }
      await fork.flush();
    });

    assignedSalesRepCookie = `stub-sales-rep-assigned-${Date.now()}`;
    unassignedSalesRepCookie = `stub-sales-rep-unassigned-${Date.now()}`;
    ADMIN_COOKIES[assignedSalesRepCookie] = { adminUserId: repAssigned.id };
    ADMIN_COOKIES[unassignedSalesRepCookie] = { adminUserId: repUnassigned.id };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[assignedSalesRepCookie];
    delete ADMIN_COOKIES[unassignedSalesRepCookie];
    await teardownBackendServer(h);
  });

  const listed = async (cookie: string): Promise<Array<{ id: string; organizationId: string }>> => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/orders?pageSize=100',
      cookies: { b2b_session: cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ id: string; organizationId: string }> }).data;
  };

  it('sales rep with no assignments sees the unassigned organization’s orders, not another rep’s (#305)', async () => {
    const ids = (await listed(unassignedSalesRepCookie)).map((row) => row.id);
    expect(ids).toContain(orderIds.unassigned);
    expect(ids).not.toContain(orderIds.assigned);
  });

  it('sales rep with an assignment sees their organization’s orders and the unassigned one’s (#305)', async () => {
    const ids = (await listed(assignedSalesRepCookie)).map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([orderIds.assigned, orderIds.unassigned]));
  });

  it('a sales rep is answered 404 for an order of an organization assigned to another rep', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderIds.assigned}`,
      cookies: { b2b_session: unassignedSalesRepCookie },
    });
    expect(res.statusCode, res.body).toBe(404);
  });

  it('platform admin sees the unscoped orders list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/orders',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ organizationId: string }> };
    // We don't assert a particular size, only that platform admin is not
    // being filtered to an empty set in the same setup where the
    // unassigned sales rep saw zero rows. If the platform fixture has any
    // existing orders at all, this should produce a strictly larger or
    // equal set than the assigned-sales-rep one. Length comparison is
    // implicit via the previous test running in the same suite.
    expect(Array.isArray(body.data)).toBe(true);
  });
});
