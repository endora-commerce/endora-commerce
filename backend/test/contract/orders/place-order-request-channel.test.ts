import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
  seedCartForStubCustomer,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { Cart, Order } from '../../helpers/package-entities.js';

/**
 * `POST /api/v1/orders` — the order records the channel **the request resolved**.
 *
 * ## The defect this file was written to observe
 *
 * The storefront placement route handed its body to `OrderService.placeOrder`
 * untouched, and `placeOrder` stamps `req.salesChannelId`, else the system
 * default. The body's `salesChannelId` is optional; `X-Sales-Channel` is how
 * every other storefront request names its channel, and the resolver middleware
 * turns it into the request's channel — which the placement never read. So an
 * order placed with the header and without the body field was recorded on the
 * **default** channel, and took that channel's minimum order value, candidate
 * warehouses and order-number prefix with it. The first case below is that
 * observation: it was red — `expected <default id> to be <channel B id>` —
 * before the route changed.
 *
 * (The reference storefront sent neither the header nor the body field on this
 * call, so it reached the same wrong answer by a second road; that half is
 * `storefront/test/lib/order-placement-channel.test.ts`.)
 *
 * ## The rule
 *
 * On the storefront surface the request's resolved channel is the order's
 * channel. The body field stays in the contract so an existing client that
 * echoes the channel it is on keeps working, but it is a **claim** now and not
 * an instruction: one that names a different channel is refused rather than
 * obeyed, because obeying it is a buyer on one channel choosing another
 * channel's rules for their order. The refusal happens at the route, before the
 * placement transaction, so nothing is written and the basket survives.
 *
 * Admin order creation and the API-key intake do not pass through this route
 * and keep their own source — the operator's chosen channel and the key's bound
 * channel — which `admin-create.test.ts` and `external-intake.test.ts` hold.
 */
describe('POST /api/v1/orders — the order records the resolved request channel', () => {
  let h: BackendServerHandle;
  let defaultChannel: { id: string; code: string };
  let channelB: { id: string; code: string };

  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  const ADMIN = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();

    const systemDefault = await h.em().findOne(SalesChannel, { systemDefault: true });
    expect(systemDefault).not.toBeNull();
    defaultChannel = { id: systemDefault!.id, code: systemDefault!.code };

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: ADMIN,
      payload: {
        code: 'request-channel-b',
        name: { 'en-US': 'Request channel B' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    channelB = { id: (created.json() as { id: string }).id, code: 'request-channel-b' };
    expect(channelB.id).not.toBe(defaultChannel.id);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** A fresh active basket: a successful placement completes the previous one. */
  async function freshBasket(): Promise<void> {
    const em = h.em();
    await em.nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    await seedCartForStubCustomer(em);
  }

  async function place(input: {
    channelHeader?: string;
    bodyChannelId?: string;
  }): Promise<{ statusCode: number; body: unknown }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: CUSTOMER,
      headers: {
        'content-type': 'application/json',
        ...(input.channelHeader ? { 'x-sales-channel': input.channelHeader } : {}),
      },
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        ...(input.bodyChannelId ? { salesChannelId: input.bodyChannelId } : {}),
      },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function recordedChannelOf(body: unknown): Promise<string> {
    const orderId = (body as { data: { id: string } }).data.id;
    const order = await h.em().findOne(Order, { id: orderId });
    expect(order).not.toBeNull();
    return order!.salesChannelId;
  }

  it('records the channel named by X-Sales-Channel when the body names none', async () => {
    await freshBasket();
    const res = await place({ channelHeader: channelB.code });

    expect(res.statusCode).toBe(201);
    expect(await recordedChannelOf(res.body)).toBe(channelB.id);
  });

  it('records the system default when the request carries no channel signal', async () => {
    await freshBasket();
    const res = await place({});

    expect(res.statusCode).toBe(201);
    expect(await recordedChannelOf(res.body)).toBe(defaultChannel.id);
  });

  it('accepts a body salesChannelId that agrees with the resolved channel', async () => {
    await freshBasket();
    const res = await place({ channelHeader: channelB.code, bodyChannelId: channelB.id });

    expect(res.statusCode).toBe(201);
    expect(await recordedChannelOf(res.body)).toBe(channelB.id);
  });

  it.each([
    {
      name: 'the request resolves channel B and the body names the default',
      header: (): string | undefined => channelB.code,
      bodyChannel: (): string => defaultChannel.id,
      resolved: (): string => channelB.id,
    },
    {
      name: 'the request resolves the default and the body names channel B',
      header: (): string | undefined => undefined,
      bodyChannel: (): string => channelB.id,
      resolved: (): string => defaultChannel.id,
    },
  ])('refuses, and writes nothing, when $name', async ({ header, bodyChannel, resolved }) => {
    await freshBasket();
    const ordersBefore = await h.em().count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID });

    const channelHeader = header();
    const res = await place({
      ...(channelHeader ? { channelHeader } : {}),
      bodyChannelId: bodyChannel(),
    });

    expect(res.statusCode).toBe(422);
    const error = (res.body as { error: { code: string; details: unknown } }).error;
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details).toMatchObject({
      code: 'order_sales_channel_mismatch',
      requestedSalesChannelId: bodyChannel(),
      resolvedSalesChannelId: resolved(),
    });

    // Refused before the placement transaction: no order, and the basket is
    // still the buyer's to place on the channel they are actually on.
    expect(await h.em().count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID })).toBe(
      ordersBefore,
    );
    const cart = await h.em().findOne(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      status: 'active',
    });
    expect(cart).not.toBeNull();
  });

  /**
   * The other side of the rule, held here so the two cannot be confused in a
   * later edit: an administrator creating an order on a customer's behalf is on
   * an admin path, whose request channel is whatever the operator's own
   * channel switcher (or the fallback) says and has nothing to do with the
   * order. The channel the operator **chose for the order** is the one it
   * records.
   */
  it('admin order creation keeps the operator-chosen channel, whatever the request resolved', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: ADMIN,
      // No channel header: this admin request resolves the system default.
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelB.id,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(await recordedChannelOf(res.json())).toBe(channelB.id);
  });
});
