import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { AdminRole } from '../../../src/modules/admin_roles/entities/admin-role.entity.js';
import { OrganizationSalesRepAssignment } from '../../../src/modules/organizations/entities/organization-sales-rep-assignment.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { OrderComment } from '../../../src/modules/orders/entities/order-comment.entity.js';
import { Invoice } from '../../../src/modules/invoices/entities/invoice.entity.js';
import { ADMIN_COOKIES, TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

/**
 * Feature 085 Phase E — the assignment scope on the admin order routes.
 *
 * The list and the export intersect their query with the scope resolved by
 * `resolveAdminOrdersScope`; the status-write routes name it nowhere. That
 * reads as read-scoped/write-unscoped, and the reason it is not is worth an
 * executable statement rather than a reading of the tree: the request-scope
 * hook builds the request's `TenantContext` from the *same* resolver, `Order`
 * is `@OrgScoped`, and the transition service loads the order through a
 * filtered EntityManager — so a scoped admin holding `orders:write` is refused
 * on an order outside their assignments before any transition is attempted.
 *
 * These tests hold that guarantee where it can be broken: a transition seam
 * that reads through `getKnex()`, or one that widens with `withSystemScope`,
 * would take it away with nothing else in the tree noticing.
 *
 * The refusal is 404 `ORDER_NOT_FOUND`, not 403 — the answer the customer
 * surface already documents (`OrderService.#scopedOrderWhere`: "out-of-scope
 * reads return no rows and the caller raises 404, never 403, to avoid leaking
 * existence") and the one the list gives by omitting the row.
 *
 * Two routes did have the gap for real, both reaching an order's children
 * rather than the order: `order_comments` is a global entity and `invoices` is
 * scoped transitively through `Order`, so neither carries a filter and a read
 * keyed on `orderId` alone answered for every order on the platform.
 *
 * Every assertion runs in both directions. A scope check that refuses
 * everybody passes the out-of-scope half on its own.
 */
describe('Admin order routes honour the sales-rep assignment scope (feature 085 Phase E)', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  let assignedOrgId: string;
  let foreignOrgId: string;

  const orders: Record<string, string> = {};
  const invoiceNumbers: Record<string, string> = {};

  const salesChannelId = '00000000-0000-4000-8000-0000000000c1';
  const stamp = Date.now();

  const newOrder = (em: EntityManager, organizationId: string): Order =>
    em.create(Order, {
      organizationId,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId,
      status: 'new',
      paymentStatus: 'awaiting_payment',
      deliveryAddress: {
        recipientName: 'Phase E',
        street: 'ul. Zakresu 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'Phase E',
        street: 'ul. Zakresu 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
      deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
      deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
      paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
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
      taxId: `PL085E${suffix}${String(stamp).slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Zakresu 1',
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
    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: ['orders:read', 'orders:write'],
      });
    } else {
      role.permissions = Array.from(new Set([...role.permissions, 'orders:read', 'orders:write']));
    }
    await em.persistAndFlush(role);

    const rep = em.create(AdminUser, {
      email: `phase-e-rep-${stamp}@085.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Phase',
      lastName: 'E',
    });
    const assigned = newOrganization(em, 'Phase E assigned org', 'A');
    const foreign = newOrganization(em, 'Phase E foreign org', 'F');
    await em.persistAndFlush([rep, assigned, foreign]);
    assignedOrgId = assigned.id;
    foreignOrgId = foreign.id;

    await em.persistAndFlush(
      em.create(OrganizationSalesRepAssignment, {
        organizationId: assignedOrgId,
        adminUserId: rep.id,
      }),
    );

    // One pair per route under test, so no assertion depends on a transition an
    // earlier assertion applied.
    const keys = [
      'ownStatus',
      'foreignStatus',
      'ownBulk',
      'foreignBulk',
      'ownComment',
      'foreignComment',
      'ownInvoice',
      'foreignInvoice',
      'platformAdminForeign',
    ] as const;
    const rows = keys.map((key) =>
      newOrder(em, key.startsWith('own') ? assignedOrgId : foreignOrgId),
    );
    await em.persistAndFlush(rows);
    keys.forEach((key, i) => {
      orders[key] = rows[i]!.id;
    });

    for (const key of ['ownComment', 'foreignComment'] as const) {
      await em.persistAndFlush(
        em.create(OrderComment, {
          orderId: orders[key]!,
          authorAdminUserId: null,
          authorCustomerAccountId: null,
          body: `internal note (${key})`,
          isCustomerVisible: false,
          notifyCustomer: false,
        }),
      );
    }

    for (const key of ['ownInvoice', 'foreignInvoice'] as const) {
      const number = `FV/085E/${key}/${stamp}`;
      invoiceNumbers[key] = number;
      await em.persistAndFlush(
        em.create(Invoice, {
          orderId: orders[key]!,
          kind: 'invoice',
          number,
          currency: 'PLN',
          total: '12.30',
          status: 'ready',
        }),
      );
    }

    repCookie = `stub-phase-e-rep-${stamp}`;
    ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[repCookie];
    await teardownBackendServer(h);
  });

  const statusOf = async (orderId: string): Promise<string | null> => {
    const row = await h.em().findOne(Order, { id: orderId });
    return row?.status ?? null;
  };

  it('refuses a status write on an order outside the scope, as not found', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orders['foreignStatus']}/status`,
      payload: { to: 'on_hold' },
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.ORDER_NOT_FOUND);
    expect(await statusOf(orders['foreignStatus']!)).toBe('new');
  });

  it('still applies a status write on an order inside the scope', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orders['ownStatus']}/status`,
      payload: { to: 'on_hold' },
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string } };
    expect(body.data.status).toBe('on_hold');
    expect(await statusOf(orders['ownStatus']!)).toBe('on_hold');
  });

  it('applies a bulk status change per item and reports the out-of-scope member as skipped', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/bulk/status',
      payload: {
        orderIds: [orders['ownBulk'], orders['foreignBulk']],
        toStatusCode: 'on_hold',
      },
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { changed: string[]; skipped: Array<{ orderId: string; reason: string }> };
    };
    // The response shape says which half happened: the in-scope order is in
    // `changed`, the refused one is named in `skipped` with a reason. Nothing
    // is silently dropped, and the reason is the one a nonexistent order gets,
    // so the batch does not become an existence oracle either.
    expect(body.data.changed).toEqual([orders['ownBulk']]);
    expect(body.data.skipped).toEqual([{ orderId: orders['foreignBulk'], reason: 'not_found' }]);
    expect(await statusOf(orders['ownBulk']!)).toBe('on_hold');
    expect(await statusOf(orders['foreignBulk']!)).toBe('new');
  });

  it('refuses the comment thread of an order outside the scope, and serves the one inside it', async () => {
    const refused = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orders['foreignComment']}/comments`,
      cookies: { b2b_session: repCookie },
    });
    expect(refused.statusCode).toBe(404);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ORDER_NOT_FOUND,
    );
    expect(refused.body).not.toContain('internal note (foreignComment)');

    const served = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orders['ownComment']}/comments`,
      cookies: { b2b_session: repCookie },
    });
    expect(served.statusCode).toBe(200);
    const body = served.json() as { data: Array<{ body: string }> };
    expect(body.data.map((c) => c.body)).toContain('internal note (ownComment)');
  });

  it('prints only the invoices of orders inside the scope', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/bulk/print-invoices',
      payload: { orderIds: [orders['ownInvoice'], orders['foreignInvoice']] },
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
    const pdf = res.rawPayload.toString('latin1');
    expect(pdf).toContain(invoiceNumbers['ownInvoice']!);
    expect(pdf).not.toContain(invoiceNumbers['foreignInvoice']!);
  });

  it('leaves the platform admin unscoped on every one of those routes', async () => {
    const status = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orders['platformAdminForeign']}/status`,
      payload: { to: 'on_hold' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(status.statusCode).toBe(200);
    expect(await statusOf(orders['platformAdminForeign']!)).toBe('on_hold');

    const bulk = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/bulk/status',
      payload: { orderIds: [orders['foreignBulk']], toStatusCode: 'on_hold' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(bulk.statusCode).toBe(200);
    expect((bulk.json() as { data: { changed: string[] } }).data.changed).toEqual([
      orders['foreignBulk'],
    ]);

    const comments = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orders['foreignComment']}/comments`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(comments.statusCode).toBe(200);
    expect(
      (comments.json() as { data: Array<{ body: string }> }).data.map((c) => c.body),
    ).toContain('internal note (foreignComment)');

    const printed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/bulk/print-invoices',
      payload: { orderIds: [orders['ownInvoice'], orders['foreignInvoice']] },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(printed.statusCode).toBe(200);
    const pdf = printed.rawPayload.toString('latin1');
    expect(pdf).toContain(invoiceNumbers['ownInvoice']!);
    expect(pdf).toContain(invoiceNumbers['foreignInvoice']!);
  });

  it('keeps the two organizations distinct in the fixture', () => {
    // Guards the whole file: if the seed put both orders in one organization,
    // every refusal above would be vacuous.
    expect(assignedOrgId).not.toBe(foreignOrgId);
  });
});
