import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  Cart,
  CartItem,
  PriceDisplayModeOverride,
  Product,
} from '../../helpers/package-entities.js';
import { removeBasePriceSql, seedBasePriceSql } from '../../helpers/price-book-sql.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  createMinimumVariant,
  minimumFixtureRun,
  setProductMinimum,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * T062-T064 partial (feature 027 US3) — smoke tests for the three
 * conversion endpoints. Full happy-path coverage that depends on
 * pre-arranged QR/list rows is deferred until US3 ships with the
 * frontend; these tests cover the route plumbing and the error-handler
 * contract.
 */

describe('POST /api/v1/cart/convert-to-quote-request', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 401 when called by an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/convert-to-quote-request',
      payload: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/cart/from-quote-request/:quoteRequestId', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 401 when called by an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/from-quote-request/00000000-0000-4000-8000-000000000001',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/cart/from-shopping-list/:shoppingListId', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 401 when called by an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/from-shopping-list/00000000-0000-4000-8000-000000000001',
    });
    expect(res.statusCode).toBe(401);
  });
});

/**
 * Feature 155, Phase 7 (T049) — quote request → cart goes through the cart's batch
 * (`specs/155-catalog-order-constraints/research.md` R8, R12.5;
 * `contracts/cart-and-checkout-api.md` §5).
 *
 * The quote is created while none of its products has a minimum (and while every
 * one of them is visible), then the minimums are set and two products hidden — a
 * quote negotiated before the rule, converted after it.
 *
 * - A × 5, minimum 10 → dropped `below_minimum` with `minimum: 10`, never
 *   `no_price_in_customer_list` (US4 #8).
 * - V-red × 5 + V-blue × 5, minimum 10 → both appended: the product total (D1).
 * - Q, quote-only → keeps `no_price_in_customer_list`.
 * - H (minimum 10, × 5) restricted to another organisation, and O (minimum 10,
 *   × 5) taken off every channel → `not_purchasable` exactly like an unknown
 *   product: no `minimum` (FR-035, US4 #16, threat F1).
 */
describe('POST /api/v1/cart/from-quote-request/:id — minimums (feature 155) [contract]', () => {
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  const RUN = minimumFixtureRun();
  let h: BackendServerHandle;
  let A: MinimumProductFixture;
  let V: MinimumProductFixture;
  let Q: MinimumProductFixture;
  let H: MinimumProductFixture;
  let O: MinimumProductFixture;
  let red = '';
  let blue = '';
  let quoteRequestId = '';
  let listedQ = false;

  interface DroppedLine {
    productId: string;
    productName: string;
    reason: string;
    minimum?: number;
  }

  async function clearCustomerCart(): Promise<void> {
    const em = h.em().fork({ clear: true });
    const cart = await em.findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    if (cart) await em.nativeDelete(CartItem, { cartId: cart.id });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    const make = (key: string, nameEn: string, namePl: string, type?: 'configurable') =>
      createMinimumProduct(em, {
        sku: `QCM-${key}-${RUN}`,
        nameEn: `${nameEn} ${RUN}`,
        namePl: `${namePl} ${RUN}`,
        ...(type ? { type } : {}),
        channelIds: channels,
      });
    A = await make('A', 'Anchor', 'Kotwa');
    V = await make('V', 'Valve', 'Zawor', 'configurable');
    Q = await make('Q', 'Quote-only', 'Na zapytanie');
    H = await make('H', 'Hidden', 'Ukryty');
    O = await make('O', 'Off-channel', 'Poza kanalem');
    red = await createMinimumVariant(em, V.id, `QCM-V-RED-${RUN}`);
    blue = await createMinimumVariant(em, V.id, `QCM-V-BLUE-${RUN}`);

    // Q is withheld (display mode `none`) on a resolved list price, so the cart's
    // add step refuses it as quote-only — the `no_price_in_customer_list` case.
    listedQ = true;
    await seedBasePriceSql(em, Q.id, '100.00');
    em.create(PriceDisplayModeOverride, { scope: 'product', targetId: Q.id, mode: 'none' });
    await em.flush();

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: {
        items: [
          { productId: A.id, quantity: 5 },
          { productId: V.id, variantId: red, quantity: 5 },
          { productId: V.id, variantId: blue, quantity: 5 },
          { productId: Q.id, quantity: 1 },
          { productId: H.id, quantity: 5 },
          { productId: O.id, quantity: 5 },
        ],
      },
    });
    if (created.statusCode !== 201) throw new Error(`quote request: ${created.statusCode} ${created.body}`);
    quoteRequestId = (created.json() as { data: { id: string } }).data.id;

    // After the quote: the minimums arrive, H is restricted to another
    // organisation and O leaves every channel.
    for (const id of [A.id, V.id, H.id, O.id]) await setProductMinimum(em, id, 10);
    await em.nativeUpdate(Product, { id: H.id }, { allowedOrganizationIds: [OTHER_TEST_ORGANIZATION_ID] });
    await em
      .getConnection()
      .execute(`delete from sales_channel_products where product_id = ?`, [O.id]);

    await clearCustomerCart();
  }, 120_000);

  afterAll(async () => {
    await clearCustomerCart();
    const em = h.em();
    await em.nativeDelete(PriceDisplayModeOverride, { scope: 'product', targetId: Q.id });
    if (listedQ) await removeBasePriceSql(em, Q.id);
    await teardownBackendServer(h);
  });

  it('drops below-minimum, quote-only and hidden lines each with its own reason, and appends split variants', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/cart/from-quote-request/${quoteRequestId}`,
      cookies: CUSTOMER,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { appendedLineCount: number; droppedLines: DroppedLine[] } };
    const dropped = new Map(body.data.droppedLines.map((line) => [line.productId, line]));

    // US4 #8 — below the minimum, with the minimum, and not "no price".
    expect(dropped.get(A.id)).toMatchObject({ reason: 'below_minimum', minimum: 10 });

    // D1 — the two variant lines sum to the minimum and are both appended.
    expect(dropped.has(V.id)).toBe(false);
    expect(body.data.appendedLineCount).toBe(2);
    const em = h.em().fork({ clear: true });
    const cart = await em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    const lines = await em.find(CartItem, { cartId: cart.id, productId: V.id });
    expect(lines.map((l) => [l.variantId, l.quantity]).sort()).toEqual(
      [
        [red, 5],
        [blue, 5],
      ].sort(),
    );

    // A quote-only line keeps its reason.
    const quoteOnly = dropped.get(Q.id);
    expect(quoteOnly?.reason).toBe('no_price_in_customer_list');
    expect(quoteOnly).not.toHaveProperty('minimum');

    // FR-035 / F1 — a hidden product and an off-channel one are an unknown product:
    // `not_purchasable`, the quote line's own name, no minimum.
    for (const fixture of [H, O]) {
      const line = dropped.get(fixture.id);
      expect(line).toBeDefined();
      expect(Object.keys(line!).sort()).toEqual(['productId', 'productName', 'reason']);
      expect(line!.reason).toBe('not_purchasable');
    }
    expect(body.data.droppedLines).toHaveLength(4);
  });
});
