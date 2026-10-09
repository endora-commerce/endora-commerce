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
 * An order may only ship and be paid with methods offered in **its** sales
 * channel — the refusal behind the storefront catalogues' channel filter.
 *
 * The catalogues (`GET /api/v1/delivery-methods`, `GET /api/v1/payment-methods`)
 * list only the methods offered in the request's channel. That is a listing,
 * not an authorisation: placement is handed a method id, and before this gate
 * it accepted any active one. So a client holding an id from another channel
 * could ship or pay with a method its channel does not offer.
 *
 * ## How the channel is set in these cases
 *
 * Every storefront request below names its channel **twice and identically** —
 * `X-Sales-Channel` and the body's `salesChannelId` — or names none at all.
 * The gate reads the channel the order records, and the two ways of naming it
 * agree here by construction, so the cases mean the same thing whether the
 * storefront route takes the order's channel from the body (as it did when this
 * file was written) or from the resolved request (the correction that lands
 * separately). Nothing in this file depends on which.
 *
 * Fixture: channel A is the system default, channel B is a second one. Two
 * methods of each kind are restricted, one to each channel; the harness's
 * seeded methods carry no membership and are therefore offered on both.
 */
describe('order placement — methods must be offered in the order’s sales channel', () => {
  let h: BackendServerHandle;
  let channelA: { id: string; code: string };
  let channelB: { id: string; code: string };
  let deliveryOnlyB: string;
  let paymentOnlyB: string;

  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  const ADMIN = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();

    const systemDefault = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelA = { id: systemDefault.id, code: systemDefault.code };

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: ADMIN,
      payload: {
        code: 'method-gate-b',
        name: { 'en-US': 'Method gate B' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    channelB = { id: (created.json() as { id: string }).id, code: 'method-gate-b' };

    const delivery = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/gate_delivery_only_b',
      cookies: ADMIN,
      payload: {
        code: 'gate_delivery_only_b',
        name: { 'en-US': 'Only on B' },
        cost: 0,
        currency: 'PLN',
        adapter: 'manual_courier',
        salesChannelIds: [channelB.id],
      },
    });
    expect(delivery.statusCode).toBe(200);
    deliveryOnlyB = (delivery.json() as { data: { id: string } }).data.id;

    const payment = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/payment-methods/gate_payment_only_b',
      cookies: ADMIN,
      payload: {
        name: { 'en-US': 'Only on B' },
        kind: 'bank_transfer',
        adapter: 'bank_transfer',
        salesChannelIds: [channelB.id],
      },
    });
    expect(payment.statusCode).toBe(200);
    paymentOnlyB = (payment.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function freshBasket(): Promise<void> {
    const em = h.em();
    await em.nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    await seedCartForStubCustomer(em);
  }

  /** `channel` undefined ⇒ no signal at all ⇒ the system default, channel A. */
  function storefront(
    url: string,
    channel: { id: string; code: string } | undefined,
    methods: { deliveryMethodId: string; paymentMethodId: string },
    extra: Record<string, unknown> = {},
  ): Promise<{ statusCode: number; json: () => unknown }> {
    return h.app.inject({
      method: 'POST',
      url,
      cookies: CUSTOMER,
      headers: {
        'content-type': 'application/json',
        ...(channel ? { 'x-sales-channel': channel.code } : {}),
      },
      payload: { ...methods, ...extra },
    });
  }

  function place(
    channel: { id: string; code: string } | undefined,
    methods: { deliveryMethodId: string; paymentMethodId: string },
  ): Promise<{ statusCode: number; json: () => unknown }> {
    return storefront('/api/v1/orders', channel, methods, {
      deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
      billingAddressId: SEED_ADDRESS_BILLING_ID,
      ...(channel ? { salesChannelId: channel.id } : {}),
    });
  }

  function expectRefusal(
    res: { statusCode: number; json: () => unknown },
    code: 'delivery_method_not_in_sales_channel' | 'payment_method_not_in_sales_channel',
    salesChannelId: string,
  ): void {
    expect(res.statusCode).toBe(400);
    const error = (res.json() as { error: { code: string; details: unknown } }).error;
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details).toMatchObject({ code, salesChannelId });
  }

  async function ordersPlaced(): Promise<number> {
    return h.em().count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID });
  }

  describe('POST /api/v1/orders', () => {
    it('refuses a delivery method the order’s channel does not offer, and writes nothing', async () => {
      await freshBasket();
      const before = await ordersPlaced();

      const res = await place(undefined, {
        deliveryMethodId: deliveryOnlyB,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      });

      expectRefusal(res, 'delivery_method_not_in_sales_channel', channelA.id);
      expect(await ordersPlaced()).toBe(before);
      // The basket is still the buyer's: the refusal is inside the placement
      // transaction, before anything is reserved, and it rolled back.
      expect(
        await h.em().findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }),
      ).not.toBeNull();
    });

    it('refuses a payment method the order’s channel does not offer, and writes nothing', async () => {
      await freshBasket();
      const before = await ordersPlaced();

      const res = await place(undefined, {
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: paymentOnlyB,
      });

      expectRefusal(res, 'payment_method_not_in_sales_channel', channelA.id);
      expect(await ordersPlaced()).toBe(before);
    });

    it('places the order with the same two methods on the channel that offers them', async () => {
      await freshBasket();

      const res = await place(channelB, {
        deliveryMethodId: deliveryOnlyB,
        paymentMethodId: paymentOnlyB,
      });

      expect(res.statusCode).toBe(201);
      const orderId = (res.json() as { data: { id: string } }).data.id;
      const order = await h.em().findOneOrFail(Order, { id: orderId });
      expect(order.salesChannelId).toBe(channelB.id);
      expect(order.deliveryMethodId).toBe(deliveryOnlyB);
      expect(order.paymentMethodId).toBe(paymentOnlyB);
    });

    it.each([
      { name: 'channel A', channel: (): { id: string; code: string } | undefined => undefined },
      { name: 'channel B', channel: (): { id: string; code: string } | undefined => channelB },
    ])('places with methods bound to no channel on $name', async ({ channel }) => {
      await freshBasket();

      const res = await place(channel(), {
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      });

      expect(res.statusCode).toBe(201);
    });
  });

  describe('POST /api/v1/orders/preview-total', () => {
    it('refuses a method the request’s channel does not offer', async () => {
      await freshBasket();

      expectRefusal(
        await storefront('/api/v1/orders/preview-total', undefined, {
          deliveryMethodId: deliveryOnlyB,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        }),
        'delivery_method_not_in_sales_channel',
        channelA.id,
      );
      expectRefusal(
        await storefront('/api/v1/orders/preview-total', undefined, {
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: paymentOnlyB,
        }),
        'payment_method_not_in_sales_channel',
        channelA.id,
      );
    });

    it('previews on the channel that offers both methods', async () => {
      await freshBasket();

      const res = await storefront('/api/v1/orders/preview-total', channelB, {
        deliveryMethodId: deliveryOnlyB,
        paymentMethodId: paymentOnlyB,
      });

      expect(res.statusCode).toBe(200);
    });
  });

  /**
   * An administrator creating an order on a customer's behalf chooses the
   * order's channel in the body; the request itself is an admin path. The gate
   * follows the order, so the chosen channel is the one that has to offer the
   * methods.
   */
  describe('admin order creation — POST /api/v1/admin/orders', () => {
    function adminCreate(
      url: string,
      salesChannelId: string,
      methods: { deliveryMethodId: string; paymentMethodId: string },
    ): Promise<{ statusCode: number; json: () => unknown }> {
      return h.app.inject({
        method: 'POST',
        url,
        cookies: ADMIN,
        payload: {
          customerAccountId: TEST_CUSTOMER_ID,
          salesChannelId,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          ...methods,
        },
      });
    }

    it('refuses a method the chosen channel does not offer', async () => {
      const before = await ordersPlaced();

      expectRefusal(
        await adminCreate('/api/v1/admin/orders', channelA.id, {
          deliveryMethodId: deliveryOnlyB,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        }),
        'delivery_method_not_in_sales_channel',
        channelA.id,
      );
      expectRefusal(
        await adminCreate('/api/v1/admin/orders', channelA.id, {
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: paymentOnlyB,
        }),
        'payment_method_not_in_sales_channel',
        channelA.id,
      );
      expect(await ordersPlaced()).toBe(before);
    });

    it('creates the order on the channel that offers both methods', async () => {
      const res = await adminCreate('/api/v1/admin/orders', channelB.id, {
        deliveryMethodId: deliveryOnlyB,
        paymentMethodId: paymentOnlyB,
      });

      expect(res.statusCode).toBe(201);
    });

    it('the pricing preview refuses the same out-of-channel method', async () => {
      expectRefusal(
        await adminCreate('/api/v1/admin/orders/preview', channelA.id, {
          deliveryMethodId: deliveryOnlyB,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        }),
        'delivery_method_not_in_sales_channel',
        channelA.id,
      );
    });
  });
});
