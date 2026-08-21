import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';

/**
 * Feature 085 Phase G (User Story 4, FR-021) — the administrator can find the
 * orders that are stuck.
 *
 * The admin orders list could filter on status, sales channel, payment method,
 * delivery method, organisation, free text, dates and totals — and on nothing
 * at all on the money axis. After this feature a platform administrator is the
 * only actor who can rescue a held order whose buyer cannot, so a screen that
 * cannot answer "which orders have a failed payment?" is the stock leak with
 * extra steps.
 *
 * The `on_hold` bucket now carries two different situations — a failed payment
 * and a full refund — so the filter is also what makes them tellable apart
 * without opening either (FR-023).
 *
 * Every assertion is scoped to this file's own organisation id, because the
 * suite shares one database and the list is unscoped for a platform admin.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

interface ListBody {
  data: Array<{ id: string; paymentStatus: string; status: string }>;
  pagination: { total: number };
  counts?: Record<string, number>;
  paymentStatusCounts?: Record<string, number>;
}

describe('admin orders list — payment-status filter (085 Phase G)', () => {
  let h: BackendServerHandle;
  const organizationId = randomUUID();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    ids['heldFailed'] = (await seed(em, 'on_hold', 'failed')).id;
    ids['heldRefunded'] = (await seed(em, 'on_hold', 'refunded')).id;
    ids['newAwaiting'] = (await seed(em, 'new', 'awaiting_payment')).id;
    ids['paidPaid'] = (await seed(em, 'paid', 'paid')).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seed(em: EntityManager, status: string, paymentStatus: string): Promise<Order> {
    const order = em.create(Order, {
      organizationId,
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      status,
      paymentStatus: paymentStatus as Order['paymentStatus'],
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '100.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '100.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    return order;
  }

  async function list(query: string): Promise<ListBody> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders?organizationId=${organizationId}&${query}`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as ListBody;
  }

  /** US4 scenario 1 — the question the screen could not ask. */
  it('finds the order with a failed payment, and only it', async () => {
    const body = await list('paymentStatus=failed');

    expect(body.data.map((o) => o.id)).toEqual([ids['heldFailed']]);
    expect(body.pagination.total).toBe(1);
  });

  /**
   * FR-023 / US4 scenario 3 — two orders at the same lifecycle status, told
   * apart on the money axis alone. Both are `on_hold`; one is held because a
   * payment failed and one because it was fully refunded.
   */
  it('separates a payment-failed hold from a refund hold at the same status', async () => {
    const held = await list('status=on_hold');
    expect(held.data.map((o) => o.id).sort()).toEqual(
      [ids['heldFailed']!, ids['heldRefunded']!].sort(),
    );

    const failedHold = await list('status=on_hold&paymentStatus=failed');
    expect(failedHold.data.map((o) => o.id)).toEqual([ids['heldFailed']]);
  });

  it('accepts repeated values, as every other multi-select filter does', async () => {
    const body = await list('paymentStatus=failed&paymentStatus=refunded');
    expect(body.data.map((o) => o.id).sort()).toEqual(
      [ids['heldFailed']!, ids['heldRefunded']!].sort(),
    );
  });

  it('refuses a value the money axis does not have', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders?organizationId=${organizationId}&paymentStatus=not_a_status`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(400);
  });

  /**
   * The counts, and why they are a second map. `paid` is a shipped **order
   * status** code as well as a payment status: this fixture has one order at
   * status `paid` and one order with paymentStatus `paid`, and they are
   * different rows. One merged map would report `paid: 2` and mean nothing.
   */
  it('counts the money axis separately from the lifecycle axis', async () => {
    const body = await list('');

    expect(body.counts).toMatchObject({ on_hold: 2, new: 1, paid: 1 });
    expect(body.paymentStatusCounts).toMatchObject({
      failed: 1,
      refunded: 1,
      awaiting_payment: 1,
      paid: 1,
    });
  });

  /**
   * Each axis's counts are taken over every filter but its own, so an option's
   * number says what selecting it would yield. Selecting `on_hold` leaves the
   * status counts untouched (that is the pre-085 behaviour of this map) and
   * narrows the payment counts to the two held orders.
   */
  it('computes each axis over the other axis filter', async () => {
    const body = await list('status=on_hold');

    expect(body.counts).toMatchObject({ on_hold: 2, new: 1, paid: 1 });
    expect(body.paymentStatusCounts).toEqual({ failed: 1, refunded: 1 });
  });

  it('carries the filter into the CSV export unchanged', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/export?organizationId=${organizationId}&paymentStatus=failed`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-export-row-count']).toBe('1');
    expect(res.body).toContain('failed');
  });
});
