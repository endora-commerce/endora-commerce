import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { DEFAULT_WAREHOUSE_ID } from '@endora-commerce/mod-inventory/backend';
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
import {
  Cart,
  OrderItem,
  StockAllocation,
  StockLevel,
  Warehouse,
  WarehouseChannelAssignment,
} from '../../helpers/package-entities.js';

/**
 * What follows an order's channel now that a storefront order records the
 * channel **the request resolved** — the consequences, held one by one.
 *
 * `test/contract/orders/place-order-request-channel.test.ts` asserts the column:
 * `orders.sales_channel_id` is the resolved channel. This file asserts what
 * `placeOrder` reads *through* that channel, because the column being right and
 * a read still being made for another channel are different failures, and only
 * the second one costs a merchant money:
 *
 *   - the minimum order value (`orders.min_order_value`),
 *   - the order-number prefix (`orders.business_id.prefix`),
 *   - the warehouse the stock is allocated from.
 *
 * Every placement here names its channel the way a storefront does — an
 * `X-Sales-Channel` header, or nothing at all — and **never** in the body, so
 * each case is about the resolved channel and cannot pass through the body
 * field the route used to obey.
 *
 * ## The single-channel case is the last one, and it is a change on upgrade
 *
 * A request with no channel signal resolves the system default. The route used
 * to hand `placeOrder` no channel at all for such a request, and the
 * minimum-order-value check reads the setting for exactly what it is handed —
 * a read without a channel skips per-channel values and answers the
 * platform-wide one. It now hands over the default channel's id, so a minimum
 * an operator set **for the default channel** (rather than for "all channels")
 * applies to storefront orders where it did not before. (The warehouses and the
 * numbering were already read for the default channel on such an order: those
 * use the channel `placeOrder` resolves, not the one it was handed.) That is the behaviour the setting describes,
 * but it is a difference a one-channel instance can observe after upgrading,
 * and the last case is what holds it.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const CHANNEL_B_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d0b2';

const MIN_ORDER_VALUE = 'orders.min_order_value';
const BUSINESS_ID_PREFIX = 'orders.business_id.prefix';

describe('order placement — what follows the resolved request channel', () => {
  let h: BackendServerHandle;
  let defaultChannel: { id: string; code: string };
  let channelB: { id: string; code: string };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const systemDefault = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannel = { id: systemDefault.id, code: systemDefault.code };

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: ADMIN,
      payload: {
        code: 'consequences-b',
        name: { 'en-US': 'Consequences B' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    channelB = { id: (created.json() as { id: string }).id, code: 'consequences-b' };

    // Channel B ships from a warehouse of its own, and only from it — so the
    // warehouse an order is allocated from says which channel's candidates
    // were read. `warehouses` is not truncated between files.
    if (!(await em.findOne(Warehouse, { id: CHANNEL_B_WAREHOUSE_ID }))) {
      em.create(Warehouse, {
        id: CHANNEL_B_WAREHOUSE_ID,
        code: 'wh-consequences-b',
        name: 'Consequences B warehouse',
        active: true,
      });
      await em.flush();
    }
    em.create(WarehouseChannelAssignment, {
      warehouseId: CHANNEL_B_WAREHOUSE_ID,
      salesChannelId: channelB.id,
      isDefault: true,
      sortOrder: 0,
    });
    if (
      !(await em.findOne(StockLevel, {
        productId: SEED_PRODUCT_101_ID,
        warehouseId: CHANNEL_B_WAREHOUSE_ID,
      }))
    ) {
      em.create(StockLevel, {
        productId: SEED_PRODUCT_101_ID,
        warehouseId: CHANNEL_B_WAREHOUSE_ID,
        onHand: 100,
        reserved: 0,
      });
    }
    await em.flush();
    await em
      .getKnex()('stock_levels')
      .where({ product_id: SEED_PRODUCT_101_ID, warehouse_id: DEFAULT_WAREHOUSE_ID })
      .update({ on_hand: 100, reserved: 0 });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** A per-channel override on one channel, written the way the admin screen writes it. */
  async function setForChannel(setting: string, channelCode: string, value: unknown): Promise<void> {
    await h.settings.adminService.setValueForSubset(setting, [channelCode], value, null, {
      actorAdminUserId: null,
    });
    await h.settings.cache.invalidate(setting);
  }

  async function withChannelValue<T>(
    setting: string,
    channelCode: string,
    value: unknown,
    manifestDefault: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    await setForChannel(setting, channelCode, value);
    try {
      return await run();
    } finally {
      await setForChannel(setting, channelCode, manifestDefault);
    }
  }

  async function freshBasket(): Promise<void> {
    const em = h.em();
    await em.nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    await seedCartForStubCustomer(em);
  }

  /** Places the basket. `channelCode` is the header; the body never names a channel. */
  async function place(channelCode?: string): Promise<{ statusCode: number; body: unknown }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: CUSTOMER,
      headers: {
        'content-type': 'application/json',
        ...(channelCode ? { 'x-sales-channel': channelCode } : {}),
      },
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function placeOk(channelCode?: string): Promise<{ id: string; businessId: string }> {
    const res = await place(channelCode);
    expect(res.statusCode).toBe(201);
    return (res.body as { data: { id: string; businessId: string } }).data;
  }

  async function allocatedWarehouse(orderId: string): Promise<string> {
    const em = h.em();
    const items = await em.find(OrderItem, { orderId });
    const allocations = await em.find(StockAllocation, {
      orderItemId: { $in: items.map((i) => i.id) },
    });
    expect(allocations.length).toBe(1);
    return allocations[0]!.warehouseId;
  }

  function expectBelowMinimum(res: { statusCode: number; body: unknown }, minimum: number): void {
    expect(res.statusCode).toBe(422);
    expect(
      (res.body as { error: { details?: { code?: string; minimum?: number } } }).error.details,
    ).toMatchObject({ code: 'order_below_minimum', minimum });
  }

  it('numbers the order with the prefix of the channel the request named', async () => {
    await withChannelValue(BUSINESS_ID_PREFIX, channelB.code, 'B-', '', async () => {
      await freshBasket();
      const onB = await placeOk(channelB.code);
      expect(onB.businessId.startsWith('B-')).toBe(true);

      // The control: the same shop, the same moment, no channel named. Channel
      // B's prefix must not leak onto an order placed on the default channel.
      await freshBasket();
      const onDefault = await placeOk();
      expect(onDefault.businessId.startsWith('B-')).toBe(false);
    });
  });

  it('allocates the stock from the warehouses of the channel the request named', async () => {
    await freshBasket();
    const onB = await placeOk(channelB.code);
    expect(await allocatedWarehouse(onB.id)).toBe(CHANNEL_B_WAREHOUSE_ID);

    await freshBasket();
    const onDefault = await placeOk();
    expect(await allocatedWarehouse(onDefault.id)).not.toBe(CHANNEL_B_WAREHOUSE_ID);
  });

  it('applies the minimum order value of the channel the request named, and only there', async () => {
    await withChannelValue(MIN_ORDER_VALUE, channelB.code, 10_000, 0, async () => {
      await freshBasket();
      expectBelowMinimum(await place(channelB.code), 10_000);

      // The same basket, still active after the refusal, on the default
      // channel: channel B's minimum is not this order's.
      expect((await place()).statusCode).toBe(201);
    });
  });

  /**
   * The one-channel instance. No header, no body field: before the route
   * changed this placement read the minimum platform-wide and was accepted; it
   * now reads it for the default channel the request resolved, and the value
   * the operator set there applies.
   */
  it('applies a minimum set on the default channel to an order that names no channel', async () => {
    await withChannelValue(MIN_ORDER_VALUE, defaultChannel.code, 10_000, 0, async () => {
      await freshBasket();
      expectBelowMinimum(await place(), 10_000);
    });

    // Back at the manifest default the same basket goes through — the refusal
    // above was the setting, not a placement broken for another reason.
    expect((await place()).statusCode).toBe(201);
  });
});
