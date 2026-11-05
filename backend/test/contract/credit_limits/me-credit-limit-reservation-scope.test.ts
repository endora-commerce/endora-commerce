import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  assignOrganizationRole,
  predefinedRoleIdOf,
  seedCustomOrganizationRole,
} from '../../helpers/seed-organization-roles.js';
import { CreditLimit, CreditLimitReservation, Order } from '../../helpers/package-entities.js';

/**
 * Issue #748 — `GET /api/v1/me/credit-limit` lists only the reservations of
 * orders the caller may read (`specs/170-organization-roles/` FR-049): a member
 * whose role lacks `orders.view_organization` sees the reservations of the
 * orders they placed, a holder (and the *Administrator*) every reservation of
 * the limit. The totals stay the Organization's whatever the list holds: the
 * limit is shared, so the member needs them to know what they can spend.
 *
 * Accounts are this file's own, in `TEST_ORGANIZATION_ID`, behind cookies of
 * their own: `plain` (Member), `viewer` (a custom role holding only
 * `orders.view_organization`), and the stub customer (Administrator).
 */

interface View {
  grantedAmount: number;
  availableAmount: number;
  activeReservationCount: number;
  activeReservations: Array<{ orderId: string; amount: number; createdAt: string }>;
}

async function seedOrder(
  em: EntityManager,
  placedByCustomerAccountId: string,
  salesChannelId: string,
  total: string,
): Promise<string> {
  const order = em.create(Order, {
    organizationId: TEST_ORGANIZATION_ID,
    placedByCustomerAccountId,
    salesChannelId,
    status: 'processing',
    paymentStatus: 'deferred',
    deliveryAddress: { recipientName: 'C', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'C', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'credit_limit', name: 'CL', kind: 'credit_limit' },
    subtotal: total,
    taxTotal: '0.00',
    deliveryTotal: '0.00',
    total,
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  return order.id;
}

describe('GET /api/v1/me/credit-limit — reservation list scope (issue #748)', () => {
  let h: BackendServerHandle;
  const cookies: string[] = [];
  const orders = { plain: '', colleague: '' };
  let plainCookie: Record<string, string>;
  let viewerCookie: Record<string, string>;
  const adminCookie = { b2b_session: 'stub-customer-session' };

  async function member(roleId: string, label: string): Promise<{ id: string; cookies: Record<string, string> }> {
    const id = randomUUID();
    await h.em().getConnection().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Credit', ?, now(), now())`,
      [id, TEST_ORGANIZATION_ID, `${label}-${id.slice(0, 8)}@credit-scope.example`, label],
    );
    await assignOrganizationRole(h.em(), id, roleId);
    const cookie = `stub-748-${label}-${id.slice(0, 8)}`;
    CUSTOMER_COOKIES[cookie] = { customerAccountId: id, organizationId: TEST_ORGANIZATION_ID };
    cookies.push(cookie);
    return { id, cookies: { b2b_session: cookie } };
  }

  async function view(as: Record<string, string>): Promise<View> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/me/credit-limit', cookies: as });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: View }).data;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const plain = await member(await predefinedRoleIdOf(em, TEST_ORGANIZATION_ID, 'member'), 'plain');
    const viewer = await member(
      await seedCustomOrganizationRole(em, {
        organizationId: TEST_ORGANIZATION_ID,
        permissions: ['orders.view_organization'],
      }),
      'viewer',
    );
    plainCookie = plain.cookies;
    viewerCookie = viewer.cookies;

    const channel = await systemDefaultSalesChannelId(em);
    orders.plain = await seedOrder(em, plain.id, channel, '300.00');
    orders.colleague = await seedOrder(em, TEST_CUSTOMER_ID, channel, '1200.00');

    const limit = em.create(CreditLimit, {
      organizationId: TEST_ORGANIZATION_ID,
      grantedAmount: '10000.00',
      currency: 'PLN',
    });
    await em.persistAndFlush(limit);
    for (const [orderId, amount] of [
      [orders.plain, '300.00'],
      [orders.colleague, '1200.00'],
    ] as const) {
      em.create(CreditLimitReservation, {
        creditLimitId: limit.id,
        orderId,
        reservingOrganizationId: TEST_ORGANIZATION_ID,
        amount,
        currency: 'PLN',
        status: 'active',
      });
    }
    await em.flush();
  });

  afterAll(async () => {
    for (const cookie of cookies) delete CUSTOMER_COOKIES[cookie];
    await teardownBackendServer(h);
  });

  it('a member without orders.view_organization sees only their own reservation, with Organization-wide totals', async () => {
    const data = await view(plainCookie);
    expect(data.activeReservations.map((r) => r.orderId)).toEqual([orders.plain]);
    expect(data.activeReservations[0]?.amount).toBe(300);
    expect(data.activeReservations.map((r) => r.orderId)).not.toContain(orders.colleague);
    expect(data.grantedAmount).toBe(10000);
    expect(data.availableAmount).toBe(8500);
    expect(data.activeReservationCount).toBe(2);
  });

  it('a holder of orders.view_organization sees every reservation of the limit', async () => {
    const data = await view(viewerCookie);
    expect(data.activeReservations.map((r) => r.orderId).sort()).toEqual(
      [orders.plain, orders.colleague].sort(),
    );
    expect(data.availableAmount).toBe(8500);
    expect(data.activeReservationCount).toBe(2);
  });

  it('the Administrator sees every reservation of the limit', async () => {
    const data = await view(adminCookie);
    expect(data.activeReservations).toHaveLength(2);
    expect(data.availableAmount).toBe(8500);
    expect(data.activeReservationCount).toBe(2);
  });
});
