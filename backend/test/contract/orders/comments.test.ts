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
import { adminUserIdKeys, deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { orderCommentSchema } from '@endora-commerce/contracts';

/** A strict copy: a key a comment reply carries that the contract does not declare fails (issue #599 §5). */
const strictComment = deepStrict(orderCommentSchema);

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

    // The administrator's identifier is the admin list's to answer, never the
    // customer's: the key is absent there, and the reply still parses.
    expect((adminList.data[0] as { authorAdminUserId?: unknown }).authorAdminUserId).toEqual(
      expect.any(String),
    );
    expect(adminUserIdKeys(custList.data)).toEqual([]);
    expect(custList.data.flatMap((comment) => disagreements(strictComment, comment))).toEqual([]);
    expect(adminList.data.flatMap((comment) => disagreements(strictComment, comment))).toEqual([]);
    expect(disagreements(strictComment, (internal.json() as { data: unknown }).data)).toEqual([]);
    const own = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${openOrderId}/comments`,
      ...customer,
      payload: { body: 'a question' },
    });
    expect(own.statusCode).toBe(201);
    expect(adminUserIdKeys(own.json())).toEqual([]);
    expect(disagreements(strictComment, (own.json() as { data: unknown }).data)).toEqual([]);
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

  // Feature 162 (FR-010a, SC-006) — an author-less system note: listed to the
  // administrator with its structured shape, never to the buyer, even if its
  // visibility flag were ever set.
  it('lists a system note to the administrator only, with its shape, and every other comment with systemNote null', async () => {
    const orderId = await makeOrder('new');
    const note = {
      kind: 'custom_field_carry_skipped',
      source: { entityType: 'quote_request', recordId: randomUUID(), reference: 'QR-0001' },
      skipped: [{ key: 'order_source', reason: 'value_invalid' }],
    };
    const conn = h.em().getConnection();
    const insertNote = async (visible: boolean): Promise<string> => {
      const id = randomUUID();
      await conn.execute(
        `insert into "order_comments" (id, order_id, author_admin_user_id, author_customer_account_id, body, is_customer_visible, notify_customer, system_note, created_at)
         values (?, ?, null, null, ?, ?, false, ?::jsonb, now())`,
        [id, orderId, 'Custom field values were not carried from quote request QR-0001: order_source.', visible, JSON.stringify(note)],
      );
      return id;
    };
    const hiddenId = await insertNote(false);
    const forcedVisibleId = await insertNote(true);
    const staff = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/comments`,
      ...admin,
      payload: { body: 'a staff note', isCustomerVisible: true, notifyCustomer: false },
    });
    expect(staff.statusCode, staff.body).toBe(201);
    const staffId = (staff.json() as { data: { id: string } }).data.id;

    const adminList = (
      await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${orderId}/comments`, ...admin })
    ).json() as { data: Array<{ id: string; systemNote: unknown; authorAdminUserId: unknown }> };
    const byId = new Map(adminList.data.map((comment) => [comment.id, comment]));
    for (const id of [hiddenId, forcedVisibleId]) {
      expect(byId.get(id)?.systemNote).toEqual(note);
      expect(byId.get(id)?.authorAdminUserId).toBeNull();
      expect(disagreements(strictComment, byId.get(id))).toEqual([]);
    }
    expect(byId.get(staffId)?.systemNote).toBeNull();
    for (const comment of adminList.data) {
      if (comment.id !== hiddenId && comment.id !== forcedVisibleId) expect(comment.systemNote).toBeNull();
    }

    const customerList = (
      await h.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}/comments`, ...customer })
    ).json() as { data: Array<{ id: string }> };
    const customerIds = customerList.data.map((comment) => comment.id);
    expect(customerIds).toContain(staffId);
    expect(customerIds).not.toContain(hiddenId);
    expect(customerIds).not.toContain(forcedVisibleId);
    for (const comment of customerList.data) expect(Object.hasOwn(comment, 'systemNote')).toBe(false);
  });
});
