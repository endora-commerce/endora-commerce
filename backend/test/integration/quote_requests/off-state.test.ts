import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `quote_requests` off-state — Constitution XVII item 6, from a **package**
 * (feature 080, T040b).
 *
 * The module lives in `packages/modules/quote_requests` now, and every gate it
 * relies on is applied by `ctx.routes` / `ctx.subscribe` in the kernel
 * container. Nothing about those seams is supposed to change when a module's
 * sources move — this file is what turns "supposed to" into a measurement.
 *
 * **The subscriber is the half `blog` left uncovered** (!910). `blog`'s only
 * `ctx.subscribe` listens for `settings.value_changed` and drops a cache, which
 * is invisible from outside: a test cannot tell a subscriber that did not run
 * from one that ran and cleared an already-empty cache, so the packaged
 * `ctx.subscribe` seam had no proof at all. `quote_requests`' subscriber
 * **writes** — `order.created.v1` flips the originating quote request to
 * `Completed`, appends a `completed` event row and enqueues a notification — so
 * "did it run" is a row. And issue #107's regression is exactly that handler
 * going on doing all three while every route that could show the customer the
 * quote request refused.
 *
 * The positive control comes first, for the reason `mfa`'s off-state test gives:
 * without it, a subscriber that never worked at all would read as a successful
 * absence.
 */
describe('quote_requests off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const customer = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'quote_requests', {
      routes: [
        { url: '/api/v1/admin/quote-requests', cookies: admin },
        { url: '/api/v1/quote-requests', cookies: customer },
        '/api/v1/storefront/settings/quote-requests',
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS,
        value: 21,
        cookies: admin,
      },
    });
  });

  /**
   * One submitted quote request, and one order pointing back at it.
   *
   * The order is written directly rather than checked out: the reactor reads it
   * through `orderReadPort` and needs only `sourceQuoteRequestId`, and a full
   * checkout would put four other modules between this test and the thing it is
   * measuring.
   */
  async function quoteRequestWithOrder(): Promise<{ quoteRequestId: string; orderId: string }> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customer,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    expect(created.statusCode).toBe(201);
    const quoteRequestId = (created.json() as { data: { id: string } }).data.id;

    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: randomUUID(),
      status: 'completed',
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
      sourceQuoteRequestId: quoteRequestId,
    });
    await em.persistAndFlush(order);
    return { quoteRequestId, orderId: order.id };
  }

  /** `emit` dispatches without a scope; the handler is async, so yield to it. */
  async function announceOrder(orderId: string): Promise<void> {
    h.eventBus.emit('order.created.v1', { orderId } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  async function statusOf(quoteRequestId: string): Promise<string | undefined> {
    const em = h.em();
    em.clear();
    return (await em.findOne(QuoteRequest, { id: quoteRequestId }))?.status;
  }

  it('the packaged subscriber runs: order.created.v1 completes the quote request', async () => {
    const { quoteRequestId, orderId } = await quoteRequestWithOrder();
    await announceOrder(orderId);
    expect(await statusOf(quoteRequestId)).toBe('Completed');
  });

  it('and stops while the module is deactivated, then resumes (issue #107)', async () => {
    const { quoteRequestId, orderId } = await quoteRequestWithOrder();
    const before = await statusOf(quoteRequestId);
    expect(before).not.toBe('Completed');

    await withModuleOff('quote_requests', 'deactivated', async () => {
      await announceOrder(orderId);
      expect(await statusOf(quoteRequestId)).toBe(before);
    });

    await announceOrder(orderId);
    expect(await statusOf(quoteRequestId)).toBe('Completed');
  });
});
