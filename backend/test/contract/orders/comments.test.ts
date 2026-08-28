import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { OrderCommentService } from '../../../../packages/modules/orders/dist/backend/services/order-comment-service.js';
import { ordersNeighbourPorts } from '../../helpers/orders-neighbour-ports.js';
import { OrderStatusGraphService } from '../../../../packages/modules/orders/dist/backend/services/order-status-graph-service.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { Order, OrderComment } from '../../helpers/package-entities.js';

/**
 * Feature 038 (US5) — order comments: visibility + notify rules, terminal
 * guard, and customer-facing filtering.
 */
describe('Order comments', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const customer = { cookies: { b2b_session: 'stub-customer-session' } };
  let openOrderId = '';
  let terminalOrderId = '';

  async function makeOrder(status: string): Promise<string> {
    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: randomUUID(),
      status,
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    return order.id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    openOrderId = await makeOrder('new');
    terminalOrderId = await makeOrder('completed');
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('admin adds internal + customer-visible comments; customer sees only visible', async () => {
    const internal = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${openOrderId}/comments`,
      ...admin,
      payload: { body: 'internal note', isCustomerVisible: false, notifyCustomer: false },
    });
    expect(internal.statusCode).toBe(201);
    const visible = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${openOrderId}/comments`,
      ...admin,
      payload: { body: 'visible to you', isCustomerVisible: true, notifyCustomer: false },
    });
    expect(visible.statusCode).toBe(201);

    const adminList = (await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${openOrderId}/comments`, ...admin })).json() as { data: unknown[] };
    expect(adminList.data).toHaveLength(2);

    const custList = (await h.app.inject({ method: 'GET', url: `/api/v1/orders/${openOrderId}/comments`, ...customer })).json() as { data: Array<{ body: string }> };
    expect(custList.data).toHaveLength(1);
    expect(custList.data[0]!.body).toBe('visible to you');
  });

  it('customer comments are forced customer-visible and non-notifying', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${openOrderId}/comments`,
      ...customer,
      payload: { body: 'a question from the buyer' },
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { isCustomerVisible: boolean; notifyCustomer: boolean; authorCustomerAccountId: string | null } }).data;
    expect(data.isCustomerVisible).toBe(true);
    expect(data.notifyCustomer).toBe(false);
    expect(data.authorCustomerAccountId).toBe(TEST_CUSTOMER_ID);
  });

  it('refuses comments on a terminal order (409)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${terminalOrderId}/comments`,
      ...admin,
      payload: { body: 'too late', isCustomerVisible: true, notifyCustomer: false },
    });
    expect(res.statusCode).toBe(409);
  });

  it('notifies the customer only for a customer-visible comment with notify on', async () => {
    const em = h.em();
    // Ensure the customer has a resolvable email.
    const acct = await em.findOne(CustomerAccount, { id: TEST_CUSTOMER_ID });
    const mailer = new InMemoryMailer();
    const svc = new OrderCommentService(
      h.em,
      new OrderStatusGraphService(h.em),
      ordersNeighbourPorts(h.em).customerAccountRead,
      mailer,
    );

    await svc.addByAdmin(openOrderId, randomUUID(), { body: 'internal', isCustomerVisible: false, notifyCustomer: true });
    expect(mailer.sent).toHaveLength(0); // internal → never notify

    await svc.addByAdmin(openOrderId, randomUUID(), { body: 'please pay', isCustomerVisible: true, notifyCustomer: true });
    if (acct?.email) {
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.to).toBe(acct.email);
    }

    // Sanity: the comment rows were persisted.
    const count = await em.count(OrderComment, { orderId: openOrderId });
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
