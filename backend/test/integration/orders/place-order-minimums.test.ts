import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type CartWritePort, type OrderPlacementPort } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart, CartItem, Order, Product, ProductPackagingUnit, StockLevel } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  acceptedQuoteRequest,
  checkOutBasket,
  convertQuoteRequestToCart,
  whenOrderCreatedSettled,
} from '../../helpers/quote-conversion.js';
import {
  buyerChannelIds,
  createMinimumPackagingUnit,
  createMinimumProduct,
  minimumFixtureRun,
  setProductMinimum,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155, Phase 8 (T056) — placement refuses a basket with a line below a
 * minimum, before any side effect, and the checkout preview reports the same
 * lines (FR-008, FR-037; US1 #5, US2 #7, US4 #4, US4 #7; research R19; threat F3).
 *
 * The baskets below a minimum are written through `replaceItemsForCustomer` with
 * no quote source — the seed a reorder writes — because the add route refuses
 * them (Phase 6); a line of a product whose row is gone, and a line in a
 * packaging unit, are inserted as rows, as the cart tests do.
 *
 * The seeded product 101 carries a minimum of 10 for the whole file (restored in
 * `afterAll`); its quote and its historic order are made before the minimum is
 * set — negotiated and ordered before the rule existed.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const CTX = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
/** The buyer's basket of the system-default channel (`specs/154-sales-channel-access/`). */
let BASKET_CTX: typeof CTX & { salesChannelId: string };
const PLACEMENT = {
  deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
  billingAddressId: SEED_ADDRESS_BILLING_ID,
  deliveryMethodId: SEED_DELIVERY_METHOD_ID,
  paymentMethodId: SEED_PAYMENT_METHOD_ID,
};

/** The two writes of `inventory`'s placement port this file watches for. */
interface ReservationWrites {
  lockAvailabilityForPlacement(...args: unknown[]): Promise<unknown>;
  reserveForPlacement(...args: unknown[]): Promise<unknown>;
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface BelowMinimumLine {
  cartItemId: string;
  productId: string;
  productName?: string;
  kind: string;
  minimum?: number;
  packagingUnitName?: string;
}

describe('155 — placement and the checkout preview refuse below-minimum lines [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let previousMinimumOf101: number | null = null;
  let nameOf101 = '';
  let A: MinimumProductFixture;
  let B: MinimumProductFixture;
  let P: MinimumProductFixture;
  let palletOfP = '';
  const PALLET_NAME = `Pallet ${RUN}`;
  let quoteOf101x5 = '';
  let historicOrderId = '';

  const cradle = () =>
    h.container.cradle as unknown as {
      orderPlacementPort: OrderPlacementPort;
      inventoryReservationApplyPort: ReservationWrites;
      cartWritePort: CartWritePort;
      quickOrderOneClickService: object;
    };

  const completeActiveBaskets = () =>
    h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

  const seed = (lines: Array<{ productId: string; quantity: number; unitPrice?: string }>) =>
    cartWritePortOf(h).replaceItemsForCustomer(
      BASKET_CTX,
      lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice ?? '10.00', currency: 'PLN' })),
    );

  const activeCart = async () => {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
  };

  const basketLines = async () => {
    const em = h.em();
    em.clear();
    return em.find(CartItem, { cartId: (await activeCart()).id }, { filters: false });
  };

  const lineIdOf = async (productId: string) => {
    const line = (await basketLines()).find((l) => l.productId === productId);
    if (!line) throw new Error(`no line of ${productId} on the basket`);
    return line.id;
  };

  const insertLine = async (input: {
    productId: string;
    quantity: number;
    packagingUnitId?: string;
    packagingUnitName?: string;
    packagingUnitBaseQuantity?: number;
  }): Promise<string> => {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into cart_items (id, cart_id, product_id, quantity, unit_price, currency, packaging_unit_id, packaging_unit_name, packaging_unit_base_quantity, created_at, updated_at)
         values (?, ?, ?, ?, 10, 'PLN', ?, ?, ?, now() + interval '1 second', now())`,
        [
          id,
          (await activeCart()).id,
          input.productId,
          input.quantity,
          input.packagingUnitId ?? null,
          input.packagingUnitName ?? null,
          input.packagingUnitBaseQuantity ?? null,
        ],
      );
    return id;
  };

  const placeHttp = (acceptLanguage = 'en') =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: CUSTOMER,
      headers: { 'accept-language': acceptLanguage },
      payload: PLACEMENT,
    });

  const preview = async (acceptLanguage?: string): Promise<BelowMinimumLine[]> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies: CUSTOMER,
      ...(acceptLanguage ? { headers: { 'accept-language': acceptLanguage } } : {}),
      payload: { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { belowMinimumLines: BelowMinimumLine[] } }).data.belowMinimumLines;
  };

  const errorOf = (res: { json: () => unknown }) => (res.json() as ErrorBody).error;

  const businessIdSequence = async () => {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ last_value: string; is_called: boolean }>>(
        `select last_value, is_called from orders_business_id_seq`,
      );
    return rows[0];
  };
  const reservedOf101 = async () => {
    const em = h.em();
    em.clear();
    const levels = await em.find(StockLevel, { productId: SEED_PRODUCT_101_ID }, { filters: false });
    return levels.map((l) => [l.warehouseId, l.reserved]).sort();
  };
  const orderCount = async () => {
    const em = h.em();
    em.clear();
    return em.count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID }, { filters: false });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    BASKET_CTX = { ...CTX, salesChannelId: await systemDefaultSalesChannelId(h.em()) };
    const em = h.em();
    await em
      .getConnection()
      .execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [SEED_PRODUCT_101_ID]);
    const p101 = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID }, { filters: false });
    previousMinimumOf101 = p101.minOrderQuantity ?? null;
    nameOf101 = Object.values(p101.name as Record<string, string>)[0] ?? '';

    // Before the rule exists: a quote for 101 × 5, and an order of 101 × 5.
    await setProductMinimum(em, SEED_PRODUCT_101_ID, null);
    quoteOf101x5 = (await acceptedQuoteRequest(h, { quantity: 5, agreedUnitPrice: 11.25 })).id;
    await completeActiveBaskets();
    await seed([{ productId: SEED_PRODUCT_101_ID, quantity: 5 }]);
    historicOrderId = (await whenOrderCreatedSettled(h, () => checkOutBasket(h))).id;
    await setProductMinimum(em, SEED_PRODUCT_101_ID, 10);

    const channels = await buyerChannelIds(em);
    A = await createMinimumProduct(em, {
      sku: `POM-A-${RUN}`,
      nameEn: `Anchor ${RUN}`,
      namePl: `Kotwa ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    B = await createMinimumProduct(em, {
      sku: `POM-B-${RUN}`,
      nameEn: `Bolt ${RUN}`,
      namePl: `Sruba ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    P = await createMinimumProduct(em, {
      sku: `POM-P-${RUN}`,
      nameEn: `Paver ${RUN}`,
      namePl: `Kostka ${RUN}`,
      channelIds: channels,
    });
    palletOfP = await createMinimumPackagingUnit(em, {
      productId: P.id,
      name: PALLET_NAME,
      baseQuantity: 64,
      minOrderUnits: 2,
    });
  }, 180_000);

  beforeEach(async () => {
    await completeActiveBaskets();
  });

  afterAll(async () => {
    const em = h.em();
    await setProductMinimum(em, SEED_PRODUCT_101_ID, previousMinimumOf101);
    await em.nativeDelete(CartItem, { packagingUnitId: palletOfP });
    await em.nativeDelete(ProductPackagingUnit, { id: palletOfP });
    await teardownBackendServer(h);
  });

  it('US1 #5 — refuses a basket below a minimum, naming the product and every offending line, before any side effect [F3]', async () => {
    await seed([
      { productId: A.id, quantity: 5 },
      { productId: B.id, quantity: 3 },
      { productId: SEED_PRODUCT_101_ID, quantity: 10 },
    ]);
    const lineA = await lineIdOf(A.id);
    const lineB = await lineIdOf(B.id);
    const sequenceBefore = await businessIdSequence();
    const reservedBefore = await reservedOf101();
    const ordersBefore = await orderCount();
    const lock = vi.spyOn(cradle().inventoryReservationApplyPort, 'lockAvailabilityForPlacement');
    const reserve = vi.spyOn(cradle().inventoryReservationApplyPort, 'reserveForPlacement');
    try {
      const res = await placeHttp();
      expect(res.statusCode, res.body).toBe(422);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      const named = error.details?.['productName'];
      expect([A.nameEn, B.nameEn]).toContain(named);
      expect(error.details?.['minimum']).toBe(10);
      expect(error.message).toBe(`"${String(named)}" has a minimum order quantity of 10 pcs.`);
      const lines = (error.details?.['lines'] ?? []) as BelowMinimumLine[];
      expect(
        lines.map((l) => [l.cartItemId, l.productId, l.productName, l.kind, l.minimum]).sort(),
      ).toEqual(
        [
          [lineA, A.id, A.nameEn, 'pieces', 10],
          [lineB, B.id, B.nameEn, 'pieces', 10],
        ].sort(),
      );
      expect(lock).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
    } finally {
      lock.mockRestore();
      reserve.mockRestore();
    }
    // Nothing written: no business id drawn, no stock reserved, no order, the basket intact.
    expect(await businessIdSequence()).toEqual(sequenceBefore);
    expect(await reservedOf101()).toEqual(reservedBefore);
    expect(await orderCount()).toBe(ordersBefore);
    expect((await basketLines()).length).toBe(3);
  });

  it('D3/D4 — a Polish placement refusal names every product in Polish, as the preview does', async () => {
    await seed([
      { productId: A.id, quantity: 5 },
      { productId: B.id, quantity: 3 },
      { productId: SEED_PRODUCT_101_ID, quantity: 10 },
    ]);
    const res = await placeHttp('pl;q=0.9,en;q=0.1');
    expect(res.statusCode, res.body).toBe(422);
    const error = errorOf(res);
    const named = error.details?.['productName'];
    expect([A.namePl, B.namePl]).toContain(named);
    expect(error.message).toBe(`Minimalna ilość zamówienia produktu „${String(named)}” to 10 szt.`);
    const lines = (error.details?.['lines'] ?? []) as BelowMinimumLine[];
    expect(lines.map((l) => l.productName).sort()).toEqual([A.namePl, B.namePl].sort());
    expect((await preview('pl')).map((l) => l.productName).sort()).toEqual([A.namePl, B.namePl].sort());
  });

  it('the preview lists the same lines, and an empty list for a valid basket', async () => {
    await seed([
      { productId: A.id, quantity: 5 },
      { productId: B.id, quantity: 3 },
      { productId: SEED_PRODUCT_101_ID, quantity: 10 },
    ]);
    const lineA = await lineIdOf(A.id);
    const lineB = await lineIdOf(B.id);
    const listed = await preview();
    expect(listed.map((l) => [l.cartItemId, l.productId, l.kind, l.minimum]).sort()).toEqual(
      [
        [lineA, A.id, 'pieces', 10],
        [lineB, B.id, 'pieces', 10],
      ].sort(),
    );
    expect(listed.every((l) => typeof l.productName === 'string' && l.productName.length > 0)).toBe(true);

    await seed([{ productId: SEED_PRODUCT_101_ID, quantity: 10 }]);
    expect(await preview()).toEqual([]);
  });

  it('US2 #7 — a packaging-unit line below the unit minimum is refused at placement and listed by the preview', async () => {
    await seed([{ productId: SEED_PRODUCT_101_ID, quantity: 10 }]);
    const pallet = await insertLine({
      productId: P.id,
      quantity: 64,
      packagingUnitId: palletOfP,
      packagingUnitName: PALLET_NAME,
      packagingUnitBaseQuantity: 64,
    });
    const res = await placeHttp();
    expect(res.statusCode, res.body).toBe(422);
    const error = errorOf(res);
    expect(error.code).toBe(ERROR_CODES.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY);
    expect(error.details).toMatchObject({ productName: P.nameEn, packagingUnitName: PALLET_NAME, minimum: 2 });
    expect(error.details?.['lines']).toEqual([
      expect.objectContaining({ cartItemId: pallet, productId: P.id, kind: 'packaging_unit', minimum: 2 }),
    ]);
    expect(await preview()).toEqual([
      expect.objectContaining({ cartItemId: pallet, kind: 'packaging_unit', minimum: 2, packagingUnitName: PALLET_NAME }),
    ]);
  });

  it('US4 #4 — a reorder of 101 × 5 seeds the line, flags it, and is refused at placement', async () => {
    const reordered = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${historicOrderId}/reorder`,
      cookies: CUSTOMER,
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    const line = (await basketLines()).find((l) => l.productId === SEED_PRODUCT_101_ID);
    expect(line?.quantity).toBe(5);
    const view = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: CUSTOMER });
    const items = (view.json() as { data: { items: Array<{ productId: string; belowMinimum: unknown }> } }).data.items;
    expect(items.find((i) => i.productId === SEED_PRODUCT_101_ID)?.belowMinimum).toEqual({ kind: 'pieces', minimum: 10 });

    const res = await placeHttp();
    expect(res.statusCode, res.body).toBe(422);
    expect(errorOf(res)).toMatchObject({
      code: ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY,
      details: { productId: SEED_PRODUCT_101_ID, productName: nameOf101, minimum: 10 },
    });
  });

  it('US4 #7 — the accepted quote’s 101 × 5, unchanged, is placed and names its source', async () => {
    await convertQuoteRequestToCart(h, quoteOf101x5);
    expect(await preview()).toEqual([]);
    const placed = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
    const em = h.em();
    em.clear();
    const order = await em.findOneOrFail(Order, { id: placed.id }, { filters: false });
    expect(order.sourceQuoteRequestId).toBe(quoteOf101x5);
  });

  it('the port entry point — a direct OrderPlacementPort.placeOrder of a below-minimum basket is refused [F3]', async () => {
    await seed([{ productId: A.id, quantity: 5 }]);
    const ordersBefore = await orderCount();
    await expect(
      enterSystemScope('test: a direct placement through the port', () =>
        cradle().orderPlacementPort.placeOrder(CTX, PLACEMENT),
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY });
    expect(await orderCount()).toBe(ordersBefore);
  });

  it('the one-click entry point — with the add path replaced by a double that admits A × 5, placement still refuses [F3]', async () => {
    // The composed one-click service, rebuilt around a cart double whose
    // `addItems` (the one-click write path since round C, T167) writes the line
    // without any check, and the real placement port.
    const OneClickService = cradle().quickOrderOneClickService.constructor as new (
      ...args: unknown[]
    ) => { place(ctx: unknown, input: unknown, salesChannelId: string): Promise<unknown> };
    const realCart = cradle().cartWritePort;
    let workingCartId = '';
    const uncheckedCart = {
      addItems: async (_actor: unknown, lines: Array<{ productId: string; quantity: number }>) => {
        const seeded = await realCart.replaceItemsForCustomer(
          BASKET_CTX,
          lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: '10.00', currency: 'PLN' })),
        );
        // Issue #169 — one-click places from the working basket `addItems` hands
        // back: the double hands back an unchecked one.
        await h.em().getConnection().execute(`update carts set status = 'working' where id = ?`, [seeded.cart.id]);
        workingCartId = seeded.cart.id;
        return { ...seeded, cart: { ...seeded.cart, status: 'working' }, outcomes: [] };
      },
    };
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
      uncheckedCart,
      cradle().orderPlacementPort,
      async () => true,
      // Phase 9 (T071) — the default-quantity read; unused here, the quantity is explicit.
      (h.container.cradle as unknown as { catalogProductReadPort: unknown }).catalogProductReadPort,
    );
    const ordersBefore = await orderCount();
    await expect(oneClick.place(CTX, { productId: A.id, quantity: 5 }, BASKET_CTX.salesChannelId)).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY,
    });
    // The refused placement removed the working basket it was handed.
    const left = await h.em().getConnection().execute(`select id from carts where id = ?`, [workingCartId]);
    expect(left).toEqual([]);
    expect(await orderCount()).toBe(ordersBefore);
  });

  it('FR-037 — a line whose product row is gone refuses placement with 404 PRODUCT_NOT_FOUND and its cart item id; nothing written', async () => {
    await seed([{ productId: SEED_PRODUCT_101_ID, quantity: 10 }]);
    const ghost = await insertLine({ productId: randomUUID(), quantity: 3 });
    const sequenceBefore = await businessIdSequence();
    const reservedBefore = await reservedOf101();
    const ordersBefore = await orderCount();

    const res = await placeHttp();
    expect(res.statusCode, res.body).toBe(404);
    const error = errorOf(res);
    expect(error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    expect(error.details).toEqual({ cartItemIds: [ghost] });

    expect(await businessIdSequence()).toEqual(sequenceBefore);
    expect(await reservedOf101()).toEqual(reservedBefore);
    expect(await orderCount()).toBe(ordersBefore);

    const listed = await preview();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ cartItemId: ghost, kind: 'product_unavailable' });
    expect(listed[0]).not.toHaveProperty('productName');
    expect(listed[0]).not.toHaveProperty('minimum');
  });
});
