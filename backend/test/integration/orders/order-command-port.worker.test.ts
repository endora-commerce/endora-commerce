import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrderCommandPort } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { Order, OrderComment } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * `specs/186-aggregate-ports/` T057 (issue #1823, US4; FR-004, FR-005, FR-007)
 * — `orderCommandPort` from a worker: no administrator, the `system` actor,
 * and the integration naming itself with `source` (D-293.6). The status and
 * the money axis move with one entry each, recorded with the system actor and
 * the code; a cancellation's follow-ups are recorded with it; a comment's
 * customer notice is sent after its commit, with no author.
 */
describe('orderCommandPort from a worker (#1823)', () => {
  let h: BackendServerHandle;
  let port: OrderCommandPort;
  const mailer = new InMemoryMailer();

  const asWorker = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScope('test: an integration worker drives an order', fn);

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

  const reread = (id: string) => h.em().fork().findOneOrFail(Order, { id });
  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'order', objectId }, { orderBy: { actedAt: 'asc' } });

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    port = h.container.resolve<OrderCommandPort>('orderCommandPort');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('moves the money axis and then the lifecycle, each entry the system actor with the source', async () => {
    const order = await seedOrder();

    const record = await asWorker(() => port.applyPaymentStatus(order.id, { to: 'paid' }, { source: 'payment' }));
    const outcome = await asWorker(() => port.applyStatus(order.id, { to: 'paid' }, { source: 'payment' }));

    expect(record).toMatchObject({ id: order.id, paymentStatus: 'paid', payer: null });
    expect(outcome).toEqual({ applied: true, from: 'new', to: 'paid' });
    const recorded = await entries(order.id);
    expect(
      recorded.map((e) => ({
        action: e.action,
        admin: e.actorAdminUserId ?? null,
        customer: e.actorCustomerAccountId ?? null,
        after: e.stateAfter,
      })),
    ).toEqual([
      {
        action: 'order.payment_status_transition',
        admin: null,
        customer: null,
        after: { paymentStatus: 'paid', source: 'payment' },
      },
      { action: 'order.status_transition', admin: null, customer: null, after: { status: 'paid', source: 'payment' } },
    ]);
    // And the read the deprecated transition port carried answers from the read port.
    expect(await h.container.resolve<{ isTerminal(id: string): Promise<boolean | null> }>('orderReadPort').isTerminal(order.id)).toBe(false);
  });

  it('records what a cancellation owes with it, as the admin route does', async () => {
    const order = await seedOrder();

    expect(await asWorker(() => port.applyStatus(order.id, { to: 'cancelled', reason: 'ERP cancelled it' }, { source: 'erp' }))).toEqual({
      applied: true,
      from: 'new',
      to: 'cancelled',
    });

    expect((await reread(order.id)).status).toBe('cancelled');
    const owed = await h
      .em()
      .getConnection()
      .execute<Array<{ effect: string }>>('select "effect" from "order_transition_effects" where "order_id" = ?', [order.id]);
    expect(owed.map((row) => row.effect)).toEqual(['stock.release']);
    // The reason is the events' and never the entry's (free text).
    expect(JSON.stringify((await entries(order.id)).map((e) => e.stateAfter))).not.toContain('ERP cancelled it');
  });

  it('adds a comment with no author and sends the customer notice after the commit', async () => {
    const order = await seedOrder();
    const before = mailer.sent.length;

    const comment = await asWorker(() =>
      port.addComment(order.id, { body: 'Shipped from the ERP.', isCustomerVisible: true, notifyCustomer: true }, { source: 'erp' }),
    );

    expect(comment).toMatchObject({ orderId: order.id, authorAdminUserId: null, authorCustomerAccountId: null });
    expect(await h.em().fork().count(OrderComment, { orderId: order.id })).toBe(1);
    expect(mailer.sent.slice(before).filter((m) => JSON.stringify(m).includes(order.id))).toHaveLength(1);
    const [entry] = await entries(order.id);
    expect(entry).toMatchObject({
      action: 'order.comment.add',
      stateAfter: { commentId: comment.id, isCustomerVisible: true, notifyCustomer: true, source: 'erp' },
    });
  });
});
