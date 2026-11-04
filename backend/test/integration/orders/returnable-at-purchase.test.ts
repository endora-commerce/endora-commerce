import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CartWritePort, CatalogProductReadPort, OrderPlacementPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrderItem, Product } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import {
  acceptedQuoteRequest,
  checkOutBasket,
  convertQuoteRequestToCart,
  whenOrderCreatedSettled,
} from '../../helpers/quote-conversion.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155, Phase 12 (T090) — every placement path stamps
 * `order_items.returnable_at_purchase` from the product's returnable flag as it
 * stood at that moment (FR-016a, D-44, US6 #6): checkout, one-click, admin
 * create, API intake and an accepted-quote checkout. Changing the flag
 * afterwards changes no line; no new row is ever `null`; a row written without
 * the column reads `null` (placed before the feature, FR-025 — that policy is
 * `returns`', Phase 12a).
 *
 * Two per-run products: R (returnable) and N (not), unmanaged stock so they
 * place without stock rows. The accepted-quote path is the seeded product 101
 * (the quote helper's product), whose flag is set for the case and restored.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CTX = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
/** The buyer's basket of the system-default channel (`specs/154-sales-channel-access/`). */
let BASKET_CTX: typeof CTX & { salesChannelId: string };

describe('155 — placement stamps returnable_at_purchase on every path [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelId = '';
  let R: MinimumProductFixture;
  let N: MinimumProductFixture;
  let token = '';
  let previousFlagOf101 = false;
  /** Every order this file placed, for the "a later flag change moves nothing" case. */
  const placedOrderIds: string[] = [];

  const cradle = () =>
    h.container.cradle as unknown as {
      orderPlacementPort: OrderPlacementPort;
      cartWritePort: CartWritePort;
      catalogProductReadPort: CatalogProductReadPort;
      quickOrderOneClickService: object;
    };

  const completeActiveBaskets = () =>
    h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

  /** `productId → returnableAtPurchase` of an order's lines, read fresh. */
  const stampsOf = async (orderId: string): Promise<Record<string, boolean | null | undefined>> => {
    const em = h.em();
    em.clear();
    const items = await em.find(OrderItem, { orderId }, { filters: false });
    return Object.fromEntries(items.map((i) => [i.productId, i.returnableAtPurchase]));
  };

  const setReturnable = (productIds: string[], returnable: boolean) =>
    h.em().nativeUpdate(Product, { id: { $in: productIds } }, { returnable });

  const placed = (id: string) => {
    placedOrderIds.push(id);
    return id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    BASKET_CTX = { ...CTX, salesChannelId: await systemDefaultSalesChannelId(h.em()) };
    const em = h.em();
    channelId = await systemDefaultSalesChannelId(em);
    const channels = Array.from(new Set([channelId, ...(await buyerChannelIds(em))]));
    R = await createMinimumProduct(em, {
      sku: `RAP-R-${RUN}`,
      nameEn: `Returnable ${RUN}`,
      namePl: `Zwrotny ${RUN}`,
      returnable: true,
      channelIds: channels,
    });
    N = await createMinimumProduct(em, {
      sku: `RAP-N-${RUN}`,
      nameEn: `Final ${RUN}`,
      namePl: `Bezzwrotny ${RUN}`,
      returnable: false,
      channelIds: channels,
    });
    await em.nativeUpdate(Product, { id: { $in: [R.id, N.id] } }, { manageStock: false });
    previousFlagOf101 = (await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID }, { filters: false })).returnable;

    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: {
        name: `Returnable intake ${RUN}`,
        scopes: ['orders:read', 'orders:write'],
        binding: { organizationId: TEST_ORGANIZATION_ID, salesChannelId: channelId, customerAccountId: TEST_CUSTOMER_ID },
      },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    token = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
  }, 180_000);

  beforeEach(async () => {
    await completeActiveBaskets();
  });

  afterAll(async () => {
    await setReturnable([SEED_PRODUCT_101_ID], previousFlagOf101);
    await teardownBackendServer(h);
  });

  it('checkout — R true, N false', async () => {
    await cartWritePortOf(h).replaceItemsForCustomer(BASKET_CTX, [
      { productId: R.id, quantity: 1, unitPrice: '10.00', currency: 'PLN' },
      { productId: N.id, quantity: 1, unitPrice: '10.00', currency: 'PLN' },
    ]);
    const order = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
    expect(await stampsOf(placed(order.id))).toEqual({ [R.id]: true, [N.id]: false });
  });

  it('one-click — R true, then N false', async () => {
    // The composed one-click service, rebuilt with the real cart and placement
    // ports and the buyer's defaults answered directly, so the operator setting
    // that gates the route is not mutated here (the route is `quick_order`'s
    // own test: `contract/quick_order/one-click-place.test.ts`).
    const OneClickService = cradle().quickOrderOneClickService.constructor as new (
      ...args: unknown[]
    ) => { place(ctx: unknown, input: unknown, salesChannelId: string): Promise<{ id: string }> };
    const preferences = {
      resolveForCustomer: async () => ({
        shippingAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      }),
    };
    const oneClick = new OneClickService(
      preferences,
      cradle().cartWritePort,
      cradle().orderPlacementPort,
      async () => true,
      cradle().catalogProductReadPort,
      // `specs/170-organization-roles/` (FR-050) — the buyer's role is judged too.
      (h.container.cradle as unknown as { organizationPermissionPort: unknown }).organizationPermissionPort,
    );
    const viaR = await whenOrderCreatedSettled(h, () => oneClick.place(CTX, { productId: R.id, quantity: 1 }, channelId));
    expect(await stampsOf(placed(viaR.id))).toEqual({ [R.id]: true });
    const viaN = await whenOrderCreatedSettled(h, () => oneClick.place(CTX, { productId: N.id, quantity: 1 }, channelId));
    expect(await stampsOf(placed(viaN.id))).toEqual({ [N.id]: false });
  });

  it('admin create — R true, N false', async () => {
    const res = await whenOrderCreatedSettled(h, () =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders',
        cookies: ADMIN,
        payload: {
          customerAccountId: TEST_CUSTOMER_ID,
          salesChannelId: channelId,
          items: [
            { productId: R.id, quantity: 1 },
            { productId: N.id, quantity: 1 },
          ],
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
        },
      }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    expect(await stampsOf(placed(id))).toEqual({ [R.id]: true, [N.id]: false });
  });

  it('API intake — R true, N false', async () => {
    const res = await whenOrderCreatedSettled(h, () =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/external/orders',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': `rap-${randomUUID()}` },
        payload: {
          lines: [
            { sku: R.sku, quantity: 1 },
            { sku: N.sku, quantity: 1 },
          ],
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
        },
      }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    expect(await stampsOf(placed(id))).toEqual({ [R.id]: true, [N.id]: false });
  });

  it('accepted-quote checkout — the flag of 101 at that moment (true, then false)', async () => {
    await setReturnable([SEED_PRODUCT_101_ID], true);
    const quoteTrue = (await acceptedQuoteRequest(h, { quantity: 1 })).id;
    await convertQuoteRequestToCart(h, quoteTrue);
    const asTrue = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
    expect(await stampsOf(placed(asTrue.id))).toEqual({ [SEED_PRODUCT_101_ID]: true });

    await completeActiveBaskets();
    await setReturnable([SEED_PRODUCT_101_ID], false);
    const quoteFalse = (await acceptedQuoteRequest(h, { quantity: 1 })).id;
    await convertQuoteRequestToCart(h, quoteFalse);
    const asFalse = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
    expect(await stampsOf(placed(asFalse.id))).toEqual({ [SEED_PRODUCT_101_ID]: false });
  });

  it('US6 #6 — flipping every flag afterwards changes no line; no line placed here is null', async () => {
    expect(placedOrderIds.length).toBeGreaterThanOrEqual(6);
    const before = await Promise.all(placedOrderIds.map(stampsOf));
    for (const stamps of before) {
      for (const value of Object.values(stamps)) expect(typeof value).toBe('boolean');
    }
    await setReturnable([R.id], false);
    await setReturnable([N.id, SEED_PRODUCT_101_ID], true);
    try {
      expect(await Promise.all(placedOrderIds.map(stampsOf))).toEqual(before);
    } finally {
      await setReturnable([R.id], true);
      await setReturnable([N.id], false);
      await setReturnable([SEED_PRODUCT_101_ID], previousFlagOf101);
    }
  });

  it('a line written without the column reads null (placed before the feature)', async () => {
    const em = h.em();
    em.clear();
    const legacy = em.create(OrderItem, {
      orderId: placedOrderIds[0]!,
      productId: R.id,
      productSnapshot: { sku: R.sku, name: R.nameEn, primaryAssetUrl: null },
      quantity: 1,
      unitPrice: '10.00',
      taxRate: '0.0000',
      lineTotal: '10.00',
    });
    await em.persistAndFlush(legacy);
    try {
      const rows = await em
        .getConnection()
        .execute<Array<{ returnable_at_purchase: boolean | null }>>(
          `select "returnable_at_purchase" from "order_items" where "id" = ?`,
          [legacy.id],
        );
      expect(rows).toEqual([{ returnable_at_purchase: null }]);
    } finally {
      await em.nativeDelete(OrderItem, { id: legacy.id });
    }
  });
});
