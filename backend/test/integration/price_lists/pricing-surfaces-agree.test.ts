import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BuyerLinePricePort } from '@endora-commerce/contracts';
import type { CartPlacementApplyPort } from '../../../../packages/modules/carts/src/ports/index.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 160 (FR-028, SC-002) — every pricing surface returns the same amount,
 * currency and price source for the same buyer, product, quantity, channel and
 * currency, because every one of them prices through the batched entry points
 * of the one price-book engine.
 *
 * The surfaces asked here: the catalogue listing, the product detail, the
 * storefront resolved price, the cart (add and read), the placement price
 * check, a quote's reference price (`buyerLinePricePort`), the admin order
 * preview, a product feed's anonymous price (`resolveLinePrices` with no
 * buyer) and the price sort. The buyer is the harness's signed-in customer of
 * `TEST_ORGANIZATION_ID`; one product is priced on the buyer tier (an
 * organization book) and one by a sale under the base.
 */
const SESSION = { b2b_session: 'stub-customer-session' };
const RETAIL = { 'x-sales-channel': 'pl_retail' };

describe('pricing — every surface agrees (SC-002)', () => {
  let h: BackendServerHandle;
  let retailId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    retailId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    // 101: base 19.99, the buyer's organization −10 % → 17.991 → 17.9910.
    await seedPriceBookSql(em, {
      name: 'Agree — organization',
      audience: { organizations: [TEST_ORGANIZATION_ID] },
      rows: [{ productId: SEED_PRODUCT_101_ID, percent: '-10' }],
    });
    // 102: base 24.50, a sale for everyone at 20.
    await seedPriceBookSql(em, {
      name: 'Agree — sale',
      type: 'sale',
      audience: 'everyone',
      rows: [{ productId: SEED_PRODUCT_102_ID, fixed: '20' }],
    });
  }, 5 * 60_000);

  afterAll(async () => {
    await h.cartService()?.clearForCustomer({ ...CUSTOMER_COOKIES[SESSION.b2b_session]!, salesChannelId: retailId });
    await teardownBackendServer(h);
  });

  const EXPECTED: Record<string, { amount: number; source: string }> = {
    [SEED_PRODUCT_101_ID]: { amount: 17.99, source: 'buyer' },
    [SEED_PRODUCT_102_ID]: { amount: 20, source: 'sale' },
  };

  it('listing, detail, resolved price, cart, placement, quote reference, admin preview, feed and sort agree', async () => {
    const seen: Record<string, Record<string, number>> = {};
    const record = (surface: string, productId: string, amount: number | undefined | null) => {
      (seen[productId] ??= {})[surface] = Number(Number(amount).toFixed(2));
    };

    const listing = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=100', headers: RETAIL, cookies: SESSION });
    expect(listing.statusCode, listing.body).toBe(200);
    for (const p of (listing.json() as { data: Array<{ id: string; price: { amount: number } | null }> }).data) {
      if (EXPECTED[p.id]) record('listing', p.id, p.price?.amount);
    }

    for (const productId of Object.keys(EXPECTED)) {
      const resolved = await h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/products/${productId}/resolved-price?quantity=1`,
        headers: RETAIL,
        cookies: SESSION,
      });
      expect(resolved.statusCode, resolved.body).toBe(200);
      const r = (resolved.json() as {
        data: { resolvedPrice: { basePrice: { amount: string } | null; salePrice: { amount: string } | null; source?: string } };
      }).data.resolvedPrice;
      record('resolved-price', productId, Number((r.salePrice ?? r.basePrice)?.amount));
      expect(r.source, `${productId} resolved-price source`).toBe(EXPECTED[productId]!.source);
    }

    for (const productId of Object.keys(EXPECTED)) {
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
    for (const line of cartData.items) if (EXPECTED[line.productId]) record('cart', line.productId, line.unitPrice.amount);

    const placement = (h.container.cradle as unknown as { cartPlacementApplyPort: CartPlacementApplyPort }).cartPlacementApplyPort;
    const drift = await placement.findPriceDrift(h.em().fork(), { cartId: cartData.id, organizationId: TEST_ORGANIZATION_ID });
    expect(drift).toEqual([]);
    for (const line of cartData.items) if (EXPECTED[line.productId]) record('placement', line.productId, line.unitPrice.amount);

    const buyerLines = (h.container.cradle as unknown as { buyerLinePricePort: BuyerLinePricePort }).buyerLinePricePort;
    const quoted = await buyerLines.resolveForBuyer({
      buyer: { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      salesChannelId: retailId,
      lines: Object.keys(EXPECTED).map((productId) => ({ key: productId, productId, variantId: null, quantity: 1 })),
    });
    for (const answer of quoted) record('quote reference', answer.key, Number(answer.price?.amount));

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
      record('admin preview', line.productId, Number(line.unitPrice));
    }

    for (const [productId, surfaces] of Object.entries(seen)) {
      for (const [surface, amount] of Object.entries(surfaces)) {
        expect(amount, `${surface} ${productId}`).toBe(EXPECTED[productId]!.amount);
      }
    }
    expect(Object.keys(seen[SEED_PRODUCT_101_ID]!).sort()).toEqual(
      ['admin preview', 'cart', 'listing', 'placement', 'quote reference', 'resolved-price'].sort(),
    );
  });

  it('a feed’s anonymous price and the price sort agree with the guest card', async () => {
    const pricing = (h.container.cradle as unknown as {
      pricingService: {
        resolveLinePrices(i: unknown): Promise<Map<string, { amount: string } | null>>;
        resolveListingPrices(i: unknown): Promise<Map<string, { source: string; amount?: string }>>;
        orderByUnitPrice(i: unknown): Promise<{ rows: Array<{ productId: string; amount: string }> }>;
      };
    }).pricingService;
    const reads = (h.container.cradle as unknown as {
      catalogProductReadPort: { findByIds(ids: readonly string[]): Promise<Array<{ id: string; attributeValues: Record<string, unknown> }>> };
    }).catalogProductReadPort;
    const products = await reads.findByIds([SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID]);
    const channel = { id: retailId, defaultCurrency: 'PLN' };
    const feed = await pricing.resolveLinePrices({
      lines: products.map((p) => ({ key: p.id, product: p, quantity: 1 })),
      context: { organization: null, salesChannel: channel },
    });
    const cards = await pricing.resolveListingPrices({ products, context: { salesChannel: channel } });
    const sorted = await pricing.orderByUnitPrice({
      context: { salesChannel: channel },
      direction: 'asc',
      after: null,
      limit: 10,
      restrictToProductIds: products.map((p) => p.id),
    });
    for (const p of products) {
      expect(feed.get(p.id)?.amount, p.id).toBe(cards.get(p.id)?.amount);
      expect(sorted.rows.find((r) => r.productId === p.id)?.amount, p.id).toBe(cards.get(p.id)?.amount);
    }
  });
});
