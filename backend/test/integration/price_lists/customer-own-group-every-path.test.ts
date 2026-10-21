import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PricingServiceContract } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.interface.js';
import { CustomerAccount, CustomerGroup } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import {
  ORG_A_AMOUNT,
  ORG_A_BUYER,
  ORG_B_AMOUNT,
  ORG_B_BUYER,
  RETAIL_CHANNEL,
  seedViewerPricedFixture,
  VIEWER_PRICED_PRODUCT_ID,
  VIEWER_PRICED_SKU,
  VIEWER_PRICED_SLUG,
} from '../../helpers/viewer-priced-fixture.js';

/**
 * D-287 P0 — one customer-group rule on every storefront path, and one
 * resolution for the product page.
 *
 *     effective group = customer.customerGroupId ?? organization.customerGroupId ?? null
 *
 * The signed-in buyer of `ORG_A_BUYER` gets a customer group of their **own**
 * (their organisation has none), and a sale book (feature 160) targets that
 * group. Before P0
 * the listing, the product page, the resolved-price endpoint and the cart all
 * passed the organisation alone, so this buyer was quoted their organisation's
 * price there while a quote resolved the account and gave them the sale
 * (`specs/pricing/read-paths-and-performance.md` §2.2). A buyer of the other
 * organisation, who has no such group, must keep their own price.
 *
 * The second half is the product page's single resolution: the catalogue
 * detail carries the base / sale / display-mode split from the resolution that
 * priced `price`, so the storefront no longer resolves the product a second
 * time through `resolved-price` (`read-paths-and-performance.md` §2.1).
 */

const SALE_AMOUNT = 7;

describe('the customer’s own customer group is honoured on every storefront path', () => {
  let h: BackendServerHandle;
  let previousGroupId: string | null = null;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await seedViewerPricedFixture(em);

    const group = em.create(CustomerGroup, {
      code: `own-group-${Date.now()}`,
      name: 'Own group',
    });
    await em.persistAndFlush(group);
    const account = await em.findOneOrFail(CustomerAccount, { id: TEST_CUSTOMER_ID });
    previousGroupId = account.customerGroupId ?? null;
    account.customerGroupId = group.id;
    await em.flush();

    // Feature 160 — a sale book for the customer's own group.
    await seedPriceBookSql(em, {
      name: 'Own-group sale',
      type: 'sale',
      audience: { groups: [group.id] },
      rows: [{ productId: VIEWER_PRICED_PRODUCT_ID, fixed: String(SALE_AMOUNT) }],
    });
  }, 60_000);

  afterAll(async () => {
    const em = h.em();
    const account = await em.findOne(CustomerAccount, { id: TEST_CUSTOMER_ID });
    if (account) {
      account.customerGroupId = previousGroupId;
      await em.flush();
    }
    await teardownBackendServer(h);
  });

  async function listingPrice(cookies: Record<string, string>): Promise<number | undefined> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${VIEWER_PRICED_SKU}`,
      headers: RETAIL_CHANNEL,
      cookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: Array<{ sku: string; price: { amount: number } | null }> };
    return body.data.find((p) => p.sku === VIEWER_PRICED_SKU)?.price?.amount;
  }

  async function detail(cookies: Record<string, string>) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${VIEWER_PRICED_SLUG}`,
      headers: RETAIL_CHANNEL,
      cookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (
      res.json() as {
        data: {
          price: { amount: number } | null;
          resolvedPrice?: {
            basePrice: { amount: string; currency: string } | null;
            salePrice: { amount: string; currency: string } | null;
            displayMode: string;
          } | null;
        };
      }
    ).data;
  }

  async function resolvedPrice(cookies: Record<string, string>) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${VIEWER_PRICED_PRODUCT_ID}/resolved-price?quantity=1`,
      headers: RETAIL_CHANNEL,
      cookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (
      res.json() as {
        data: {
          resolvedPrice: {
            basePrice: { amount: string } | null;
            salePrice: { amount: string } | null;
            displayMode: string;
          };
        };
      }
    ).data.resolvedPrice;
  }

  it('the catalogue listing', async () => {
    expect(await listingPrice(ORG_A_BUYER)).toBe(SALE_AMOUNT);
    expect(await listingPrice(ORG_B_BUYER)).toBe(ORG_B_AMOUNT);
  });

  it('the product detail, which carries base, sale and display mode from the same resolution', async () => {
    const own = await detail(ORG_A_BUYER);
    expect(own.price?.amount).toBe(SALE_AMOUNT);
    expect(own.resolvedPrice).toEqual({
      basePrice: { amount: `${ORG_A_AMOUNT}.0000`, currency: 'PLN' },
      salePrice: { amount: `${SALE_AMOUNT}.0000`, currency: 'PLN' },
      displayMode: expect.any(String),
    });
    const other = await detail(ORG_B_BUYER);
    expect(other.price?.amount).toBe(ORG_B_AMOUNT);
    expect(other.resolvedPrice?.salePrice).toBeNull();
  });

  it('the resolved-price endpoint, which agrees with the product detail', async () => {
    for (const viewer of [ORG_A_BUYER, ORG_B_BUYER]) {
      const fromDetail = (await detail(viewer)).resolvedPrice!;
      const fromEndpoint = await resolvedPrice(viewer);
      expect(fromEndpoint.basePrice?.amount).toBe(fromDetail.basePrice?.amount);
      expect(fromEndpoint.salePrice?.amount ?? null).toBe(fromDetail.salePrice?.amount ?? null);
      expect(fromEndpoint.displayMode).toBe(fromDetail.displayMode);
    }
  });

  it('the cart line', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: ORG_A_BUYER,
      headers: { ...RETAIL_CHANNEL, 'content-type': 'application/json' },
      payload: { productId: VIEWER_PRICED_PRODUCT_ID, quantity: 1 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { data: { items: Array<{ productId: string; unitPrice: { amount: number } }> } })
      .data.items;
    expect(items.find((i) => i.productId === VIEWER_PRICED_PRODUCT_ID)?.unitPrice.amount).toBe(SALE_AMOUNT);

    // And the cart read's re-pricing agrees.
    const view = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: ORG_A_BUYER,
      headers: RETAIL_CHANNEL,
    });
    expect(view.statusCode, view.body).toBe(200);
    const line = (view.json() as { data: { items: Array<{ productId: string; unitPrice: { amount: number } }> } })
      .data.items.find((i) => i.productId === VIEWER_PRICED_PRODUCT_ID);
    expect(line?.unitPrice.amount).toBe(SALE_AMOUNT);
  });

  it('prices the product page once: one listing-detail resolution, no resolveEngine', async () => {
    const pricing = (h.container.cradle as unknown as { pricingService: PricingServiceContract })
      .pricingService;
    const details = vi.spyOn(pricing, 'resolveListingPriceDetails');
    const listing = vi.spyOn(pricing, 'resolveListingPrices');
    const engine = vi.spyOn(pricing, 'resolveEngine');
    try {
      await detail(ORG_A_BUYER);
      expect(details).toHaveBeenCalledTimes(1);
      expect(listing).not.toHaveBeenCalled();
      expect(engine).not.toHaveBeenCalled();
    } finally {
      details.mockRestore();
      listing.mockRestore();
      engine.mockRestore();
    }
  });
});
