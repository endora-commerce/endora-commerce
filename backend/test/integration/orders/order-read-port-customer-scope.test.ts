import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { OrderReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  TEST_CUSTOMER_EMPTY_ID,
  TEST_CUSTOMER_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { seedInvoiceableOrder } from '../invoices/helpers.js';

/**
 * Issue #669 — `OrderReadPort.findByIdForCustomer`, resolved from the
 * container so the wiring is what is under test, not a hand-built service.
 *
 * It is the order read scope `GET /api/v1/orders/:id` applies, published for a
 * consumer that serves a customer an order-scoped resource: a regular member
 * reaches the orders they placed, an Administrator (TEST_CUSTOMER_ID)
 * every order of the Organization, and anyone else gets `null`.
 */
describe('OrderReadPort.findByIdForCustomer', () => {
  let h: BackendServerHandle;
  let orderId: string;
  const port = () => h.container.resolve<OrderReadPort>('orderReadPort');
  const as = (customerAccountId: string) => ({ customerAccountId, organizationId: TEST_ORGANIZATION_ID });

  beforeAll(async () => {
    h = await setupBackendServer();
    ({ orderId } = await seedInvoiceableOrder(h.em(), { placedByCustomerAccountId: TEST_CUSTOMER_RFQ_ID }));
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers the order to the regular member who placed it', async () => {
    expect((await port().findByIdForCustomer(orderId, as(TEST_CUSTOMER_RFQ_ID)))?.id).toBe(orderId);
  });

  it('answers the order to an Administrator of its Organization', async () => {
    expect((await port().findByIdForCustomer(orderId, as(TEST_CUSTOMER_ID)))?.id).toBe(orderId);
  });

  it('answers null to another regular member of the same Organization', async () => {
    expect(await port().findByIdForCustomer(orderId, as(TEST_CUSTOMER_EMPTY_ID))).toBeNull();
  });

  it('answers null for an order that does not exist', async () => {
    expect(await port().findByIdForCustomer(randomUUID(), as(TEST_CUSTOMER_ID))).toBeNull();
  });
});
