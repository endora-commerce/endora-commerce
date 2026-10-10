import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import {
  PriceDisplayModeOverride,
  PriceList,
  PriceListPriceBracket,
  PriceListProduct,
} from '../../helpers/package-entities.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #86, first slice — the two refusals `CartService.addItem` raised as
 * `VALIDATION_FAILED` have a code of their own and a sentence in both
 * languages.
 *
 * `VALIDATION_FAILED` is the one code whose message the error envelope never
 * replaces (it is shared with machine tokens such as `sku_in_use`), so a
 * refusal raised under it is answered in whatever its thrower wrote: the buyer
 * of a quote-only product read the identifier `product_quote_only`, in every
 * language, and a client could not tell that refusal from a malformed request.
 *
 * The sentences are written out here rather than read from the bundle — a test
 * that loads the file it is checking asserts only that JSON parses.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const EN_QUOTE_ONLY =
  'This product is sold on request only, so it cannot be added to the cart. Ask for a quote instead.';
const PL_QUOTE_ONLY =
  'Ten produkt jest sprzedawany wyłącznie na zapytanie, dlatego nie można dodać go do koszyka. Wyślij zapytanie ofertowe.';

describe('cart line refusals carry their own code and sentence (issue #86)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('CART_PRODUCT_QUOTE_ONLY — a product whose price is withheld', () => {
    /** Whether this file put the product on the Default list, and so removes it. */
    let listedHere = false;

    beforeAll(async () => {
      const em = h.em();
      // The refusal is raised on a *resolved* price whose mode is `none`, so
      // the product needs a list price first: a fresh test database prices the
      // seed catalogue from the catalogue attribute, and no list holds it.
      if (!(await em.findOne(PriceList, { id: DEFAULT_PRICE_LIST_ID }))) {
        await new DefaultPriceListMigrator(h.em).seedDefault();
      }
      const listed = await em.findOne(PriceListProduct, {
        priceListId: DEFAULT_PRICE_LIST_ID,
        productId: SEED_PRODUCT_101_ID,
      });
      if (!listed) {
        listedHere = true;
        em.create(PriceListProduct, {
          priceListId: DEFAULT_PRICE_LIST_ID,
          productId: SEED_PRODUCT_101_ID,
        });
        await em.flush();
        em.create(PriceListPriceBracket, {
          priceListId: DEFAULT_PRICE_LIST_ID,
          productId: SEED_PRODUCT_101_ID,
          currencyCode: 'PLN',
          minQuantity: 1,
          maxQuantity: null,
          amount: '100.00',
        });
      }
      // The most specific step of the display-mode chain, so nothing but this
      // one product is withheld while the file runs.
      em.create(PriceDisplayModeOverride, {
        scope: 'product',
        targetId: SEED_PRODUCT_101_ID,
        mode: 'none',
      });
      await em.flush();
    });

    afterAll(async () => {
      // The database outlives this file in a single-fork run.
      const em = h.em();
      await em.nativeDelete(PriceDisplayModeOverride, {
        scope: 'product',
        targetId: SEED_PRODUCT_101_ID,
      });
      if (listedHere) {
        const own = { priceListId: DEFAULT_PRICE_LIST_ID, productId: SEED_PRODUCT_101_ID };
        await em.nativeDelete(PriceListPriceBracket, own);
        await em.nativeDelete(PriceListProduct, own);
      }
    });

    async function addQuoteOnly(acceptLanguage: string): Promise<ErrorBody['error']> {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
        cookies: { b2b_cart_anon: `anon-i86-quote-only-${randomUUID()}` },
        headers: { 'accept-language': acceptLanguage },
      });
      // The status the refusal has always had.
      expect(res.statusCode).toBe(400);
      return (res.json() as ErrorBody).error;
    }

    it('answers its own code, not VALIDATION_FAILED, and names the product', async () => {
      const error = await addQuoteOnly('en');
      expect(error.code).toBe(ERROR_CODES.CART_PRODUCT_QUOTE_ONLY);
      expect(error.details).toEqual({ productId: SEED_PRODUCT_101_ID });
    });

    it('en — a sentence, not the identifier the service threw', async () => {
      const error = await addQuoteOnly('en');
      expect(error.message).toBe(EN_QUOTE_ONLY);
    });

    it('pl — the same refusal in Polish', async () => {
      const error = await addQuoteOnly('pl');
      expect(error.code).toBe(ERROR_CODES.CART_PRODUCT_QUOTE_ONLY);
      expect(error.message).toBe(PL_QUOTE_ONLY);
    });

    it('routes to carts, the module that raises it', () => {
      expect(
        DECLARED_ERROR_TRANSLATION_TARGETS[ERROR_CODES.CART_PRODUCT_QUOTE_ONLY]?.moduleId,
      ).toBe('carts');
    });
  });

  describe('CART_QUANTITY_INVALID — a quantity below the minimum a line may hold', () => {
    /**
     * Raised by the service and reached by no route: every request schema in
     * front of `addItem` — the cart's own, quick order's, the order intakes' —
     * already requires a positive integer, so over HTTP a zero is a malformed
     * request and is answered as one (the last case below). The guard is what
     * an in-process caller of the cart write port meets, which is why it is
     * exercised on the service and its sentence at the key and with the
     * parameters the envelope would build from `details`.
     */
    async function refusal(quantity: number): Promise<unknown> {
      const service = h.cartService();
      if (!service) throw new Error('the composed CartService is not available');
      return service
        .addItem(
          { anonymousToken: `anon-i86-quantity-${randomUUID()}` },
          { productId: SEED_PRODUCT_101_ID, quantity },
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
    }

    it.each([0, -3])('refuses %i with its own code and carries the minimum', async (quantity) => {
      expect(await refusal(quantity)).toMatchObject({
        // The status the refusal has always had.
        statusCode: 422,
        code: ERROR_CODES.CART_QUANTITY_INVALID,
        details: { quantity, minimum: 1 },
      });
    });

    it('en and pl — both sentences name the minimum', async () => {
      const target = DECLARED_ERROR_TRANSLATION_TARGETS[ERROR_CODES.CART_QUANTITY_INVALID]!;
      expect(target.moduleId).toBe('carts');
      const params = { quantity: 0, minimum: 1 };
      const translate = h.adminI18n.i18nService.translate.bind(h.adminI18n.i18nService);
      expect(await translate(target.moduleId, target.key, 'en', params)).toBe(
        'The quantity must be at least 1.',
      );
      expect(await translate(target.moduleId, target.key, 'pl', params)).toBe(
        'Ilość musi wynosić co najmniej 1.',
      );
    });

    it('a malformed request is still a malformed request — 400 VALIDATION_FAILED', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 0 },
        cookies: { b2b_cart_anon: `anon-i86-shape-${randomUUID()}` },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });
});
