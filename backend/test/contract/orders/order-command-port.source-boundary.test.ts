import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { Order } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `specs/186-aggregate-ports/` R-4, R-18.2 — the trust boundary of an order
 * entry's `source`.
 *
 * The buyer-cancellation predicate (`domain/status-authorship.ts`) reads
 * `stateAfter.source === 'payment'` as "the payment ingress wrote this hold",
 * and that answer lets a buyer cancel. It is safe only because `source` is set
 * by server-side callers of `orderCommandPort` and by nothing an HTTP request
 * carries. This holds it for the routes that write a status, a payment status
 * or a comment entry — the admin status, bulk status, payment-status and
 * comment routes, and the buyer's comment and cancel routes: each is sent a
 * `source` in the body, the query string and request headers, plus a spoofed
 * extension, and the entry it records carries none. The route schemas strip
 * unknown body keys rather than refusing them, so the assertion is on the
 * recorded entry.
 *
 * Not covered here: `PATCH /api/v1/admin/orders/:id/custom-fields`, whose body
 * is the values bag itself (a `source` key there is a custom-field key, judged
 * by the field definitions), and the assistant's status tool, which takes no
 * free parameters beyond the status and reason. Both reach the Command with no
 * caller options, as the routes above do. External references have no HTTP
 * route (integration only, through the port).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ORDERS = '/api/v1/admin/orders';
const SPOOF = { source: 'payment' } as const;

describe('order entries’ source cannot come from HTTP input (#1823)', () => {
  let h: BackendServerHandle;

  async function seedOrder(over: Partial<Order> = {}): Promise<Order> {
    const em = h.em().fork();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: randomUUID(),
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer', adapter: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
      ...over,
    });
    await em.persist(order).flush();
    return order;
  }

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'order', objectId }, { orderBy: { actedAt: 'asc' } });

  /** Sends the write with `source` in the body, the query string and headers; answers the status code. */
  async function send(cookies: Record<string, string>, url: string, body: Record<string, unknown>): Promise<number> {
    const res = await h.app.inject({
      method: 'POST',
      url: `${url}?source=payment`,
      cookies,
      headers: { source: 'payment', 'x-source': 'payment', 'x-command-source': 'payment' },
      payload: { ...body, ...SPOOF, extensions: { attacker: SPOOF } },
    });
    return res.statusCode;
  }

  /** The order's entries for `action`, each read for the key the predicate trusts. */
  async function recordedSources(orderId: string, action: string): Promise<unknown[]> {
    const found = (await entries(orderId)).filter((entry) => entry.action === action);
    expect(found.length, `no ${action} entry was recorded`).toBeGreaterThan(0);
    return found.map((entry) => (entry.stateAfter as Record<string, unknown> | null)?.['source'] ?? null);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('POST /api/v1/admin/orders/:id/status records no source', async () => {
    const order = await seedOrder();
    expect(await send(ADMIN, `${ORDERS}/${order.id}/status`, { to: 'paid' })).toBe(200);
    expect(await recordedSources(order.id, 'order.status_transition')).toEqual([null]);
  });

  it('POST /api/v1/admin/orders/bulk/status records no source', async () => {
    const order = await seedOrder();
    expect(await send(ADMIN, `${ORDERS}/bulk/status`, { orderIds: [order.id], toStatusCode: 'paid' })).toBe(200);
    expect(await recordedSources(order.id, 'order.status_transition')).toEqual([null]);
  });

  it('POST /api/v1/admin/orders/:id/payment-status records no source', async () => {
    const order = await seedOrder();
    expect(await send(ADMIN, `${ORDERS}/${order.id}/payment-status`, { to: 'paid' })).toBe(200);
    expect(await recordedSources(order.id, 'order.payment_status_transition')).toEqual([null]);
  });

  it('POST /api/v1/admin/orders/:id/comments records no source', async () => {
    const order = await seedOrder();
    expect(
      await send(ADMIN, `${ORDERS}/${order.id}/comments`, { body: 'hello', isCustomerVisible: false, notifyCustomer: false }),
    ).toBe(201);
    expect(await recordedSources(order.id, 'order.comment.add')).toEqual([null]);
  });

  it('the buyer’s comment and cancellation record no source', async () => {
    const order = await seedOrder();
    expect(await send(CUSTOMER, `/api/v1/orders/${order.id}/comments`, { body: 'a question' })).toBe(201);
    expect(await send(CUSTOMER, `/api/v1/orders/${order.id}/cancel`, {})).toBe(200);

    expect(await recordedSources(order.id, 'order.comment.add')).toEqual([null]);
    expect(await recordedSources(order.id, 'order.status_transition')).toEqual([null]);
  });
});
