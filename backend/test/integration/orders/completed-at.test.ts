import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrderReturnContextPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { Order } from '../../helpers/package-entities.js';
import { Migration20261108T000543OrdersCompletedAt } from '../../../../packages/modules/orders/src/migrations/20261108T000543_orders_completed_at.js';

/**
 * Issue #905 (PR 1, design D3.1–D3.3) — `orders.completed_at`: the moment the
 * order entered `completed`, stamped once and never rewritten. It is what
 * `OrderReturnContextPort` reports as `completingStatusEnteredAt`, so the
 * consumer's withdrawal period stops drifting with every later edit of the
 * order, which `updatedAt` did.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/** The statements `up()` emits, as the migrator would run them. */
function upStatements(): string[] {
  const migration = new Migration20261108T000543OrdersCompletedAt(undefined as never, undefined as never);
  void migration.up();
  return migration.getQueries().map((query) => String(query));
}

describe('905 — orders.completed_at [integration]', () => {
  let h: BackendServerHandle;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = await systemDefaultSalesChannelId(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const contextPort = (): OrderReturnContextPort =>
    (h.container.cradle as unknown as { orderReturnContextPort: OrderReturnContextPort }).orderReturnContextPort;

  async function seedOrder(status: string, extra: { completedAt?: Date } = {}): Promise<string> {
    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: channelId,
      status,
      ...(extra.completedAt ? { completedAt: extra.completedAt } : {}),
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

  const row = async (orderId: string) =>
    (
      (await h
        .em()
        .getConnection()
        .execute(`select "status", "completed_at", "updated_at" from "orders" where "id" = ?`, [orderId])) as Array<{
        status: string;
        completed_at: Date | null;
        updated_at: Date;
      }>
    )[0]!;

  const transition = (orderId: string, to: string) =>
    h.app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/status`, payload: { to }, ...ADMIN });

  it('is a nullable timestamptz column', async () => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select "data_type", "is_nullable", "column_default" from information_schema.columns
          where table_schema = current_schema() and table_name = 'orders' and column_name = 'completed_at'`,
      )) as unknown[];
    expect(rows).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null }]);
  });

  it('is stamped when the order enters completed through the admin transition route', async () => {
    const orderId = await seedOrder('shipment_sent');
    expect((await row(orderId)).completed_at).toBeNull();
    expect((await contextPort().getReturnContext(orderId))!.completingStatusEnteredAt).toBeNull();

    const before = Date.now();
    const res = await transition(orderId, 'completed');
    expect(res.statusCode, res.body).toBe(200);

    const stored = await row(orderId);
    expect(stored.status).toBe('completed');
    expect(stored.completed_at).not.toBeNull();
    expect(stored.completed_at!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stored.completed_at!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await contextPort().getReturnContext(orderId))!.completingStatusEnteredAt).toEqual(stored.completed_at);
  });

  it('does not move when the order is edited after completion', async () => {
    const orderId = await seedOrder('shipment_sent');
    expect((await transition(orderId, 'completed')).statusCode).toBe(200);
    const completedAt = (await row(orderId)).completed_at!;

    // Any later edit moves `updated_at` — the anchor this column replaces.
    await h
      .em()
      .getConnection()
      .execute(`update "orders" set "updated_at" = ? where "id" = ?`, [new Date(completedAt.getTime() + 9 * 86_400_000), orderId]);

    expect((await contextPort().getReturnContext(orderId))!.completingStatusEnteredAt).toEqual(completedAt);
  });

  it('is never rewritten by a later entry into completed', async () => {
    // An order that already carries the stamp — completed once, then moved out
    // by a graph an operator reconfigured — keeps its first completion.
    const first = new Date('2026-09-01T08:00:00.000Z');
    const orderId = await seedOrder('shipment_sent', { completedAt: first });
    expect((await transition(orderId, 'completed')).statusCode).toBe(200);
    expect((await row(orderId)).completed_at).toEqual(first);
  });

  it('is not stamped by a transition to any other status', async () => {
    const orderId = await seedOrder('processing');
    expect((await transition(orderId, 'shipment_ready')).statusCode).toBe(200);
    expect((await row(orderId)).completed_at).toBeNull();
  });

  it('is stamped on an order created directly in completed', async () => {
    const orderId = await seedOrder('completed');
    expect((await row(orderId)).completed_at).not.toBeNull();
  });

  describe('the backfill', () => {
    const insertRaw = async (status: string, updatedAt: Date, completedAt: Date | null = null): Promise<string> => {
      const id = randomUUID();
      await h
        .em()
        .getConnection()
        .execute(
          `insert into "orders" (
             "id", "organization_id", "placed_by_customer_account_id", "sales_channel_id", "status",
             "delivery_address", "billing_address", "delivery_method_id", "delivery_method_snapshot",
             "payment_method_id", "payment_method_snapshot", "subtotal", "tax_total", "delivery_total",
             "total", "currency", "placed_at", "created_at", "updated_at", "business_id", "completed_at")
           values (?, ?, ?, ?, ?, '{}', '{}', ?, '{}', ?, '{}', 10, 0, 0, 10, 'PLN', now(), now(), ?, ?, ?)`,
          [
            id,
            TEST_ORGANIZATION_ID,
            TEST_CUSTOMER_ID,
            channelId,
            status,
            randomUUID(),
            randomUUID(),
            updatedAt,
            `905-BACKFILL-${id}`,
            completedAt,
          ],
        );
      return id;
    };

    it('sets completed_at from updated_at on a completed row, and leaves every other row alone', async () => {
      const updatedAt = new Date('2026-08-15T10:30:00.000Z');
      const stamped = new Date('2026-08-01T09:00:00.000Z');
      const completed = await insertRaw('completed', updatedAt);
      const alreadyStamped = await insertRaw('completed', updatedAt, stamped);
      const open = await insertRaw('shipment_sent', updatedAt);

      for (const sql of upStatements()) await h.em().getConnection().execute(sql);
      // A second run changes nothing: the statements are idempotent.
      for (const sql of upStatements()) await h.em().getConnection().execute(sql);

      expect((await row(completed)).completed_at).toEqual(updatedAt);
      expect((await row(alreadyStamped)).completed_at).toEqual(stamped);
      expect((await row(open)).completed_at).toBeNull();
      // Exactly today's anchor, so a case opened from a backfilled order is judged as before.
      expect((await contextPort().getReturnContext(completed))!.completingStatusEnteredAt).toEqual(updatedAt);
    });
  });
});
