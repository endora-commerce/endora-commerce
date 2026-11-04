import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type LinePricesPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { seedScopedValues } from '../../helpers/scoped-values.js';
import {
  buyerChannelIds,
  createMinimumPackagingUnit,
  createMinimumProduct,
  createMinimumVariant,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155, Phase 6 (T039) — the single add and the edit enforce the
 * catalogue's order minimums (`specs/155-catalog-order-constraints/`, US1–US3,
 * FR-006, FR-006a, FR-007, FR-035, FR-037; `contracts/cart-and-checkout-api.md`
 * §1–§2).
 *
 * - A: simple, minimum 10 pcs. D: simple, no minimum.
 * - B: configurable (red, blue), no pieces minimum; unit "Pallet" (64) minimum 2.
 * - C: simple, minimum 10 pcs; unit "Pallet" (64) minimum 2.
 * - H: minimum 10, published on no channel — hidden from every buyer request.
 *
 * Every case works on its own anonymous basket.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface CartBody {
  data: {
    id: string;
    items: Array<{
      id: string;
      productId: string;
      variantId: string | null;
      quantity: number;
      belowMinimum?: { kind: string; minimum: number; packagingUnitName?: string } | null;
    }>;
  };
}

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('155 — cart add and edit enforce the order minimums [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let A: MinimumProductFixture;
  let D: MinimumProductFixture;
  let B: MinimumProductFixture;
  let C: MinimumProductFixture;
  let H: MinimumProductFixture;
  let bRed = '';
  let bBlue = '';
  let bPallet = '';
  let cPallet = '';
  const B_PALLET_NAME = `Pallet B ${RUN}`;
  const C_PALLET_NAME = `Pallet C ${RUN}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    A = await createMinimumProduct(em, {
      sku: `MOQ-A-${RUN}`,
      nameEn: `Anchor bolt ${RUN}`,
      namePl: `Kotwa ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    // Feature 172 (FR-030) — the Polish name a pl-PL buyer of `pl_retail` reads is that
    // channel × language's translation; the Global name is the English one.
    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    await seedScopedValues(em, A.id, [
      { field: 'name', scope: { level: 'channel_language', channelId: retail.id, languageCode: 'pl-PL' }, value: A.namePl },
    ]);
    D = await createMinimumProduct(em, {
      sku: `MOQ-D-${RUN}`,
      nameEn: `Dowel ${RUN}`,
      namePl: `Kołek ${RUN}`,
      channelIds: channels,
    });
    B = await createMinimumProduct(em, {
      sku: `MOQ-B-${RUN}`,
      nameEn: `Brick ${RUN}`,
      namePl: `Cegła ${RUN}`,
      type: 'configurable',
      channelIds: channels,
    });
    bRed = await createMinimumVariant(em, B.id, `MOQ-B-RED-${RUN}`);
    bBlue = await createMinimumVariant(em, B.id, `MOQ-B-BLUE-${RUN}`);
    bPallet = await createMinimumPackagingUnit(em, {
      productId: B.id,
      name: B_PALLET_NAME,
      baseQuantity: 64,
      minOrderUnits: 2,
    });
    C = await createMinimumProduct(em, {
      sku: `MOQ-C-${RUN}`,
      nameEn: `Cement ${RUN}`,
      namePl: `Cement PL ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    cPallet = await createMinimumPackagingUnit(em, {
      productId: C.id,
      name: C_PALLET_NAME,
      baseQuantity: 64,
      minOrderUnits: 2,
    });
    H = await createMinimumProduct(em, {
      sku: `MOQ-H-${RUN}`,
      nameEn: `Hidden hinge ${RUN}`,
      namePl: `Ukryty zawias ${RUN}`,
      minOrderQuantity: 10,
      channelIds: [],
    });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const basket = () => ({ b2b_cart_anon: `anon-148-moq-${randomUUID()}` });

  async function add(
    cookies: Record<string, string>,
    payload: { productId: string; quantity: number; variantId?: string; packagingUnitId?: string },
    acceptLanguage = 'en',
  ) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json', 'accept-language': acceptLanguage },
      payload,
    });
  }

  async function edit(cookies: Record<string, string>, itemId: string, quantity: number, acceptLanguage = 'en') {
    return h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json', 'accept-language': acceptLanguage },
      payload: { quantity },
    });
  }

  async function view(cookies: Record<string, string>): Promise<CartBody['data']> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies, headers: CHANNEL });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as CartBody).data;
  }

  function errorOf(res: { body: string; json: () => unknown }): ErrorBody['error'] {
    return (res.json() as ErrorBody).error;
  }

  describe('US1 — pieces minimum', () => {
    it('#3 refuses A × 5 with the minimum code, naming the product and the minimum; the cart is unchanged', async () => {
      const cookies = basket();
      const res = await add(cookies, { productId: A.id, quantity: 5 });
      expect(res.statusCode, res.body).toBe(422);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      // Feature 172 (FR-030) — the sentence is English, the name is the one the basket shows: the
      // test `pl_retail` offers pl-PL alone, so an English request reads its pl-PL text.
      expect(error.details).toMatchObject({ productId: A.id, productName: A.namePl, minimum: 10, total: 5 });
      expect(error.message).toBe(`"${A.namePl}" has a minimum order quantity of 10 pcs.`);
      expect((await view(cookies)).items).toEqual([]);
    });

    it('#3 answers in Polish, naming the product in Polish, with Accept-Language: pl (plan I1, SC-004)', async () => {
      const res = await add(basket(), { productId: A.id, quantity: 5 }, 'pl');
      expect(res.statusCode, res.body).toBe(422);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      expect(error.message).toBe(`Minimalna ilość zamówienia produktu „${A.namePl}” to 10 szt.`);
    });

    it('D3 — a q-weighted header names the product in the sentence’s language: `pl;q=0.9` and `en;q=0.2,pl;q=0.9`', async () => {
      for (const header of ['pl;q=0.9', 'en;q=0.2,pl;q=0.9']) {
        const res = await add(basket(), { productId: A.id, quantity: 5 }, header);
        expect(res.statusCode, res.body).toBe(422);
        const error = errorOf(res);
        expect(error.message, header).toBe(`Minimalna ilość zamówienia produktu „${A.namePl}” to 10 szt.`);
        expect(error.details, header).toMatchObject({ productName: A.namePl });
      }
    });

    it('accepts A × 10', async () => {
      const res = await add(basket(), { productId: A.id, quantity: 10 });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('#4 refuses an edit of A from 10 to 4 and leaves the line at 10', async () => {
      const cookies = basket();
      const added = await add(cookies, { productId: A.id, quantity: 10 });
      expect(added.statusCode, added.body).toBe(200);
      const line = (added.json() as CartBody).data.items[0]!;
      const res = await edit(cookies, line.id, 4);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY,
        // Feature 172 (FR-030) — named at the basket's (channel, language), see #3.
        details: { productId: A.id, productName: A.namePl, minimum: 10, total: 4 },
      });
      // U4 — the buyer reads this sentence; it is the envelope's message, never the code.
      expect(errorOf(res).message).toBe(`"${A.namePl}" has a minimum order quantity of 10 pcs.`);
      expect((await view(cookies)).items.map((i) => i.quantity)).toEqual([10]);
    });

    it('U4 — the refused edit answers with the full Polish sentence under Accept-Language: pl, never the code', async () => {
      const cookies = basket();
      const added = await add(cookies, { productId: A.id, quantity: 10 }, 'pl');
      expect(added.statusCode, added.body).toBe(200);
      const line = (added.json() as CartBody).data.items[0]!;
      const res = await edit(cookies, line.id, 4, 'pl');
      expect(res.statusCode, res.body).toBe(422);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      expect(error.message).toBe(`Minimalna ilość zamówienia produktu „${A.namePl}” to 10 szt.`);
      expect(error.message).not.toContain(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    });

    it('FR-007 — an edit to 0 and a DELETE always succeed', async () => {
      const cookies = basket();
      const added = await add(cookies, { productId: A.id, quantity: 10 });
      const line = (added.json() as CartBody).data.items[0]!;
      const zero = await edit(cookies, line.id, 0);
      expect(zero.statusCode, zero.body).toBe(200);
      expect((await view(cookies)).items).toEqual([]);

      const again = await add(cookies, { productId: A.id, quantity: 12 });
      const second = (again.json() as CartBody).data.items[0]!;
      const removed = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/cart/items/${second.id}`,
        cookies,
        headers: CHANNEL,
      });
      expect(removed.statusCode, removed.body).toBe(200);
      expect((await view(cookies)).items).toEqual([]);
    });

    it('#6 — a product without a minimum behaves as today', async () => {
      const res = await add(basket(), { productId: D.id, quantity: 1 });
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  describe('US2 — packaging-unit minimum', () => {
    it('#3 refuses 1 pallet, naming the unit and its minimum', async () => {
      const res = await add(basket(), { productId: B.id, variantId: bRed, packagingUnitId: bPallet, quantity: 1 });
      expect(res.statusCode, res.body).toBe(422);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY);
      expect(error.details).toMatchObject({
        productId: B.id,
        productName: B.nameEn,
        packagingUnitId: bPallet,
        packagingUnitName: B_PALLET_NAME,
        minimum: 2,
        units: 1,
      });
      expect(error.message).toBe(`"${B.nameEn}" must be ordered in at least 2 × ${B_PALLET_NAME}.`);
    });

    it('#4 refuses an edit of a 2-pallet line to fewer than 2 pallets’ worth', async () => {
      const cookies = basket();
      const added = await add(cookies, { productId: B.id, variantId: bRed, packagingUnitId: bPallet, quantity: 2 });
      expect(added.statusCode, added.body).toBe(200);
      const line = (added.json() as CartBody).data.items[0]!;
      expect(line.quantity).toBe(128);
      const res = await edit(cookies, line.id, 64);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).code).toBe(ERROR_CODES.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY);
      expect((await view(cookies)).items.map((i) => i.quantity)).toEqual([128]);
    });

    it('#5 accepts 5 single pieces — the pallet minimum governs pallets only', async () => {
      const res = await add(basket(), { productId: B.id, variantId: bRed, quantity: 5 });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('#6 and #7 — 1 red pallet + 1 blue pallet is 2 pallets; removing blue succeeds and flags red', async () => {
      const cookies = basket();
      // Red alone is below the unit minimum, so it reaches the basket as 2
      // pallets and is then cut to 1 — impossible through the cart (#4). It is
      // the basket a raised minimum leaves behind, written as the row it is.
      const first = await add(cookies, { productId: B.id, variantId: bRed, packagingUnitId: bPallet, quantity: 2 });
      expect(first.statusCode, first.body).toBe(200);
      const red = (first.json() as CartBody).data.items[0]!;
      await h.em().getConnection().execute(`update cart_items set quantity = 64 where id = ?`, [red.id]);

      const blue = await add(cookies, { productId: B.id, variantId: bBlue, packagingUnitId: bPallet, quantity: 1 });
      expect(blue.statusCode, blue.body).toBe(200);
      const blueLine = (blue.json() as CartBody).data.items.find((i) => i.variantId === bBlue)!;

      const removed = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/cart/items/${blueLine.id}`,
        cookies,
        headers: CHANNEL,
      });
      expect(removed.statusCode, removed.body).toBe(200);
      const items = (await view(cookies)).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.belowMinimum).toEqual({ kind: 'packaging_unit', minimum: 2, packagingUnitName: B_PALLET_NAME });
    });
  });

  describe('US3 — both minimums on one product', () => {
    it('#1 accepts 10 single pieces', async () => {
      expect((await add(basket(), { productId: C.id, quantity: 10 })).statusCode).toBe(200);
    });

    it('#2 and #4 refuse 1 pallet citing the pallet minimum, although 64 ≥ 10 pieces', async () => {
      const res = await add(basket(), { productId: C.id, packagingUnitId: cPallet, quantity: 1 });
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: ERROR_CODES.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY,
        details: { packagingUnitName: C_PALLET_NAME, minimum: 2, units: 1 },
      });
    });

    it('#3 accepts 3 single pieces on top of 2 pallets — 131 pcs, 2 pallets', async () => {
      const cookies = basket();
      expect((await add(cookies, { productId: C.id, packagingUnitId: cPallet, quantity: 2 })).statusCode).toBe(200);
      const res = await add(cookies, { productId: C.id, quantity: 3 });
      expect(res.statusCode, res.body).toBe(200);
      expect((await view(cookies)).items.map((i) => i.quantity).sort((x, y) => x - y)).toEqual([3, 128]);
    });

    it('#5 refuses 5 single pieces citing the pieces minimum', async () => {
      const res = await add(basket(), { productId: C.id, quantity: 5 });
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY,
        details: { productId: C.id, minimum: 10, total: 5 },
      });
    });
  });

  describe('order of checks and disclosure', () => {
    it('S2 / FR-035 — a hidden product below its minimum answers the unchanged 404, with no name and no minimum', async () => {
      const res = await add(basket(), { productId: H.id, quantity: 5 });
      expect(res.statusCode, res.body).toBe(404);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      expect(error.details ?? {}).not.toHaveProperty('productName');
      expect(error.details ?? {}).not.toHaveProperty('minimum');
      expect(res.body).not.toContain(H.nameEn);
    });

    it('a refused add makes no price_lists call; an accepted one does', async () => {
      // D-287 P0 — the cart prices through the batched slice.
      const pricing = (h.container.cradle as unknown as { pricingService: LinePricesPort }).pricingService;
      const spy = vi.spyOn(pricing, 'resolveLinePrices');
      try {
        const refused = await add(basket(), { productId: A.id, quantity: 5 });
        expect(refused.statusCode, refused.body).toBe(422);
        expect(spy).not.toHaveBeenCalled();

        // The positive control — the spy sits on the object the cart prices through.
        const accepted = await add(basket(), { productId: A.id, quantity: 10 });
        expect(accepted.statusCode, accepted.body).toBe(200);
        expect(spy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('FR-037 — an edit of a line whose product row is gone answers 404 PRODUCT_NOT_FOUND with no name; the line is unchanged', async () => {
      const cookies = basket();
      const added = await add(cookies, { productId: D.id, quantity: 3 });
      const cartId = (added.json() as CartBody).data.id;
      const ghostItemId = randomUUID();
      const ghostProductId = randomUUID();
      await h
        .em()
        .getConnection()
        .execute(
          `insert into cart_items (id, cart_id, product_id, quantity, unit_price, currency, created_at, updated_at)
           values (?, ?, ?, 3, 10, 'PLN', now(), now())`,
          [ghostItemId, cartId, ghostProductId],
        );

      const res = await edit(cookies, ghostItemId, 4);
      expect(res.statusCode, res.body).toBe(404);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      expect(error.details ?? {}).not.toHaveProperty('productName');
      expect(error.details ?? {}).not.toHaveProperty('minimum');

      const rows = await h
        .em()
        .getConnection()
        .execute<{ quantity: number }[]>(`select quantity from cart_items where id = ?`, [ghostItemId]);
      expect(rows).toEqual([{ quantity: 3 }]);
    });
  });
});
