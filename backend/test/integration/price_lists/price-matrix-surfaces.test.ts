import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PriceListMatrixEntry, Product } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_101_SKU } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ensureSalesChannel } from '../../helpers/sales-channel-fixtures.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 148 / US5 — every price surface agrees on a matrix price (FR-017),
 * the quantity-tier ladder includes the matrix's starting quantities (FR-018),
 * an entry only applies through a list that applies on the request's channel
 * (FR-019), and a feed pinned to a named list still reads that list's brackets
 * only (owner decision Q2).
 *
 * Fixture: product 101 costs 100.00 PLN on the Default list; the Default list
 * carries a 12% entry for the stub buyer's organization on the product's
 * category, and a 20% entry from 500 units.
 */
const BUYER = { b2b_session: 'stub-customer-session' };
const RETAIL = { 'x-sales-channel': 'pl_retail' };

describe('price matrix — every surface agrees (feature 148, US5)', () => {
  let h: BackendServerHandle;
  let categoryId: string;
  let channelA: SalesChannel;
  let retail: SalesChannel;
  let channelListId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await new DefaultPriceListMigrator(h.em).seedDefault();
    const lists = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    await lists.addProduct(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID);
    await lists.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
    });
    const rows = await em
      .getConnection()
      .execute<Array<{ category_id: string }>>(
        `select category_id from product_categories where product_id = ?`,
        [SEED_PRODUCT_101_ID],
      );
    categoryId = rows[0]!.category_id;
    for (const entry of [
      { categoryId, minQuantity: 1, maxQuantity: 499, discountPercent: '12' },
      { categoryId, minQuantity: 500, discountPercent: '20' },
    ]) {
      em.create(PriceListMatrixEntry, {
        priceListId: DEFAULT_PRICE_LIST_ID,
        organizationId: TEST_ORGANIZATION_ID,
        priceType: 'discount_percent',
        ...entry,
      });
    }
    await em.flush();

    retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    channelA = await ensureSalesChannel(em, 'pl148_channel_a');
    const channelList = await lists.create({
      name: 'Feature 148 channel A',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'salesChannel', values: [channelA.id] },
    });
    await lists.activate(channelList.id);
    channelListId = channelList.id;
    em.create(PriceListMatrixEntry, {
      priceListId: channelList.id,
      organizationId: TEST_ORGANIZATION_ID,
      minQuantity: 1,
      priceType: 'discount_percent',
      discountPercent: '50',
    });
    await em.flush();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('quotes the same amount on the listing, the product page, the storefront resolved price, the cart and the admin probe', async () => {
    const listing = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${SEED_PRODUCT_101_SKU}`,
      headers: RETAIL,
      cookies: BUYER,
    });
    expect(listing.statusCode).toBe(200);
    const card = (listing.json() as { data: Array<{ id: string; price: { amount: number } | null }> }).data.find(
      (p) => p.id === SEED_PRODUCT_101_ID,
    );
    expect(card?.price?.amount).toBe(88);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${SEED_PRODUCT_101_ID}`,
      headers: RETAIL,
      cookies: BUYER,
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { data: { price: { amount: number } | null } }).data.price?.amount).toBe(88);

    const resolved = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${SEED_PRODUCT_101_ID}/resolved-price?quantity=1`,
      headers: RETAIL,
      cookies: BUYER,
    });
    expect(resolved.statusCode).toBe(200);
    expect(
      (resolved.json() as { data: { resolvedPrice: { basePrice: { amount: string } } } }).data.resolvedPrice.basePrice
        .amount,
    ).toBe('88.0000');

    const cart = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { ...RETAIL, 'content-type': 'application/json' },
      cookies: BUYER,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });
    expect(cart.statusCode).toBe(200);
    const line = (cart.json() as { data: { items: Array<{ productId: string; unitPrice: { amount: number } }> } }).data.items.find(
      (i) => i.productId === SEED_PRODUCT_101_ID,
    );
    expect(line?.unitPrice.amount).toBe(88);

    const probe = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/products/${SEED_PRODUCT_101_ID}/resolved-price?organizationId=${TEST_ORGANIZATION_ID}&quantity=1&salesChannelId=${retail.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(probe.statusCode).toBe(200);
    expect(Number((probe.json() as { data: { resolvedPrice: { amount: string } } }).data.resolvedPrice.amount)).toBe(88);
  });

  it('applies an entry only through a list that applies on the request channel', async () => {
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const product = await h.em().findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    const on = async (channel: { id: string; defaultCurrency: string }) =>
      pricing.resolveLinePrice({
        product,
        context: {
          quantity: 1,
          organization: { id: TEST_ORGANIZATION_ID },
          salesChannel: { id: channel.id, defaultCurrency: 'PLN' },
          currencyCode: 'PLN',
        },
      });
    expect(await on(channelA)).toMatchObject({ amount: '50.0000', priceListId: channelListId });
    expect(await on(retail)).toMatchObject({ amount: '88.0000', priceListId: DEFAULT_PRICE_LIST_ID });
    // A channel no rule names is not a wildcard: the channel-A entry stays out.
    expect(await on({ id: '00000000-0000-4000-8000-0000001480cc', defaultCurrency: 'PLN' })).toMatchObject({
      amount: '88.0000',
      priceListId: DEFAULT_PRICE_LIST_ID,
    });
  });

  it("includes the matrix's starting quantities in the tier ladder", async () => {
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const quantities = await pricing.listTierStarts(SEED_PRODUCT_101_ID, 'PLN');
    expect(quantities).toEqual(expect.arrayContaining([1, 500]));
    expect([...quantities]).toEqual([...quantities].sort((a, b) => a - b));
    expect(new Set(quantities).size).toBe(quantities.length);
  });

  it('Q2 — a feed pinned to a named list reads its brackets only, not its matrix', async () => {
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const prices = await pricing.namedListPrices({
      priceListId: DEFAULT_PRICE_LIST_ID,
      currencyCode: 'PLN',
      productIds: [SEED_PRODUCT_101_ID],
    });
    expect(prices.get(SEED_PRODUCT_101_ID)).toBe('100.0000');
  });
});
