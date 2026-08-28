import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
  seedOrdersForInvoiceTests,
} from '../../helpers/seed-commerce.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { OrderReadService } from '../../../../packages/modules/orders/dist/backend/services/order-read-port.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 080, T048 (D-169) — `OrderReadPort.salesChannelIdsForCustomer`.
 *
 * `customers` renders, on the customer-detail header, the sales channels a
 * buyer has ordered on. It answered that with `em.find(Order, {
 * placedByCustomerAccountId }, { fields: ['salesChannelId'] })` from inside its
 * own module — a plain read of another module's table, and the last site in
 * that module naming an `orders` entity.
 *
 * `OrderListPort.list` cannot answer it: it is paginated, so the channels it
 * yields are the channels on one page, and a detail header that narrowed with
 * the page size would be a different fact under the same label. So the owner
 * publishes the read: **distinct** channel ids across every one of that
 * customer's orders, newest order first.
 *
 * The three properties asserted here are the ones the consumer leans on:
 * distinctness (the consumer used to dedupe and no longer does), completeness
 * across pages, and an empty answer — never every channel — for a customer
 * with no orders.
 */
describe('OrderReadPort.salesChannelIdsForCustomer', () => {
  let h: BackendServerHandle;
  let port: OrderReadService;
  let channelA: string;
  let channelB: string;

  const orderOn = (salesChannelId: string, placedAt: Date, customerId: string): Order =>
    h.em().create(Order, {
      id: randomUUID(),
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: customerId,
      salesChannelId,
      status: 'paid',
      paymentStatus: 'paid',
      deliveryAddress: {
        recipientName: 'Stub',
        street: 'ul. Odbioru 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'Stub',
        street: 'ul. Rozliczeń 2',
        city: 'Warszawa',
        postalCode: '00-101',
        country: 'PL',
      },
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
      subtotal: '19.99',
      taxTotal: '4.60',
      deliveryTotal: '0.00',
      total: '24.59',
      currency: 'PLN',
      placedAt,
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    port = new OrderReadService(h.em);
    await seedOrdersForInvoiceTests(h.em());
    channelA = await ensureSalesChannelId(h.em(), 'ord-read-chan-a');
    channelB = await ensureSalesChannelId(h.em(), 'ord-read-chan-b');
    await h.em().persistAndFlush([
      orderOn(channelA, new Date('2026-01-01T10:00:00Z'), TEST_CUSTOMER_ID),
      orderOn(channelA, new Date('2026-02-01T10:00:00Z'), TEST_CUSTOMER_ID),
      orderOn(channelB, new Date('2026-03-01T10:00:00Z'), TEST_CUSTOMER_ID),
    ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers each channel once, however many orders the customer placed on it', async () => {
    const ids = await port.salesChannelIdsForCustomer(TEST_CUSTOMER_ID);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(channelA);
    expect(ids).toContain(channelB);
  });

  it('orders the channels by the customer’s most recent order on each', async () => {
    const ids = await port.salesChannelIdsForCustomer(TEST_CUSTOMER_ID);
    expect(ids.indexOf(channelB)).toBeLessThan(ids.indexOf(channelA));
  });

  it('answers nothing — never every channel — for a customer with no orders', async () => {
    expect(await port.salesChannelIdsForCustomer(randomUUID())).toEqual([]);
  });

  it('hands back plain ids, not managed rows the caller could flush', async () => {
    const ids = await port.salesChannelIdsForCustomer(TEST_CUSTOMER_ID);
    for (const id of ids) expect(typeof id).toBe('string');
  });
});
