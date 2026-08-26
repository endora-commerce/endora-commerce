import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PriceList, PriceListPriceBracket, PriceListProduct } from '../../helpers/package-entities.js';
import type { ListingPriceViewerContext } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 086, the Phase A gate — **the ordering is the batch, sorted.**
 *
 * This is the identity property the whole design rests on, and it is the
 * analogue of `listing-prices-batch.test.ts`, which proved the same thing one
 * layer down (that the batched listing resolution answers exactly what looping
 * the per-product path answers).
 *
 * The assertion is deliberately not "the SQL returns plausible rows". It walks
 * the **whole corpus** through `resolveListingPrices` — the resolution every
 * card on every listing page already goes through — keeps the products it
 * answers a `price_list` arm for, sorts them by `(amount, productId)`, and
 * compares that sequence to what `orderByUnitPrice` streams. If the merge, the
 * exclusion, the watermark or the candidate vector disagreed with the priority
 * chain anywhere, the two sequences would differ.
 *
 * The corpus is built to make disagreement possible: a bracket gap that forces
 * the FR-031 fall-through, a sale partition that outranks a better-priced base
 * list, a category-scoped rule that applies to some products and not others,
 * two organisations whose lists invert, and products nothing prices.
 */

const CHANNEL_LIST = '00000000-0000-4000-8000-0000000186c1';
const ORG_A_LIST = '00000000-0000-4000-8000-0000000186c2';
const ORG_B_LIST = '00000000-0000-4000-8000-0000000186c3';
const CATEGORY_LIST = '00000000-0000-4000-8000-0000000186c4';
const SALE_LIST = '00000000-0000-4000-8000-0000000186c5';
const CATEGORY_ID = '00000000-0000-4000-8000-0000000186d1';

const CORPUS = 40;

function productId(i: number): string {
  return `00000000-0000-4000-8000-0000001860${String(i).padStart(2, '0')}`;
}

async function seedList(
  h: BackendServerHandle,
  input: {
    id: string;
    code: string;
    type: 'base' | 'sale';
    applicationRule: PriceList['applicationRule'];
    modifiedAt: Date;
    amounts: Map<string, string>;
  },
): Promise<void> {
  const em = h.em();
  const list = em.create(PriceList, {
    id: input.id,
    code: input.code,
    name: input.code,
    currency: 'PLN',
    isDefault: false,
    priority: 0,
    type: input.type,
    status: 'active',
    startsAt: null,
    endsAt: null,
    applicationRule: input.applicationRule,
    isSystem: false,
    modifiedAt: input.modifiedAt,
  });
  await em.persistAndFlush(list);
  for (const id of input.amounts.keys()) {
    em.create(PriceListProduct, { priceListId: input.id, productId: id });
  }
  await em.flush();
  for (const [id, amount] of input.amounts) {
    em.create(PriceListPriceBracket, {
      priceListId: input.id,
      productId: id,
      currencyCode: 'PLN',
      minQuantity: 1,
      maxQuantity: null,
      amount,
    });
  }
  await em.flush();
}

describe('orderByUnitPrice is resolveListingPrices, sorted', () => {
  let h: BackendServerHandle;
  let products: Product[] = [];
  let channelId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    channelId = retail.id;

    em.create(Category, {
      id: CATEGORY_ID,
      name: { 'en-US': 'order-identity' },
      slug: 'order-identity-category',
    });
    await em.flush();

    products = [];
    for (let i = 0; i < CORPUS; i += 1) {
      products.push(
        em.create(Product, {
          id: productId(i),
          sku: `ORDER-IDENTITY-${String(i).padStart(2, '0')}`,
          slug: `order-identity-${String(i).padStart(2, '0')}`,
          type: 'simple',
          status: 'active',
          name: { 'en-US': `Order identity ${i}` },
          description: { 'en-US': 'x' },
          visibility: 'public',
          allowedOrganizationIds: [],
          // Every fourth product carries the legacy attribute, so a run in
          // which it leaked into the ordering is distinguishable.
          attributeValues: i % 4 === 0 ? { defaultPrice: 3 } : {},
        }),
      );
    }
    await em.flush();
    // Every third product is in the category the category-scoped rule names.
    for (let i = 0; i < CORPUS; i += 3) {
      await em
        .getConnection()
        .execute(`insert into product_categories (product_id, category_id) values (?, ?)`, [
          productId(i),
          CATEGORY_ID,
        ]);
    }

    // The channel list prices everything except the last five — those are the
    // corpus's unpriced arm, and two of them carry the legacy attribute.
    const channelAmounts = new Map<string, string>();
    for (let i = 0; i < CORPUS - 5; i += 1) {
      channelAmounts.set(productId(i), `${(100 + ((i * 7) % 53)).toFixed(2)}`);
    }
    await seedList(h, {
      id: CHANNEL_LIST,
      code: 'order-identity-channel',
      type: 'base',
      applicationRule: { kind: 'all' },
      modifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      amounts: channelAmounts,
    });

    // Organisation A's list prices only half the corpus, so the other half
    // falls through to the channel list — FR-031, exercised on every page.
    const orgAAmounts = new Map<string, string>();
    for (let i = 0; i < CORPUS; i += 2) {
      if (i >= CORPUS - 5) continue;
      orgAAmounts.set(productId(i), `${(10 + ((i * 3) % 37)).toFixed(2)}`);
    }
    await seedList(h, {
      id: ORG_A_LIST,
      code: 'order-identity-org-a',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'organization', values: [TEST_ORGANIZATION_ID] },
      modifiedAt: new Date('2026-01-02T00:00:00.000Z'),
      amounts: orgAAmounts,
    });

    // Organisation B's inverts A's over the same products.
    const orgBAmounts = new Map<string, string>();
    for (let i = 0; i < CORPUS; i += 2) {
      if (i >= CORPUS - 5) continue;
      orgBAmounts.set(productId(i), `${(47 - ((i * 3) % 37)).toFixed(2)}`);
    }
    await seedList(h, {
      id: ORG_B_LIST,
      code: 'order-identity-org-b',
      type: 'base',
      applicationRule: {
        kind: 'criterion',
        type: 'organization',
        values: [OTHER_TEST_ORGANIZATION_ID],
      },
      modifiedAt: new Date('2026-01-03T00:00:00.000Z'),
      amounts: orgBAmounts,
    });

    // A category-scoped list: it outranks the channel list for the products in
    // the category and does not exist for the rest. Its assignment set is
    // deliberately **wider** than the category, so a stream that forgot the
    // membership predicate would price products the rule excludes.
    const categoryAmounts = new Map<string, string>();
    for (let i = 0; i < CORPUS - 5; i += 1) categoryAmounts.set(productId(i), `${(7 + i).toFixed(2)}`);
    await seedList(h, {
      id: CATEGORY_LIST,
      code: 'order-identity-category',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'category', values: [CATEGORY_ID] },
      modifiedAt: new Date('2026-01-04T00:00:00.000Z'),
      amounts: categoryAmounts,
    });

    // A sale list over a handful, which wins outright wherever it applies.
    const saleAmounts = new Map<string, string>();
    for (let i = 1; i < 12; i += 5) saleAmounts.set(productId(i), `${(2 + i).toFixed(2)}`);
    await seedList(h, {
      id: SALE_LIST,
      code: 'order-identity-sale',
      type: 'sale',
      applicationRule: { kind: 'all' },
      modifiedAt: new Date('2026-01-05T00:00:00.000Z'),
      amounts: saleAmounts,
    });

    // A bracket gap: drop the quantity-1 bracket from one product on the
    // highest-priority list it has, so the resolution must fall through.
    await em
      .getConnection()
      .execute(`delete from price_list_price_brackets where price_list_id = ? and product_id = ?`, [
        ORG_A_LIST,
        productId(2),
      ]);
    em.clear();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function contextFor(organization: { id: string } | null): ListingPriceViewerContext {
    return {
      salesChannel: { id: channelId, defaultCurrency: 'PLN' },
      organization,
    };
  }

  /** The whole corpus through the batch, kept to the `price_list` arm and sorted. */
  async function batchOrder(
    organization: { id: string } | null,
    direction: 'asc' | 'desc',
  ): Promise<Array<{ productId: string; amount: string }>> {
    const em = h.em();
    const rows = await em.find(Product, { sku: { $like: 'ORDER-IDENTITY-%' } });
    const resolved = await h.pricingService.resolveListingPrices({
      products: rows,
      context: contextFor(organization),
    });
    const priced: Array<{ productId: string; amount: string }> = [];
    for (const [id, price] of resolved) {
      if (price.source !== 'price_list') continue;
      priced.push({ productId: id, amount: price.amount });
    }
    priced.sort((a, b) => {
      const byAmount = Number(a.amount) - Number(b.amount);
      const raw = byAmount !== 0 ? byAmount : a.productId < b.productId ? -1 : 1;
      return direction === 'asc' ? raw : -raw;
    });
    return priced;
  }

  /** The same, streamed through the port, chunk by chunk to the end. */
  async function portOrder(
    organization: { id: string } | null,
    direction: 'asc' | 'desc',
    chunk: number,
  ): Promise<Array<{ productId: string; amount: string; priceListId: string; isSale: boolean }>> {
    const out: Array<{ productId: string; amount: string; priceListId: string; isSale: boolean }> = [];
    let after: { amount: string; productId: string } | null = null;
    for (let i = 0; i < 200; i += 1) {
      const result = await h.pricingService.orderByUnitPrice({
        context: contextFor(organization),
        direction,
        after,
        limit: chunk,
      });
      for (const row of result.rows) {
        out.push({
          productId: row.productId,
          amount: row.amount,
          priceListId: row.priceListId,
          isSale: row.isSale,
        });
      }
      if (result.rows.length === 0) {
        if (result.exhausted) break;
        continue;
      }
      const last = result.rows[result.rows.length - 1]!;
      after = { amount: last.amount, productId: last.productId };
      if (result.exhausted && result.rows.length < chunk) break;
    }
    return out;
  }

  const viewers: Array<[string, { id: string } | null]> = [
    ['anonymous', null],
    ['organisation A', { id: TEST_ORGANIZATION_ID }],
    ['organisation B', { id: OTHER_TEST_ORGANIZATION_ID }],
  ];

  for (const [label, organization] of viewers) {
    for (const direction of ['asc', 'desc'] as const) {
      for (const chunk of [3, 7, 50]) {
        it(`lists exactly what the batch lists — ${label}, ${direction}, chunks of ${chunk}`, async () => {
          const expected = await batchOrder(organization, direction);
          const actual = await portOrder(organization, direction, chunk);
          expect(actual.map((r) => ({ productId: r.productId, amount: r.amount }))).toEqual(
            expected,
          );
          // …and something was actually ordered, or the comparison is vacuous.
          expect(expected.length).toBeGreaterThan(20);
        });
      }
    }
  }

  it('answers the same winning list and sale flag the batch does, product by product', async () => {
    for (const [, organization] of viewers) {
      const em = h.em();
      const rows = await em.find(Product, { sku: { $like: 'ORDER-IDENTITY-%' } });
      const resolved = await h.pricingService.resolveListingPrices({
        products: rows,
        context: contextFor(organization),
      });
      const streamed = await portOrder(organization, 'asc', 9);
      for (const row of streamed) {
        const price = resolved.get(row.productId);
        expect(price?.source).toBe('price_list');
        if (price?.source !== 'price_list') continue;
        expect(row.priceListId, row.productId).toBe(price.priceListId);
        expect(row.isSale, row.productId).toBe(price.isSale);
        expect(row.amount, row.productId).toBe(price.amount);
      }
    }
  });

  it('answers `pricedProductIds` for exactly the products the batch prices', async () => {
    const em = h.em();
    const rows = await em.find(Product, { sku: { $like: 'ORDER-IDENTITY-%' } });
    for (const [label, organization] of viewers) {
      const resolved = await h.pricingService.resolveListingPrices({
        products: rows,
        context: contextFor(organization),
      });
      const expected = new Set(
        [...resolved].filter(([, p]) => p.source === 'price_list').map(([id]) => id),
      );
      const answered = await h.pricingService.pricedProductIds({
        context: contextFor(organization),
        productIds: rows.map((r) => r.id),
      });
      expect([...answered].sort(), label).toEqual([...expected].sort());
      // The five unpriced products are the tail, and they are really there.
      expect(rows.length - expected.size, label).toBe(5);
    }
  });

  it('narrows to an amount range without changing which list wins', async () => {
    const context = contextFor({ id: TEST_ORGANIZATION_ID });
    const all = await portOrder({ id: TEST_ORGANIZATION_ID }, 'asc', 50);
    const inRange = all.filter((r) => Number(r.amount) >= 20 && Number(r.amount) <= 40);
    const chunk = await h.pricingService.orderByUnitPrice({
      context,
      direction: 'asc',
      after: null,
      limit: 100,
      amountRange: { min: '20.0000', max: '40.0000' },
    });
    expect(chunk.rows.map((r) => r.productId)).toEqual(inRange.map((r) => r.productId));
    expect(inRange.length).toBeGreaterThan(0);
  });

  it('restricts to an opaque id set without interpreting it', async () => {
    const context = contextFor(null);
    const ids = [productId(1), productId(2), productId(3)];
    const chunk = await h.pricingService.orderByUnitPrice({
      context,
      direction: 'asc',
      after: null,
      limit: 50,
      restrictToProductIds: ids,
    });
    expect(chunk.rows.every((r) => ids.includes(r.productId))).toBe(true);
    expect(chunk.rows.length).toBeGreaterThan(0);

    const nothing = await h.pricingService.orderByUnitPrice({
      context,
      direction: 'asc',
      after: null,
      limit: 50,
      restrictToProductIds: [],
    });
    expect(nothing).toEqual({ rows: [], exhausted: true, sourceRowsRead: 0 });
  });
});
