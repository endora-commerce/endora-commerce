import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ADMIN_ORDER_MAX_ITEMS, ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order, Product } from '../../helpers/package-entities.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155, Phase 8a (T057a; FR-038, US4 #17; research R20; threat F4) — admin
 * create-order and its preview refuse more than `ADMIN_ORDER_MAX_ITEMS` items whole,
 * `422 VALIDATION_FAILED` with `details: { code: 'too_many_items', maximum }`, as
 * their first step: no catalogue read and no cart write happens. The schemas stay
 * unbounded on purpose — a Zod refusal would answer 400.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

interface ErrorBody {
  error: { code: string; details?: unknown };
}
interface CatalogReadSlice {
  findById(...args: unknown[]): Promise<unknown>;
  findByIds(...args: unknown[]): Promise<unknown>;
}
interface CartServiceSlice {
  addItem(...args: unknown[]): Promise<unknown>;
  addItems(...args: unknown[]): Promise<unknown>;
  getOrCreateForCustomer(...args: unknown[]): Promise<unknown>;
}

describe('155 — admin create-order and preview: the item bound [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelId = '';
  let F: MinimumProductFixture;

  const cradle = () =>
    h.container.cradle as unknown as {
      catalogProductReadPort: CatalogReadSlice;
      cartService: CartServiceSlice;
    };

  const itemsOf = (count: number) => Array.from({ length: count }, () => ({ productId: F.id, quantity: 1 }));

  const create = (count: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: ADMIN,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelId,
        items: itemsOf(count),
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });

  const preview = (count: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: ADMIN,
      payload: { customerAccountId: TEST_CUSTOMER_ID, salesChannelId: channelId, items: itemsOf(count) },
    });

  /** Every catalogue read and cart write either surface could reach. */
  const watch = () => {
    const spies = [
      vi.spyOn(cradle().catalogProductReadPort, 'findById'),
      vi.spyOn(cradle().catalogProductReadPort, 'findByIds'),
      vi.spyOn(cradle().cartService, 'addItem'),
      vi.spyOn(cradle().cartService, 'addItems'),
      // The way the write port's `getOrCreateForCustomer` and
      // `replaceItemsForCustomer` reach a customer's basket.
      vi.spyOn(cradle().cartService, 'getOrCreateForCustomer'),
    ];
    return {
      calls: () => spies.reduce((n, spy) => n + spy.mock.calls.length, 0),
      restore: () => spies.forEach((spy) => spy.mockRestore()),
    };
  };

  const expectTooManyItems = (res: { statusCode: number; body: string; json: () => unknown }) => {
    expect(res.statusCode, res.body.slice(0, 500)).toBe(422);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details).toEqual({ code: 'too_many_items', maximum: ADMIN_ORDER_MAX_ITEMS });
  };

  const orderCount = async () => {
    const em = h.em();
    em.clear();
    return em.count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID }, { filters: false });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = await systemDefaultSalesChannelId(em);
    const channels = Array.from(new Set([channelId, ...(await buyerChannelIds(em))]));
    F = await createMinimumProduct(em, {
      sku: `AOB-F-${RUN}`,
      nameEn: `Free ${RUN}`,
      namePl: `Wolny ${RUN}`,
      channelIds: channels,
    });
    await em.nativeUpdate(Product, { id: F.id }, { manageStock: false });
  }, 180_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it(`create with ${ADMIN_ORDER_MAX_ITEMS + 1} items → 422 too_many_items; nothing read, nothing written`, async () => {
    const watched = watch();
    const ordersBefore = await orderCount();
    try {
      expectTooManyItems(await create(ADMIN_ORDER_MAX_ITEMS + 1));
      expect(watched.calls()).toBe(0);
    } finally {
      watched.restore();
    }
    expect(await orderCount()).toBe(ordersBefore);
  });

  it(`preview with ${ADMIN_ORDER_MAX_ITEMS + 1} items → 422 too_many_items; no catalogue read`, async () => {
    const watched = watch();
    try {
      expectTooManyItems(await preview(ADMIN_ORDER_MAX_ITEMS + 1));
      expect(watched.calls()).toBe(0);
    } finally {
      watched.restore();
    }
  });

  it(`create with ${ADMIN_ORDER_MAX_ITEMS} items passes the bound — and the watch does see that request`, async () => {
    const watched = watch();
    const ordersBefore = await orderCount();
    try {
      const res = await create(ADMIN_ORDER_MAX_ITEMS);
      expect(res.statusCode, res.body.slice(0, 500)).toBe(201);
      expect(watched.calls()).toBeGreaterThan(0);
    } finally {
      watched.restore();
    }
    expect(await orderCount()).toBe(ordersBefore + 1);
  }, 120_000);

  it(`preview with ${ADMIN_ORDER_MAX_ITEMS} items passes the bound — and the watch does see that request`, async () => {
    const watched = watch();
    try {
      const res = await preview(ADMIN_ORDER_MAX_ITEMS);
      expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
      expect(watched.calls()).toBeGreaterThan(0);
    } finally {
      watched.restore();
    }
  }, 120_000);
});
