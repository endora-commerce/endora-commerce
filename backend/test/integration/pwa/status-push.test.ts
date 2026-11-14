import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PWA_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { seedShippedOrder, RFQ_SHIPPED_ORDER_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * `specs/149-pwa-order-status-push/` T015 / T028 — the automatic status pushes
 * on the composed harness: the real subscriptions, the real ports, the real
 * settings store and `_i18n`, and `push_messages` as the observable.
 *
 * Every event here is emitted from the test body, i.e. with **no ambient
 * tenant context** — what the composer's system scope exists for.
 *
 * Since `specs/179-rfq-and-customer-notifications/` WP-10 (FR-061) the quote
 * half is not event-driven: `quote_requests` pushes through `customerPushPort`
 * after its own delivery records (`test/integration/quote_requests/notification-delivery.test.ts`),
 * so a quote event reaching this module writes nothing.
 */
describe('149 — order status pushes; quote events push nothing [integration]', () => {
  let h: BackendServerHandle;
  const customer = { b2b_session: 'stub-customer-session' };
  const adminCookie = { b2b_session: 'stub-admin-session' };
  let plChannelId: string;
  let defaultChannelId: string;
  let quoteId: string;
  let orderBusinessId: string;
  let originalStatusName: string;

  const settleEvents = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
  const sql = <T>(query: string, params: unknown[] = []): Promise<T[]> =>
    h.em().getConnection().execute(query, params) as Promise<T[]>;

  async function setGlobal(code: string, value: boolean | string): Promise<void> {
    await h.settings.adminService.setValueForAllChannels(code, value, null, {
      actorAdminUserId: null,
    });
  }

  async function setForChannel(code: string, channelCode: string, value: boolean): Promise<void> {
    await h.settings.adminService.setValueForSubset(code, [channelCode], value, null, {
      actorAdminUserId: null,
    });
  }

  interface Row {
    trigger: string;
    title: string;
    body: string;
    url: string | null;
    sales_channel_id: string;
  }

  async function rowsFor(eventId: string): Promise<Row[]> {
    return sql<Row>(
      `select trigger, title, body, url, sales_channel_id from push_messages where source_event_id = ?`,
      [eventId],
    );
  }

  /** Polls until a row exists (the subscriber is fire-and-forget), or gives up. */
  async function awaitRows(eventId: string): Promise<Row[]> {
    for (let i = 0; i < 40; i += 1) {
      const rows = await rowsFor(eventId);
      if (rows.length > 0) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    return rowsFor(eventId);
  }

  /** Waits long enough for a subscriber that would write to have written. */
  async function awaitNothing(eventId: string): Promise<Row[]> {
    await new Promise((r) => setTimeout(r, 400));
    return rowsFor(eventId);
  }

  function emitOrderStatus(eventId: string, to = 'shipment_sent'): void {
    h.eventBus.emit('order.status_changed.v1' as never, {
      eventId,
      occurredAt: new Date().toISOString(),
      orderId: RFQ_SHIPPED_ORDER_ID,
      organizationId: '00000000-0000-4000-8000-0000000000aa',
      salesChannelId: plChannelId,
      from: 'pending',
      to,
      actor: { kind: 'admin' as const },
    } as never);
  }

  function emitQuote(name: string, eventId: string): void {
    h.eventBus.emit(name as never, {
      eventId,
      occurredAt: new Date().toISOString(),
      rfqId: quoteId,
      organizationId: '00000000-0000-4000-8000-0000000000aa',
    } as never);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    defaultChannelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    plChannelId = (
      await sql<{ id: string }>(`select id from sales_channels where code = 'pl_retail'`)
    )[0]!.id;

    // The order, placed on the Polish channel by the stub customer.
    await seedShippedOrder(h.em());
    await sql(`update orders set sales_channel_id = ? where id = ?`, [
      plChannelId,
      RFQ_SHIPPED_ORDER_ID,
    ]);
    orderBusinessId = (
      await sql<{ business_id: string }>(`select business_id from orders where id = ?`, [
        RFQ_SHIPPED_ORDER_ID,
      ])
    )[0]!.business_id;
    originalStatusName = JSON.stringify(
      (
        await sql<{ name: unknown }>(`select name from order_statuses where code = 'shipment_sent'`)
      )[0]!.name,
    );
    await sql(`update order_statuses set name = ?::jsonb where code = 'shipment_sent'`, [
      JSON.stringify({ en: 'Shipped', pl: 'Wysłane' }),
    ]);

    // The quote, requested by the stub customer.
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: customer,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });
    expect(add.statusCode, add.body).toBe(200);
    const convert = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/convert-to-quote-request',
      cookies: customer,
      payload: {},
    });
    expect(convert.statusCode, convert.body).toBe(200);
    quoteId = (convert.json() as { data: { quoteRequestId: string } }).data.quoteRequestId;

    for (const channelId of [plChannelId, defaultChannelId]) {
      await h.pwa.subscriptionService.register({
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
        keys: { p256dh: 'p', auth: 'a' },
        salesChannelId: channelId,
        customerAccountId: TEST_CUSTOMER_ID,
      });
    }
  });

  beforeEach(async () => {
    // Push on; both categories at their shipped default (on). Writing for all
    // channels also drops a per-channel override an earlier case left behind.
    await setGlobal(PWA_SETTING_CODES.PUSH_ENABLED, true);
    await setGlobal(PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED, true);
    await setGlobal(PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED, true);
    await sql(`update quote_requests set sales_channel_id = ? where id = ?`, [
      defaultChannelId,
      quoteId,
    ]);
    await sql(`delete from push_notification_preferences where customer_account_id = ?`, [
      TEST_CUSTOMER_ID,
    ]);
    await settleEvents();
  });

  afterAll(async () => {
    // Nothing this file changed may reach the next one: the preference table is
    // not among the tables the harness reseeds, and an opt-out left behind
    // would silently skip another file's order push.
    await sql(`delete from push_notification_preferences where customer_account_id = ?`, [
      TEST_CUSTOMER_ID,
    ]);
    await setGlobal(PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED, true);
    await setGlobal(PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED, true);
    await sql(`update order_statuses set name = ?::jsonb where code = 'shipment_sent'`, [
      originalStatusName,
    ]);
    await teardownBackendServer(h);
  });

  it('queues one Polish notification naming the order and the shop’s label, opening the order', async () => {
    const eventId = `evt-${randomUUID()}`;
    emitOrderStatus(eventId);

    const rows = await awaitRows(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      trigger: 'order_status',
      title: 'Aktualizacja zamówienia',
      body: `Zamówienie ${orderBusinessId} ma teraz status: Wysłane.`,
      url: `/orders/${RFQ_SHIPPED_ORDER_ID}`,
      sales_channel_id: plChannelId,
    });
  });

  it('produces one notification for an announcement delivered twice (FR-014)', async () => {
    const eventId = `evt-${randomUUID()}`;
    emitOrderStatus(eventId);
    await awaitRows(eventId);
    emitOrderStatus(eventId);

    expect(await awaitNothing(eventId)).toHaveLength(1);
  });

  it('queues nothing while the order category is off globally (US1 #2)', async () => {
    await setGlobal(PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED, false);
    await settleEvents();
    const eventId = `evt-${randomUUID()}`;
    emitOrderStatus(eventId);

    expect(await awaitNothing(eventId)).toHaveLength(0);
  });

  it('honours a per-channel override of the order category (US1 #3)', async () => {
    await setGlobal(PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED, false);
    await setForChannel(PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED, 'pl_retail', true);
    await settleEvents();
    const onChannel = `evt-${randomUUID()}`;
    emitOrderStatus(onChannel);
    expect(await awaitRows(onChannel)).toHaveLength(1);

    // The same order moved to the default channel, where only the global
    // (off) value applies.
    await sql(`update orders set sales_channel_id = ? where id = ?`, [
      defaultChannelId,
      RFQ_SHIPPED_ORDER_ID,
    ]);
    try {
      const offChannel = `evt-${randomUUID()}`;
      emitOrderStatus(offChannel);
      expect(await awaitNothing(offChannel)).toHaveLength(0);
    } finally {
      await sql(`update orders set sales_channel_id = ? where id = ?`, [
        plChannelId,
        RFQ_SHIPPED_ORDER_ID,
      ]);
    }
  });

  it('queues nothing while push itself is off, whatever the categories say (US1 #4)', async () => {
    await setGlobal(PWA_SETTING_CODES.PUSH_ENABLED, false);
    await settleEvents();
    const order = `evt-${randomUUID()}`;
    emitOrderStatus(order);

    expect(await awaitNothing(order)).toHaveLength(0);
  });

  it.each([
    'rfq.created.v1',
    'rfq.created_by_admin.v1',
    'rfq.modified.v1',
    'rfq.approved.v1',
    'rfq.canceled.v1',
    'rfq.expired.v1',
  ])('queues nothing for %s, with push and quote pushes on (FR-061)', async (name) => {
    const eventId = `evt-${randomUUID()}`;
    emitQuote(name, eventId);

    expect(await awaitNothing(eventId)).toHaveLength(0);
  });

  it('does not let the quote category switch order pushes', async () => {
    await setGlobal(PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED, false);
    await settleEvents();
    const order = `evt-${randomUUID()}`;
    emitOrderStatus(order);

    expect(await awaitRows(order)).toHaveLength(1);
  });

  it('leaves an administrator’s manual send alone while both categories are off (FR-006)', async () => {
    await setGlobal(PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED, false);
    await setGlobal(PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED, false);
    await setGlobal(PWA_SETTING_CODES.VAPID_PUBLIC_KEY, 'BPUB');
    await settleEvents();

    const title = `Manual ${randomUUID()}`;
    const sent = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/messages',
      cookies: adminCookie,
      payload: {
        salesChannelId: defaultChannelId,
        title,
        body: 'Manual send.',
        audience: { kind: 'all' },
      },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    expect(await sql(`select id from push_messages where title = ?`, [title])).toHaveLength(1);
  });

  it('honours the customer’s order choice, which the quote choice does not touch, leaving devices alone (US3, FR-019)', async () => {
    const activeDevices = (): Promise<Array<{ n: string }>> =>
      sql<{ n: string }>(
        `select count(*)::text as n from push_subscriptions where customer_account_id = ? and status = 'active'`,
        [TEST_CUSTOMER_ID],
      );
    const devicesBefore = await activeDevices();
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/storefront/pwa/preferences',
      cookies: customer,
      payload: { quoteStatus: false },
    });
    expect(put.statusCode, put.body).toBe(200);

    const order = `evt-${randomUUID()}`;
    emitOrderStatus(order);

    expect(await awaitRows(order)).toHaveLength(1);
    expect(await activeDevices()).toEqual(devicesBefore);

    // And the reverse.
    const flip = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/storefront/pwa/preferences',
      cookies: customer,
      payload: { orderStatus: false, quoteStatus: true },
    });
    expect(flip.statusCode, flip.body).toBe(200);
    const order2 = `evt-${randomUUID()}`;
    emitOrderStatus(order2);
    expect(await awaitNothing(order2)).toHaveLength(0);
  });
});
