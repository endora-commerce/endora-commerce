import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CatalogCategoryRecord, CatalogProductRecord } from '@b2b/contracts';
import {
  FeedGenerationService,
  type FeedGenerationDeps,
  type FeedItemHydrationScope,
} from '../../../src/modules/product_feeds/services/feed-generation.service.js';

/**
 * Feature 075, the `product_feeds` shard — a feed line's category path is asked
 * of `catalog`, not joined out of its `product_categories` table.
 *
 * The read sat two lines above a `catalogCategories.findByIds` that already went
 * to the owner, and it named no import specifier, so the boundary it crossed
 * compiled. `listAssignmentsForProducts` has answered it since D-87.
 *
 * The fake connection refuses any statement naming the table, so an
 * implementation that keeps the join fails here whatever path it renders.
 */

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const PARENT_CATEGORY = '22222222-2222-4222-8222-222222222222';
const LEAF_CATEGORY = '33333333-3333-4333-8333-333333333333';

function category(id: string, name: string, parentCategoryId: string | null) {
  return { id, name: { en: name }, parentCategoryId } as unknown as CatalogCategoryRecord;
}

function product(): CatalogProductRecord {
  return {
    id: PRODUCT,
    sku: 'SKU-1',
    slug: 'a-product',
    type: 'simple',
    name: { en: 'A product' },
    description: {},
    attributeValues: {},
  } as unknown as CatalogProductRecord;
}

/** Answers the gallery read and refuses anything naming the category bridge. */
function fakeEm(): EntityManager {
  return {
    getConnection: () => ({
      execute: async (sql: string) => {
        if (/product_categories/i.test(sql)) {
          throw new Error(`product_feeds must not query catalog's bridge table: ${sql}`);
        }
        return [];
      },
    }),
    getTransactionContext: () => undefined,
  } as unknown as EntityManager;
}

const scope: FeedItemHydrationScope = {
  salesChannelId: '44444444-4444-4444-8444-444444444444',
  channelDefaultCurrency: 'PLN',
  taxonomy: null,
  itemGranularity: 'product',
  context: {
    languageCode: 'en',
    currencyCode: 'PLN',
    priceListId: null,
  } as FeedItemHydrationScope['context'],
};

describe('product_feeds — category assignments come from the catalog port', () => {
  it('asks `listAssignmentsForProducts` and builds the path from what it returns', async () => {
    const listAssignmentsForProducts = vi.fn(async () => [
      { productId: PRODUCT, categoryId: LEAF_CATEGORY, slug: 'drills' },
    ]);
    const deps = {
      emFactory: fakeEm,
      catalogProducts: { findByIds: async () => [product()] },
      catalogCategories: {
        listAssignmentsForProducts,
        findByIds: async () => [
          category(LEAF_CATEGORY, 'Drills', PARENT_CATEGORY),
          category(PARENT_CATEGORY, 'Tools', null),
        ],
      },
      resolvePublicImageUrls: async () => new Map<string, string>(),
      resolveAvailability: async () => new Map(),
      resolveAnonymousPrice: async () => null,
    } as unknown as FeedGenerationDeps;

    const items = await new FeedGenerationService(deps).hydrateItems([PRODUCT], scope);

    expect(listAssignmentsForProducts).toHaveBeenCalledTimes(1);
    expect(listAssignmentsForProducts).toHaveBeenCalledWith([PRODUCT]);
    expect(items).toHaveLength(1);
    expect(items[0]?.categoryPath).toEqual(['Tools', 'Drills']);
  });
});
