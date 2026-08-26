import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization, PriceDisplayModeOverride } from '../../helpers/package-entities.js';
import type { ListingPrice } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { CustomerGroup } from '../../helpers/package-entities.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import { PricingCache } from '../../../../packages/modules/price_lists/src/backend/services/pricing-cache.js';
import { listingPriceFrom } from '../../../../packages/modules/price_lists/src/backend/services/listing-price-chain.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Characterisation of the batched listing-price path (issue #132 follow-up).
 *
 * `resolveListingPrices` resolved its products one at a time — 7 queries per
 * product, all sequential, on the busiest storefront read there is. Batching
 * changes *how the rows are loaded*, and this file is the proof that it changes
 * nothing else: for a representative fixture — five products, four price lists,
 * a bracket gap that forces the priority chain to fall through, a customer
 * group, a sale partition, a product priced only by its own attribute and one
 * priced by nothing — the batched map must equal, product by product, what the
 * per-product path (`resolveLinePrice` → `listingPriceFrom`) answers.
 *
 * The per-product path is deliberately left as the reference: it is the one
 * cart, checkout and the admin resolved-price probe use, it did not change, and
 * a comparison against a shared implementation would prove nothing.
 *
 * The second characterisation covers the display-mode chain, which the listing
 * result does not carry: `resolveDisplayModes` (batch) against
 * `resolveDisplayMode` (per product), over product-, category- and
 * organization-scope overrides plus the settings fallback.
 *
 * The third assertion is the one that was red before the batching: the query
 * count for a page must stop scaling with the page size.
 */

/** Wraps the shared connection so a block of work can be counted. */
async function countQueries<T>(
  h: BackendServerHandle,
  work: () => Promise<T>,
): Promise<{ result: T; queries: number }> {
  const conn = h.em().getConnection() as unknown as {
    execute: (...args: unknown[]) => Promise<unknown>;
  };
  const original = conn.execute.bind(conn);
  let queries = 0;
  conn.execute = (...args: unknown[]) => {
    queries += 1;
    return original(...args);
  };
  try {
    const result = await work();
    return { result, queries };
  } finally {
    conn.execute = original;
  }
}

describe('price_lists — batched listing price resolution', () => {
  let h: BackendServerHandle;
  let salesChannel: SalesChannel;
  let organization: Organization;
  let customerGroup: CustomerGroup;
  let products: Product[];
  let childCategoryId: string;
  const overrideTargets: Array<{ scope: 'product' | 'category' | 'organization'; targetId: string }> =
    [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    salesChannel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });

    customerGroup = em.create(CustomerGroup, {
      code: `cg-batch-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: 'Batch VIP',
    });
    await em.persistAndFlush(customerGroup);

    organization = em.create(Organization, {
      name: 'Batch Test Org',
      taxId: `BATCH-${Date.now() % 10_000_000}-${Math.floor(Math.random() * 1000)}`,
      vatStatus: 'vat_payer',
      status: 'active',
      customerGroupId: customerGroup.id,
      registeredAddress: { street: 'Test 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    });
    await em.persistAndFlush(organization);

    const p101 = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    const p102 = await em.findOneOrFail(Product, { id: SEED_PRODUCT_102_ID });
    const p103 = await em.findOneOrFail(Product, { id: SEED_PRODUCT_103_ID });

    // A product with no category and only its own price attribute — the
    // chain's second step. And one with neither — the `none` arm.
    const ownPriceOnly = em.create(Product, {
      sku: `BATCH-OWN-${Date.now()}`,
      slug: `batch-own-${Date.now()}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Own price only' },
      description: { 'en-US': 'x' },
      visibility: 'public',
      attributeValues: { defaultPrice: 55.5 },
    });
    const unpriced = em.create(Product, {
      sku: `BATCH-NONE-${Date.now()}`,
      slug: `batch-none-${Date.now()}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Unpriced' },
      description: { 'en-US': 'x' },
      visibility: 'public',
      attributeValues: {},
    });
    await em.persistAndFlush([ownPriceOnly, unpriced]);
    products = [p101, p102, p103, ownPriceOnly, unpriced];

    const categoryRows = await em
      .getConnection()
      .execute<
        Array<{ category_id: string }>
      >(`select category_id from product_categories where product_id = ?`, [SEED_PRODUCT_101_ID]);
    childCategoryId = categoryRows[0]!.category_id;

    await new DefaultPriceListMigrator(h.em).seedDefault();
    const lists = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));

    // Terminal fallback: Default carries the three seed products.
    for (const [product, amount] of [
      [p101, '100'],
      [p102, '110'],
      [p103, '120'],
    ] as const) {
      await lists.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
      await lists.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount }],
      });
    }

    // Highest priority for this org — but its only bracket starts at 5, so a
    // listing (quantity 1) falls through to the next list in the partition.
    const orgList = await lists.create({
      name: 'Batch Org List',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'organization', values: [organization.id] },
    });
    await lists.addProduct(orgList.id, p101.id);
    await lists.replaceBrackets(orgList.id, p101.id, {
      PLN: [{ minQuantity: 5, maxQuantity: null, amount: '70' }],
    });
    await lists.activate(orgList.id);

    // Category rule — matches p101 and p102 through their shared category.
    const catList = await lists.create({
      name: 'Batch Category List',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'category', values: [childCategoryId] },
    });
    for (const [product, amount] of [
      [p101, '85'],
      [p102, '88'],
    ] as const) {
      await lists.addProduct(catList.id, product.id);
      await lists.replaceBrackets(catList.id, product.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount }],
      });
    }
    await lists.activate(catList.id);

    // Sale partition, on the customer group the org belongs to.
    const saleList = await lists.create({
      name: 'Batch Sale List',
      type: 'sale',
      applicationRule: { kind: 'criterion', type: 'customerGroup', values: [customerGroup.id] },
    });
    await lists.addProduct(saleList.id, p103.id);
    await lists.replaceBrackets(saleList.id, p103.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '60' }],
    });
    await lists.activate(saleList.id);

    // A draft list that must never be consulted (FR-032).
    const draftList = await lists.create({
      name: 'Batch Draft List',
      type: 'base',
      applicationRule: { kind: 'all' },
    });
    await lists.addProduct(draftList.id, p101.id);
    await lists.replaceBrackets(draftList.id, p101.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '1' }],
    });

    // Display-mode overrides across all three scopes.
    for (const [scope, targetId, mode] of [
      ['product', p102.id, 'net_only'],
      ['category', childCategoryId, 'both'],
      ['organization', organization.id, 'none'],
    ] as const) {
      em.create(PriceDisplayModeOverride, { scope, targetId, mode });
      overrideTargets.push({ scope, targetId });
    }
    await em.flush();
  }, 5 * 60_000);

  afterAll(async () => {
    // Scoped cleanup — this table is not in the harness's truncate list and a
    // bare wipe would be a claim about the whole platform (issue #166).
    const em = h.em();
    for (const target of overrideTargets) {
      await em.nativeDelete(PriceDisplayModeOverride, {
        scope: target.scope,
        targetId: target.targetId,
      });
    }
    await teardownBackendServer(h);
  });

  const viewers = [
    { label: 'anonymous visitor', organization: null, customerGroupId: null },
    { label: 'signed-in organisation', organization: 'org' as const, customerGroupId: null },
    {
      label: "signed-in customer whose own group overrides the org's",
      organization: 'org' as const,
      customerGroupId: 'cg' as const,
    },
  ];

  for (const viewer of viewers) {
    it(`answers exactly what the per-product path answers — ${viewer.label}`, async () => {
      const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
      const org = viewer.organization === 'org' ? organization : null;
      const groupId = viewer.customerGroupId === 'cg' ? customerGroup.id : null;
      const context = {
        organization: org,
        customerGroupId: groupId,
        salesChannel: { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency },
      };

      const batched = await pricing.resolveListingPrices({ products, context });

      const looped = new Map<string, ListingPrice>();
      for (const product of products) {
        const line = await pricing.resolveLinePrice({
          product,
          variantId: null,
          context: {
            quantity: 1,
            organization: org,
            customerGroupId: groupId,
            salesChannel: context.salesChannel,
            currencyCode: salesChannel.defaultCurrency.toUpperCase(),
          },
        });
        looped.set(product.id, listingPriceFrom(line, product, salesChannel.defaultCurrency));
      }

      expect(batched.size).toBe(products.length);
      for (const product of products) {
        expect(batched.get(product.id)).toEqual(looped.get(product.id));
      }
    });
  }

  it('resolves the fixture the way the chain says it should', async () => {
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveListingPrices({
      products,
      context: {
        organization,
        salesChannel: { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency },
      },
    });

    // The org list is highest priority and has no quantity-1 bracket, so the
    // chain falls through to the category list.
    expect(out.get(SEED_PRODUCT_101_ID)).toMatchObject({ source: 'price_list', amount: '85.0000' });
    expect(out.get(SEED_PRODUCT_102_ID)).toMatchObject({ source: 'price_list', amount: '88.0000' });
    // Sale wins on p103 even though a base list prices it.
    expect(out.get(SEED_PRODUCT_103_ID)).toMatchObject({ source: 'price_list', isSale: true, amount: '60.0000' });
    expect(out.get(products[3]!.id)).toEqual({ source: 'product', amount: '55.50', currency: 'PLN' });
    expect(out.get(products[4]!.id)).toEqual({ source: 'none' });
  });

  it('resolves display modes for a set exactly as the per-product chain does', async () => {
    const lists = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    for (const customerKind of ['guest', 'signed_in'] as const) {
      const organizationId = customerKind === 'signed_in' ? organization.id : null;
      const batched = await lists.resolveDisplayModes({
        productIds: products.map((p) => p.id),
        organizationId,
        salesChannelId: salesChannel.id,
        customerKind,
      });
      for (const product of products) {
        const single = await lists.resolveDisplayMode({
          productId: product.id,
          organizationId,
          salesChannelId: salesChannel.id,
          customerKind,
        });
        expect(batched.get(product.id)).toBe(single);
      }
    }
  });

  it('stops paying a query count that scales with the page', async () => {
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const context = {
      organization,
      salesChannel: { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency },
    };
    // A page is the same five products repeated, so the per-product loop's
    // count grows with the page and the batch's does not.
    const page = Array.from({ length: 40 }, (_, i) => products[i % products.length]!);

    const { result, queries } = await countQueries(h, () =>
      pricing.resolveListingPrices({ products: page, context }),
    );

    expect(result.size).toBe(products.length);
    // The loop cost 7 queries per product — 280 for this page. The batch is a
    // small constant: categories, active lists, the bracket waves, and the
    // display-mode chain's four reads.
    expect(queries).toBeLessThanOrEqual(20);
  });

  it('serves a second page from the LRU without touching the database', async () => {
    const cache = new PricingCache<never>({ ttlMs: 60_000 });
    const pricing = new PricingService(
      h.em,
      cache as never,
      undefined,
      neighbourReadPorts(h.em),
    );
    const context = {
      organization,
      salesChannel: { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency },
    };

    const first = await pricing.resolveListingPrices({ products, context });
    const { result: second, queries } = await countQueries(h, () =>
      pricing.resolveListingPrices({ products, context }),
    );

    expect(queries).toBe(0);
    for (const product of products) {
      expect(second.get(product.id)).toEqual(first.get(product.id));
    }
  });
});
