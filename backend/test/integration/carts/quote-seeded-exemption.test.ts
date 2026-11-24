import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as contracts from '@endora-commerce/contracts';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { z } from 'zod';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  Cart,
  CartItem,
  Product,
  ProductPackagingUnit,
  type CartItemRow,
} from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  acceptedQuoteRequest,
  checkOutBasket,
  convertQuoteRequestToCart,
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
 * Feature 155, Phase 6 (T040) — quote-seeded lines are exempt from the
 * minimums while their quantity equals the quote's (FR-028, owner ruling P2;
 * `data-model.md` §2, research R4).
 *
 * A is the seeded catalogue product 101, because the quote-to-order road
 * (`helpers/quote-conversion.ts`) is walked with it. Its quotes are accepted in
 * `beforeAll`, **before** A's minimum of 10 is set — a quote for 5 negotiated
 * before the minimum existed (US4 #7) — and the minimum is restored afterwards.
 *
 * The exemption rides the line's agreement: `CartItemRecord.quoteSeededQuantity`
 * is mapped from `cart_items.agreed_quantity`, the quantity an accepted quote's
 * agreed price holds at. **Only `replaceItemsForCustomer` writes it** (plan I4,
 * threat F9). Checked by hand with
 *
 *     git grep -n "agreedQuantity" -- packages/modules ':!*.test.ts'
 *
 * which names the entity, the read-port seed and mapper, and readers only; and
 * below, by reading the row after every other path that creates or changes a
 * line (add, login merge, reorder seed). Neither the column nor the basket's
 * quote mark is in any request schema, so no client can forge the exemption.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const CTX = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
/** The buyer's basket of the system-default channel (`specs/154-sales-channel-access/`). */
let BASKET_CTX: typeof CTX & { salesChannelId: string };

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface CartViewLine {
  id: string;
  productId: string;
  quantity: number;
  belowMinimum?: { kind: string; minimum: number } | null;
}

describe('155 — quote-seeded lines are exempt while unchanged [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let previousMinimumOfA: number | null = null;
  let B: MinimumProductFixture;
  let E: MinimumProductFixture;
  let unitOf3 = '';
  let unitOf5 = '';
  /** Accepted quotes for A × 5, one per scenario that converts one. */
  const quotes: Record<'places' | 'sevenA' | 'sevenC' | 'sevenD' | 'sevenDRefused', string> = {
    places: '',
    sevenA: '',
    sevenC: '',
    sevenD: '',
    sevenDRefused: '',
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    BASKET_CTX = { ...CTX, salesChannelId: await systemDefaultSalesChannelId(h.em()) };
    const em = h.em();
    const a = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID }, { filters: false });
    previousMinimumOfA = a.minOrderQuantity ?? null;
    // Accepted before A has a minimum — the negotiated quantity predates the rule.
    await setProductMinimum(em, SEED_PRODUCT_101_ID, null);
    for (const key of Object.keys(quotes) as Array<keyof typeof quotes>) {
      quotes[key] = (await acceptedQuoteRequest(h, { quantity: 5, agreedUnitPrice: 11.25 })).id;
    }
    await setProductMinimum(em, SEED_PRODUCT_101_ID, 10);

    const channels = await buyerChannelIds(em);
    B = await createMinimumProduct(em, {
      sku: `QSE-B-${RUN}`,
      nameEn: `Bracket ${RUN}`,
      namePl: `Wspornik ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    E = await createMinimumProduct(em, {
      sku: `QSE-E-${RUN}`,
      nameEn: `Elbow ${RUN}`,
      namePl: `Kolano ${RUN}`,
      minOrderQuantity: 5,
      channelIds: channels,
    });
    // Packaging units of A, so a *new* line of A can be added beside the seeded one (#7c).
    unitOf3 = await createMinimumPackagingUnit(em, {
      productId: SEED_PRODUCT_101_ID,
      name: `Pack of 3 ${RUN}`,
      baseQuantity: 3,
    });
    unitOf5 = await createMinimumPackagingUnit(em, {
      productId: SEED_PRODUCT_101_ID,
      name: `Pack of 5 ${RUN}`,
      baseQuantity: 5,
    });
  }, 120_000);

  afterAll(async () => {
    const em = h.em();
    await setProductMinimum(em, SEED_PRODUCT_101_ID, previousMinimumOfA);
    // Lines still referencing the two units go first; placed orders keep their own snapshot.
    await em.nativeDelete(CartItem, { packagingUnitId: { $in: [unitOf3, unitOf5] } });
    await em.nativeDelete(ProductPackagingUnit, { id: { $in: [unitOf3, unitOf5] } });
    await teardownBackendServer(h);
  });

  async function basketLines(): Promise<CartItemRow[]> {
    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(
      Cart,
      { customerAccountId: TEST_CUSTOMER_ID, status: 'active' },
      { filters: false },
    );
    return em.find(CartItem, { cartId: cart.id }, { orderBy: { createdAt: 'asc', id: 'asc' } });
  }

  async function lineOf(productId: string): Promise<CartItemRow> {
    const line = (await basketLines()).find((l) => l.productId === productId && !l.packagingUnitId);
    if (!line) throw new Error(`no line of ${productId} on the basket`);
    return line;
  }

  async function edit(itemId: string, quantity: number) {
    return h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      cookies: CUSTOMER,
      headers: { 'content-type': 'application/json', 'accept-language': 'en' },
      payload: { quantity },
    });
  }

  async function add(payload: { productId: string; quantity: number; packagingUnitId?: string }) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: CUSTOMER,
      headers: { 'content-type': 'application/json', 'accept-language': 'en' },
      payload,
    });
  }

  async function viewLines(): Promise<CartViewLine[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: CUSTOMER });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { items: CartViewLine[] } }).data.items;
  }

  const codeOf = (res: { json: () => unknown }) => (res.json() as ErrorBody).error.code;

  it('a seed with a quote source records each line’s seeded quantity; the lines are exempt', async () => {
    const source = randomUUID();
    await cartWritePortOf(h).replaceItemsForCustomer(
      BASKET_CTX,
      [
        { productId: SEED_PRODUCT_101_ID, quantity: 5, unitPrice: '11.25', currency: 'PLN' },
        { productId: B.id, quantity: 3, unitPrice: '10.00', currency: 'PLN' },
      ],
      { sourceQuoteRequestId: source },
    );
    // One flush writes both rows, so their order is not the seed's: compare by product.
    const byProduct = new Map((await basketLines()).map((l) => [l.productId, [l.quantity, l.agreedQuantity]]));
    expect(byProduct).toEqual(
      new Map([
        [SEED_PRODUCT_101_ID, [5, 5]],
        [B.id, [3, 3]],
      ]),
    );
    const read = await cartWritePortOf(h).replaceItemsForCustomer(
      BASKET_CTX,
      [{ productId: SEED_PRODUCT_101_ID, quantity: 5, unitPrice: '11.25', currency: 'PLN' }],
      { sourceQuoteRequestId: source },
    );
    // The record carries it, so the placement read sees the same state.
    expect(read.items.map((i) => i.quoteSeededQuantity)).toEqual([5]);
    expect((await viewLines()).map((l) => l.belowMinimum ?? null)).toEqual([null]);
  });

  it('#7 — the accepted quote’s A × 5 is checked out unchanged and the order is placed', async () => {
    await convertQuoteRequestToCart(h, quotes.places);
    expect((await lineOf(SEED_PRODUCT_101_ID)).agreedQuantity).toBe(5);
    const placed = await checkOutBasket(h);
    expect(placed.id).toBeTruthy();
  });

  it('#7a — a seeded B × 3 (min 10) edited to 4 is refused; A stays exempt; checkout succeeds once B is removed', async () => {
    await convertQuoteRequestToCart(h, quotes.sevenA);
    const cart = await h
      .em()
      .findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
    // The same quote's basket, with a second seeded line beside the agreed one.
    await cartWritePortOf(h).replaceItemsForCustomer(
      BASKET_CTX,
      [
        { productId: SEED_PRODUCT_101_ID, quantity: 5, unitPrice: '11.25', currency: 'PLN' },
        { productId: B.id, quantity: 3, unitPrice: '10.00', currency: 'PLN' },
      ],
      { sourceQuoteRequestId: cart.sourceQuoteRequestId ?? quotes.sevenA },
    );
    const b = await lineOf(B.id);
    const refused = await edit(b.id, 4);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(codeOf(refused)).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    expect((await lineOf(B.id)).quantity).toBe(3);
    const a = (await viewLines()).find((l) => l.productId === SEED_PRODUCT_101_ID)!;
    expect(a.belowMinimum ?? null).toBeNull();

    const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/cart/items/${b.id}`, cookies: CUSTOMER });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await checkOutBasket(h)).id).toBeTruthy();
  });

  it('#7b — a line added after the quote was loaded is not exempt', async () => {
    await cartWritePortOf(h).replaceItemsForCustomer(
      BASKET_CTX,
      [{ productId: SEED_PRODUCT_101_ID, quantity: 5, unitPrice: '11.25', currency: 'PLN' }],
      { sourceQuoteRequestId: randomUUID() },
    );
    const res = await add({ productId: E.id, quantity: 2 });
    expect(res.statusCode, res.body).toBe(422);
    expect(codeOf(res)).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    expect((await basketLines()).map((l) => l.productId)).toEqual([SEED_PRODUCT_101_ID]);
  });

  it('#7c — a new line of A × 3 beside the exempt A × 5 is refused (8 < 10); A × 5 instead succeeds and checks out', async () => {
    await convertQuoteRequestToCart(h, quotes.sevenC);
    const three = await add({ productId: SEED_PRODUCT_101_ID, packagingUnitId: unitOf3, quantity: 1 });
    expect(three.statusCode, three.body).toBe(422);
    expect((three.json() as ErrorBody).error).toMatchObject({
      code: ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY,
      details: { minimum: 10, total: 8 },
    });
    const five = await add({ productId: SEED_PRODUCT_101_ID, packagingUnitId: unitOf5, quantity: 1 });
    expect(five.statusCode, five.body).toBe(200);
    expect((await lineOf(SEED_PRODUCT_101_ID)).agreedQuantity).toBe(5);
    expect((await checkOutBasket(h)).id).toBeTruthy();
  });

  it('#7d — 5 → 12 succeeds and is no longer exempt; 12 → 5 succeeds and is exempt again; checkout places', async () => {
    await convertQuoteRequestToCart(h, quotes.sevenD);
    const a = await lineOf(SEED_PRODUCT_101_ID);
    const up = await edit(a.id, 12);
    expect(up.statusCode, up.body).toBe(200);
    expect((await lineOf(SEED_PRODUCT_101_ID)).quantity).toBe(12);
    const back = await edit(a.id, 5);
    expect(back.statusCode, back.body).toBe(200);
    const line = await lineOf(SEED_PRODUCT_101_ID);
    expect([line.quantity, line.agreedQuantity]).toEqual([5, 5]);
    expect((await viewLines()).map((l) => l.belowMinimum ?? null)).toEqual([null]);
    expect((await checkOutBasket(h)).id).toBeTruthy();
  });

  it('#7d — 5 → 6 is refused (6 < 10, and 6 is not the quote’s quantity)', async () => {
    await convertQuoteRequestToCart(h, quotes.sevenDRefused);
    const a = await lineOf(SEED_PRODUCT_101_ID);
    const res = await edit(a.id, 6);
    expect(res.statusCode, res.body).toBe(422);
    expect(codeOf(res)).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    expect((await lineOf(SEED_PRODUCT_101_ID)).quantity).toBe(5);
  });

  it('a bump of the seeded line ends its exemption while it differs', async () => {
    await cartWritePortOf(h).replaceItemsForCustomer(
      BASKET_CTX,
      [{ productId: SEED_PRODUCT_101_ID, quantity: 5, unitPrice: '11.25', currency: 'PLN' }],
      { sourceQuoteRequestId: randomUUID() },
    );
    // 5 + 1 = 6 on the seeded line: no longer the quote's quantity, and 6 < 10.
    const res = await add({ productId: SEED_PRODUCT_101_ID, quantity: 1 });
    expect(res.statusCode, res.body).toBe(422);
    expect(codeOf(res)).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    // 5 + 5 = 10 meets the minimum on its own; the seeded quantity is kept, not rewritten.
    const ok = await add({ productId: SEED_PRODUCT_101_ID, quantity: 5 });
    expect(ok.statusCode, ok.body).toBe(200);
    const line = await lineOf(SEED_PRODUCT_101_ID);
    expect([line.quantity, line.agreedQuantity]).toEqual([10, 5]);
  });

  it('a login merge into the seeded line ends its exemption likewise; the moved line carries no seeded quantity', async () => {
    await cartWritePortOf(h).replaceItemsForCustomer(
      BASKET_CTX,
      [{ productId: SEED_PRODUCT_101_ID, quantity: 5, unitPrice: '11.25', currency: 'PLN' }],
      { sourceQuoteRequestId: randomUUID() },
    );
    const token = `anon-148-merge-${randomUUID()}`;
    const em = h.em();
    // The anonymous basket of the store the customer signs in on — a basket of
    // another store is not merged (`specs/154-sales-channel-access/`).
    const anon = em.create(Cart, {
      anonymousCartToken: token,
      status: 'active',
      salesChannelId: BASKET_CTX.salesChannelId,
    });
    await em.persist(anon).flush();
    em.create(CartItem, {
      cartId: anon.id,
      productId: SEED_PRODUCT_101_ID,
      quantity: 1,
      unitPrice: '11.25',
      currency: 'PLN',
    });
    em.create(CartItem, { cartId: anon.id, productId: B.id, quantity: 12, unitPrice: '10.00', currency: 'PLN' });
    await em.flush();

    const service = h.cartService();
    if (!service) throw new Error('the composed CartService is not available');
    await service.mergeAnonymousIntoCustomer(token, BASKET_CTX);

    const a = await lineOf(SEED_PRODUCT_101_ID);
    expect([a.quantity, a.agreedQuantity]).toEqual([6, 5]);
    expect((await lineOf(B.id)).agreedQuantity ?? null).toBeNull();
    const flagged = (await viewLines()).find((l) => l.productId === SEED_PRODUCT_101_ID)!;
    expect(flagged.belowMinimum).toEqual({ kind: 'pieces', minimum: 10 });
  });

  it('a reorder seed (no source) exempts nothing', async () => {
    await cartWritePortOf(h).replaceItemsForCustomer(BASKET_CTX, [
      { productId: SEED_PRODUCT_101_ID, quantity: 5, unitPrice: '11.25', currency: 'PLN' },
    ]);
    expect((await lineOf(SEED_PRODUCT_101_ID)).agreedQuantity ?? null).toBeNull();
    expect((await viewLines())[0]!.belowMinimum).toEqual({ kind: 'pieces', minimum: 10 });
    const res = await edit((await lineOf(SEED_PRODUCT_101_ID)).id, 6);
    expect(res.statusCode, res.body).toBe(422);
  });

  it('a later seed replaces the exemptions', async () => {
    await cartWritePortOf(h).replaceItemsForCustomer(
      BASKET_CTX,
      [{ productId: SEED_PRODUCT_101_ID, quantity: 5, unitPrice: '11.25', currency: 'PLN' }],
      { sourceQuoteRequestId: randomUUID() },
    );
    await cartWritePortOf(h).replaceItemsForCustomer(
      BASKET_CTX,
      [{ productId: SEED_PRODUCT_101_ID, quantity: 7, unitPrice: '11.25', currency: 'PLN' }],
      { sourceQuoteRequestId: randomUUID() },
    );
    expect((await basketLines()).map((l) => [l.quantity, l.agreedQuantity])).toEqual([[7, 7]]);
    await cartWritePortOf(h).replaceItemsForCustomer(BASKET_CTX, [
      { productId: SEED_PRODUCT_101_ID, quantity: 7, unitPrice: '11.25', currency: 'PLN' },
    ]);
    expect((await basketLines()).map((l) => l.agreedQuantity ?? null)).toEqual([null]);
  });

  it('a line the buyer adds carries no seeded quantity', async () => {
    await cartWritePortOf(h).replaceItemsForCustomer(BASKET_CTX, []);
    const res = await add({ productId: B.id, quantity: 10 });
    expect(res.statusCode, res.body).toBe(200);
    expect((await lineOf(B.id)).agreedQuantity ?? null).toBeNull();
  });

  it('F9 — neither the agreed quantity nor sourceQuoteRequestId is in any request schema', () => {
    const forbidden = ['quoteSeededQuantity', 'agreedQuantity', 'sourceQuoteRequestId'];
    const requestSchemas = Object.entries(contracts).filter(
      ([name, value]) => /Request(Strict)?Schema$|BodySchema$|InputSchema$/.test(name) && value instanceof z.ZodType,
    );
    expect(requestSchemas.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const [name, schema] of requestSchemas) {
      // Unwraps the wrappers a request schema may sit in (optional, default, pipe).
      const shapeOf = (s: z.ZodType): Record<string, unknown> | null => {
        if (s instanceof z.ZodObject) return s.shape as Record<string, unknown>;
        const def = (s as unknown as { _zod?: { def?: { innerType?: z.ZodType; in?: z.ZodType } } })._zod?.def;
        if (def?.innerType) return shapeOf(def.innerType);
        if (def?.in) return shapeOf(def.in);
        return null;
      };
      const shape = shapeOf(schema as z.ZodType);
      if (shape && forbidden.some((key) => key in shape)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
    for (const schema of [contracts.addCartItemRequestSchema, contracts.updateCartItemRequestSchema]) {
      const parsed = schema.parse({
        productId: SEED_PRODUCT_101_ID,
        quantity: 5,
        quoteSeededQuantity: 5,
        agreedQuantity: 5,
        sourceQuoteRequestId: randomUUID(),
      }) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty('quoteSeededQuantity');
      expect(parsed).not.toHaveProperty('agreedQuantity');
      expect(parsed).not.toHaveProperty('sourceQuoteRequestId');
    }
  });
});
