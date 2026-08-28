import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminRole, AdminUser, Organization, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';
import { ReturnCase, ReturnCaseComment, ReturnShipment, Shipment } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES, TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

/**
 * The children of an `@OrgScoped` aggregate, read through the assignment
 * scope — the sibling of `admin-write-scope.test.ts`, which holds the same
 * property for the order's comment thread and its invoice.
 *
 * `Payment`, `Shipment`, `ReturnShipment` and `ReturnCaseComment` are all
 * `@GlobalEntity`: they carry no organization column and no filter of their
 * own, so a read keyed on the parent's id alone answers for every order — or
 * every return case — on the platform. `Order` and `ReturnCase` are
 * `@OrgScoped`, so the platform's answer for these routes is entirely whatever
 * the handler does *before* it reaches the child: load the parent through a
 * filtered EntityManager, or nothing.
 *
 * A permission is not a tenant gate. A `sales_representative` holding
 * `catalog:read` is an administrator of the organizations they are assigned to
 * and of no others; `requireAdmin` cannot express that, and the scope resolver
 * that can is only consulted through the filter on `Order`.
 *
 * Every assertion runs in both directions, because a guard that refuses
 * everybody passes the out-of-scope half on its own. The refusal is 404 rather
 * than 403, matching what the order-keyed routes in `orders` already give: an
 * out-of-scope order must not be distinguishable from one that does not exist.
 */
describe('Admin child-aggregate routes honour the sales-rep assignment scope', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  let assignedOrgId: string;
  let foreignOrgId: string;

  const orders: Record<string, string> = {};
  const returnCases: Record<string, string> = {};
  const returnShipments: Record<string, string> = {};
  const salesChannelId = '00000000-0000-4000-8000-0000000000c1';
  const deliveryMethodId = '00000000-0000-4000-8000-0000000000e1';
  const paymentMethodId = '00000000-0000-4000-8000-0000000000f1';
  const stamp = Date.now();

  const newOrder = (em: EntityManager, organizationId: string): Order =>
    em.create(Order, {
      organizationId,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId,
      status: 'new',
      paymentStatus: 'awaiting_payment',
      deliveryAddress: {
        recipientName: 'Child scope',
        street: 'ul. Dziecka 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'Child scope',
        street: 'ul. Dziecka 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
      deliveryMethodId,
      deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
      paymentMethodId,
      paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '2.30',
      deliveryTotal: '0.00',
      total: '12.30',
      currency: 'PLN',
      placedAt: new Date(),
    });

  const newOrganization = (em: EntityManager, name: string, suffix: string): Organization =>
    em.create(Organization, {
      name,
      taxId: `PLCHILD${suffix}${String(stamp).slice(-6)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Dziecka 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    // `resolveAdminOrdersScope` keys on this exact role code, so the fixture
    // cannot use a code of its own. Another file in the run may have created it
    // already with a narrower grant set — widen that one rather than creating a
    // second row the unique index would refuse.
    // Every code the routes under test enforce, so a refusal here is the
    // *scope's* answer and never the permission gate's. The two payment routes
    // moved from `catalog:*` to `payments:*` when `payments` took ownership of
    // its own authority; the file is about tenant scope, so it grants whatever
    // the gates ask for.
    const grants = [
      'orders:read',
      'orders:write',
      'catalog:read',
      'catalog:write',
      'payments:read',
      'payments:write',
      'returns:read',
      'returns:write',
    ];
    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: grants,
      });
    } else {
      role.permissions = Array.from(new Set([...role.permissions, ...grants]));
    }
    await em.persistAndFlush(role);

    const rep = em.create(AdminUser, {
      email: `child-scope-rep-${stamp}@audit.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Child',
      lastName: 'Scope',
    });
    const assigned = newOrganization(em, 'Child scope assigned org', 'A');
    const foreign = newOrganization(em, 'Child scope foreign org', 'F');
    await em.persistAndFlush([rep, assigned, foreign]);
    assignedOrgId = assigned.id;
    foreignOrgId = foreign.id;

    await em.persistAndFlush(
      em.create(OrganizationSalesRepAssignment, {
        organizationId: assignedOrgId,
        adminUserId: rep.id,
      }),
    );

    // One pair per route, so no assertion depends on a row an earlier assertion
    // created (the retry route writes).
    const keys = [
      'ownPayments',
      'foreignPayments',
      'ownRetry',
      'foreignRetry',
      'ownShipments',
      'foreignShipments',
      'ownReturn',
      'foreignReturn',
    ] as const;
    const rows = keys.map((key) =>
      newOrder(em, key.startsWith('own') ? assignedOrgId : foreignOrgId),
    );
    await em.persistAndFlush(rows);
    keys.forEach((key, i) => {
      orders[key] = rows[i]!.id;
    });

    for (const key of ['ownPayments', 'foreignPayments', 'ownRetry', 'foreignRetry'] as const) {
      await em.persistAndFlush(
        em.create(Payment, {
          orderId: orders[key]!,
          paymentMethodId,
          // `failed` so the retry route has something to open the next attempt
          // against; `externalReference` is the commercially sensitive figure
          // the read assertion looks for.
          status: 'failed',
          amount: '12.30',
          currency: 'PLN',
          externalReference: `PSP-REF-${key}-${stamp}`,
        }),
      );
    }

    for (const key of ['ownShipments', 'foreignShipments'] as const) {
      await em.persistAndFlush(
        em.create(Shipment, {
          orderId: orders[key]!,
          deliveryMethodId,
          status: 'success',
          externalReference: `TRACK-${key}-${stamp}`,
        }),
      );
    }

    // The second `@OrgScoped` aggregate with `@GlobalEntity` children, and the
    // one whose admin surface reaches them keyed on the case id alone.
    for (const key of ['ownReturn', 'foreignReturn'] as const) {
      const rc = em.create(ReturnCase, {
        kind: 'return',
        orderId: orders[key]!,
        salesChannelId,
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: key.startsWith('own') ? assignedOrgId : foreignOrgId,
        statusCode: 'authorized',
        currency: 'PLN',
        submittedAt: new Date(),
      });
      await em.persistAndFlush(rc);
      returnCases[key] = rc.id;

      const shipment = em.create(ReturnShipment, {
        returnCaseId: rc.id,
        direction: 'inbound',
        externalReference: `RMA-TRACK-${key}-${stamp}`,
        status: 'pending',
      });
      const comment = em.create(ReturnCaseComment, {
        returnCaseId: rc.id,
        authorAdminUserId: null,
        authorCustomerAccountId: null,
        body: `internal return note (${key}) ${stamp}`,
        isCustomerVisible: false,
        notifyCustomer: false,
      });
      await em.persistAndFlush([shipment, comment]);
      returnShipments[key] = shipment.id;
    }

    repCookie = `stub-child-scope-rep-${stamp}`;
    ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[repCookie];
    await teardownBackendServer(h);
  });

  const attemptCount = async (orderId: string): Promise<number> =>
    h.em().count(Payment, { orderId });

  it('refuses the payment history of an order outside the scope, and serves the one inside it', async () => {
    const refused = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orders['foreignPayments']}/payments`,
      cookies: { b2b_session: repCookie },
    });
    expect(refused.statusCode).toBe(404);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ORDER_NOT_FOUND,
    );
    expect(refused.body).not.toContain(`PSP-REF-foreignPayments-${stamp}`);

    const served = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orders['ownPayments']}/payments`,
      cookies: { b2b_session: repCookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain(`PSP-REF-ownPayments-${stamp}`);
  });

  it('refuses a payment retry on an order outside the scope, and opens one inside it', async () => {
    const before = await attemptCount(orders['foreignRetry']!);
    const refused = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orders['foreignRetry']}/payments/retry`,
      cookies: { b2b_session: repCookie },
    });
    expect(refused.statusCode).toBe(404);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ORDER_NOT_FOUND,
    );
    // The write half: a refusal that still inserted the row is not a refusal.
    expect(await attemptCount(orders['foreignRetry']!)).toBe(before);

    const opened = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orders['ownRetry']}/payments/retry`,
      cookies: { b2b_session: repCookie },
    });
    expect(opened.statusCode).toBe(201);
    expect(await attemptCount(orders['ownRetry']!)).toBe(2);
  });

  it('refuses the shipment history of an order outside the scope, and serves the one inside it', async () => {
    const refused = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orders['foreignShipments']}/shipments`,
      cookies: { b2b_session: repCookie },
    });
    expect(refused.statusCode).toBe(404);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ORDER_NOT_FOUND,
    );
    expect(refused.body).not.toContain(`TRACK-foreignShipments-${stamp}`);

    const served = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orders['ownShipments']}/shipments`,
      cookies: { b2b_session: repCookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain(`TRACK-ownShipments-${stamp}`);
  });

  it('refuses the shipment list of a return case outside the scope, and serves the one inside it', async () => {
    const refused = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/returns/${returnCases['foreignReturn']}/shipments`,
      cookies: { b2b_session: repCookie },
    });
    expect(refused.statusCode).toBe(404);
    expect(refused.body).not.toContain(`RMA-TRACK-foreignReturn-${stamp}`);

    const served = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/returns/${returnCases['ownReturn']}/shipments`,
      cookies: { b2b_session: repCookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain(`RMA-TRACK-ownReturn-${stamp}`);
  });

  const shipmentStatus = async (id: string): Promise<string | null> =>
    (await h.em().findOne(ReturnShipment, { id }))?.status ?? null;

  it('refuses receiving a return shipment on a case outside the scope, writing nothing', async () => {
    const refused = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${returnCases['foreignReturn']}/shipments/${returnShipments['foreignReturn']}/receive`,
      cookies: { b2b_session: repCookie },
    });
    expect(refused.statusCode).toBe(404);
    // The row was flushed `received` before the case transition refused, so a
    // status assertion is the half a status code cannot see.
    expect(await shipmentStatus(returnShipments['foreignReturn']!)).toBe('pending');

    const accepted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${returnCases['ownReturn']}/shipments/${returnShipments['ownReturn']}/receive`,
      cookies: { b2b_session: repCookie },
    });
    expect(accepted.statusCode).toBe(200);
    expect(await shipmentStatus(returnShipments['ownReturn']!)).toBe('received');
  });

  it('refuses the comment thread of a return case outside the scope, and serves the one inside it', async () => {
    const refused = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/returns/${returnCases['foreignReturn']}/comments`,
      cookies: { b2b_session: repCookie },
    });
    expect(refused.statusCode).toBe(404);
    expect(refused.body).not.toContain(`internal return note (foreignReturn) ${stamp}`);

    const served = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/returns/${returnCases['ownReturn']}/comments`,
      cookies: { b2b_session: repCookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain(`internal return note (ownReturn) ${stamp}`);
  });

  it('leaves a platform administrator reaching every order, in both organizations', async () => {
    for (const key of ['ownPayments', 'foreignPayments'] as const) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/orders/${orders[key]}/payments`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(`PSP-REF-${key}-${stamp}`);
    }
  });
});
