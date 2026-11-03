import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unitPriceDisplayText, unitPriceHalfUp, type BuyerLinePricePort } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { CartPlacementApplyPort } from '../../../../../packages/modules/carts/src/ports/index.js';
import { resolveFeedItem } from '../../../../../packages/modules/product_feeds/src/backend/services/item-field-resolver.js';
import { resolveReferencePrices } from '../../../../../packages/modules/quote_requests/src/backend/services/reference-price.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../../helpers/test-actors.js';
import { seedPriceBookSql } from '../../../helpers/price-book-sql.js';
import { emptyCustomerBasket } from '../../../helpers/customer-basket.js';

/**
 * `specs/pricing/worked-examples.md` §10.16 and §10.18 (owner ruling of
 * 2026-10-25) — a resolver amount whose third and fourth places are `50` is a
 * unit price, carried at its four places, unrounded, on every surface that
 * stores or answers one: the cart line (which the order copies), the placement
 * check, the admin order preview and a quote's stored reference price; the
 * card and the product page show it with its significant places (`9,045 zł`).
 * Only the line value, `unit × quantity`, rounds it, half-up on its decimal
 * digits. A product feed, whose grammar is two places, does not round it
 * either: it publishes the price of a pack of ten, exact (issue #430).
 *
 * R1: 101 — an everyone catalogue book at 10.05 and an everyone sale of −10 %
 * → 9.0450, shown 9.045, a line of one 9.05 (`Number('9.0450').toFixed(2)` is
 * 9.04), the feed 90.45 for a pack of 10.
 * R2: 102 — an everyone sale at 1.0050 → 1.005, a line of one 1.01 (`toFixed`
 * gives 1.00), the feed 10.05 for a pack of 10.
 */
const SESSION = { b2b_session: 'stub-customer-session' };
const RETAIL = { 'x-sales-channel': 'pl_retail' };
const EXPECTED: Record<string, { resolver: string; shown: string; twoPlaces: string; feed: string }> = {
  [SEED_PRODUCT_101_ID]: { resolver: '9.0450', shown: '9.045', twoPlaces: '9.05', feed: '90.45 for 10' },
  [SEED_PRODUCT_102_ID]: { resolver: '1.0050', shown: '1.005', twoPlaces: '1.01', feed: '10.05 for 10' },
};
/** How the storefront shows a unit price, without the currency sign (the one display rule). */
const shown = (amount: string | number) => unitPriceDisplayText(amount);
/** What a surface carrying a unit price holds: its four places. */
const carried = (amount: string | number) => unitPriceHalfUp(amount);

describe('worked examples — §10.16 and §10.18 an x.xx50 unit price agrees on every surface', () => {
  let h: BackendServerHandle;
  let retailId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    retailId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    await seedPriceBookSql(em, {
      name: 'R — catalogue',
      audience: 'everyone',
      rows: [{ productId: SEED_PRODUCT_101_ID, fixed: '10.05' }],
    });
    await seedPriceBookSql(em, {
      name: 'R — sale',
      type: 'sale',
      audience: 'everyone',
      rows: [
        { productId: SEED_PRODUCT_101_ID, percent: '-10' },
        { productId: SEED_PRODUCT_102_ID, fixed: '1.005' },
      ],
    });
  }, 5 * 60_000);

  afterAll(async () => {
    await emptyCustomerBasket(h, { ...CUSTOMER_COOKIES[SESSION.b2b_session]!, salesChannelId: retailId });
    await teardownBackendServer(h);
  });

  it('R1, R2 — the card, the product page, the cart, placement, the admin preview, a quote reference and the feed', async () => {
    const seen: Record<string, Record<string, string>> = {};
    const record = (surface: string, productId: string, value: string | undefined) => {
      (seen[productId] ??= {})[surface] = value ?? 'missing';
    };

    const listing = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=100', headers: RETAIL, cookies: SESSION });
    expect(listing.statusCode, listing.body).toBe(200);
    for (const p of (listing.json() as { data: Array<{ id: string; price: { amount: number | string } | null }> }).data) {
      if (!EXPECTED[p.id]) continue;
      expect(String(p.price?.amount), `${p.id} card amount`).toBe(String(Number(EXPECTED[p.id]!.resolver)));
      record('card', p.id, shown(p.price!.amount));
    }

    for (const productId of Object.keys(EXPECTED)) {
      const resolved = await h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/products/${productId}/resolved-price?quantity=1`,
        headers: RETAIL,
        cookies: SESSION,
      });
      expect(resolved.statusCode, resolved.body).toBe(200);
      const r = (resolved.json() as { data: { resolvedPrice: { salePrice: { amount: string } | null } } }).data.resolvedPrice;
      record('product page', productId, r.salePrice ? shown(r.salePrice.amount) : undefined);

      const added = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        headers: { ...RETAIL, 'content-type': 'application/json' },
        cookies: SESSION,
        payload: { productId, quantity: 1 },
      });
      expect(added.statusCode, added.body).toBe(200);
    }

    const cart = await h.app.inject({ method: 'GET', url: '/api/v1/cart', headers: RETAIL, cookies: SESSION });
    expect(cart.statusCode, cart.body).toBe(200);
    const cartData = (cart.json() as { data: { id: string; items: Array<{ productId: string; unitPrice: { amount: number } }> } }).data;
    for (const line of cartData.items) if (EXPECTED[line.productId]) record('cart line', line.productId, carried(line.unitPrice.amount));
    // The line value, at quantity 1, is the one rounding: half-up to two places.
    const lineTotals = (cart.json() as { data: { items: Array<{ productId: string; lineTotal: { amount: number } }> } }).data.items;
    for (const line of lineTotals) {
      if (EXPECTED[line.productId]) expect(line.lineTotal.amount.toFixed(2)).toBe(EXPECTED[line.productId]!.twoPlaces);
    }

    // The order copies the cart line's stored price once this check accepts it.
    const placement = (h.container.cradle as unknown as { cartPlacementApplyPort: CartPlacementApplyPort }).cartPlacementApplyPort;
    expect(await placement.findPriceDrift(h.em().fork(), { cartId: cartData.id, organizationId: TEST_ORGANIZATION_ID })).toEqual([]);

    const preview = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: retailId,
        items: Object.keys(EXPECTED).map((productId) => ({ productId, quantity: 1 })),
      },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    for (const line of (preview.json() as { data: { lines: Array<{ productId: string; unitPrice: string }> } }).data.lines) {
      record('order preview line', line.productId, carried(line.unitPrice));
    }

    const buyerLines = (h.container.cradle as unknown as { buyerLinePricePort: BuyerLinePricePort }).buyerLinePricePort;
    const productIds = Object.keys(EXPECTED);
    const references = await resolveReferencePrices(buyerLines, {
      owner: { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      salesChannelId: retailId,
      lines: productIds.map((productId) => ({ productId, variantId: null, quantity: 1 })),
    });
    productIds.forEach((productId, i) => record('quote reference', productId, references[i] ? carried(references[i]!.amount) : undefined));

    // The feed: the anonymous resolution a feed generation reads, emitted by the feed's field resolver.
    const pricing = (h.container.cradle as unknown as {
      pricingService: { resolveLinePrices(i: unknown): Promise<Map<string, { amount: string } | null>> };
    }).pricingService;
    const reads = (h.container.cradle as unknown as {
      catalogProductReadPort: { findByIds(ids: readonly string[]): Promise<Array<{ id: string; attributeValues: Record<string, unknown> }>> };
    }).catalogProductReadPort;
    const anonymous = await pricing.resolveLinePrices({
      lines: (await reads.findByIds(productIds)).map((p) => ({ key: p.id, product: p, quantity: 1 })),
      context: { organization: null, salesChannel: { id: retailId, defaultCurrency: 'PLN' } },
    });
    for (const productId of productIds) {
      const net = anonymous.get(productId)!.amount;
      const item = resolveFeedItem({
        fields: [
          {
            outputName: 'price',
            sourceKind: 'price',
            sourceKey: null,
            constantValue: null,
            fallbackValue: null,
            providerRequired: false,
            transform: null,
            transformArg: null,
          },
          {
            outputName: 'pack',
            sourceKind: 'pack_quantity',
            sourceKey: null,
            constantValue: null,
            fallbackValue: null,
            providerRequired: false,
            transform: null,
            transformArg: null,
          },
        ],
        item: {
          productId,
          variantId: null,
          sku: 'SKU',
          slug: 'slug',
          productType: 'simple',
          name: { 'pl-PL': 'x' },
          description: {},
          attributes: {},
          customFields: {},
          price: { net, gross: net, taxResolved: true, taxRatePercent: null },
          salePrice: null,
          inStock: true,
          stockQuantity: 1,
          imageUrls: [],
          privateImageCount: 0,
          categoryPath: [],
          providerCategory: null,
          providerCategoryMissReason: null,
          groupingId: null,
        },
        context: {
          languageCode: 'pl-PL',
          languageFallbacks: [],
          currencyCode: 'PLN',
          pricePresentation: 'net',
          taxCountry: null,
          storefrontOrigin: 'https://shop.example.com',
          channelUrl: { languages: ['pl-PL'], defaultLanguage: 'pl-PL', prefixDefaultLanguage: true },
          salesChannelId: retailId,
          priceListId: null,
        },
      });
      const value = (name: string) => item.fields.find((f) => f.name === name)?.value;
      record('feed', productId, `${value('price')?.replace(' PLN', '')} for ${value('pack')}`);
    }

    // Shown (card, product page): the significant places; carried: four; the feed: a pack, exact.
    const expectedOn = (surface: string, productId: string): string => {
      const e = EXPECTED[productId]!;
      if (surface === 'card' || surface === 'product page') return e.shown;
      if (surface === 'feed') return e.feed;
      return e.resolver;
    };
    for (const [productId, surfaces] of Object.entries(seen)) {
      for (const [surface, value] of Object.entries(surfaces)) {
        expect(value, `${surface} ${productId}`).toBe(expectedOn(surface, productId));
      }
    }
    expect(Object.keys(seen[SEED_PRODUCT_101_ID]!).sort()).toEqual(
      ['card', 'cart line', 'feed', 'order preview line', 'product page', 'quote reference'].sort(),
    );
  });
});
