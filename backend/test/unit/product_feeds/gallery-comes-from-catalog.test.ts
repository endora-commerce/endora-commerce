import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CatalogGalleryBatchItem, CatalogProductRecord } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import {
  FeedGenerationService,
  type FeedGenerationDeps,
  type FeedItemHydrationScope,
} from '../../../src/modules/product_feeds/services/feed-generation.service.js';

/**
 * Feature 075 / D-87, the `product_feeds` shard — a feed line's images are
 * asked of `catalog`, not selected out of its `gallery_items` table.
 *
 * The statement named no import specifier, so the boundary it crossed compiled
 * and returned rows — with no gate on it, a run assembled images out of a
 * module the platform might not be serving at all.
 * `catalogGalleryPort.listForProducts` answers the same question for the whole
 * hydration batch in one round-trip, which is why the per-product `list` was
 * never the replacement.
 *
 * The fake connection refuses any statement naming the table, so an
 * implementation that keeps the select fails here whatever it renders.
 */

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';
const ASSET_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ASSET_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ASSET_PRIVATE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function product(id: string, sku: string): CatalogProductRecord {
  return {
    id,
    sku,
    slug: `slug-${sku}`,
    type: 'simple',
    name: { en: sku },
    description: {},
    attributeValues: {},
  } as unknown as CatalogProductRecord;
}

/** Refuses anything naming the gallery table. */
function fakeEm(): EntityManager {
  return {
    getConnection: () => ({
      execute: async (sql: string) => {
        if (/gallery_item/i.test(sql)) {
          throw new Error(`product_feeds must not query catalog's gallery table: ${sql}`);
        }
        return [];
      },
    }),
    execute: async (sql: string) => {
      if (/gallery_item/i.test(sql)) {
        throw new Error(`product_feeds must not query catalog's gallery table: ${sql}`);
      }
      return [];
    },
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

function deps(overrides: Partial<FeedGenerationDeps>): FeedGenerationDeps {
  return {
    emFactory: fakeEm,
    catalogProducts: {
      findByIds: async () => [product(PRODUCT_A, 'SKU-A'), product(PRODUCT_B, 'SKU-B')],
    },
    catalogCategories: {
      listAssignmentsForProducts: async () => [],
      findByIds: async () => [],
    },
    catalogGallery: { listForProducts: async () => [] as CatalogGalleryBatchItem[] },
    resolvePublicImageUrls: async () => new Map<string, string>(),
    resolveAvailability: async () => new Map(),
    resolveAnonymousPrice: async () => null,
    ...overrides,
  } as unknown as FeedGenerationDeps;
}

describe('product_feeds — gallery items come from the catalog port', () => {
  it('asks `listForProducts` once for the batch and keeps the operator ordering', async () => {
    const listForProducts = vi.fn(async () => [
      { productId: PRODUCT_A, assetId: ASSET_A, position: 0 },
      { productId: PRODUCT_A, assetId: ASSET_B, position: 1 },
      { productId: PRODUCT_B, assetId: ASSET_B, position: 0 },
    ]);

    const items = await new FeedGenerationService(
      deps({
        catalogGallery: { listForProducts },
        resolvePublicImageUrls: async () =>
          new Map([
            [ASSET_A, 'https://cdn.test/a.png'],
            [ASSET_B, 'https://cdn.test/b.png'],
          ]),
      } as unknown as Partial<FeedGenerationDeps>),
    ).hydrateItems([PRODUCT_A, PRODUCT_B], scope);

    expect(listForProducts).toHaveBeenCalledTimes(1);
    expect(listForProducts).toHaveBeenCalledWith([PRODUCT_A, PRODUCT_B]);
    expect(items[0]?.imageUrls).toEqual(['https://cdn.test/a.png', 'https://cdn.test/b.png']);
    expect(items[1]?.imageUrls).toEqual(['https://cdn.test/b.png']);
  });

  it('still counts the gallery items whose asset is not publicly reachable', async () => {
    const items = await new FeedGenerationService(
      deps({
        catalogGallery: {
          listForProducts: async () => [
            { productId: PRODUCT_A, assetId: ASSET_A, position: 0 },
            { productId: PRODUCT_A, assetId: ASSET_PRIVATE, position: 1 },
          ],
        },
        resolvePublicImageUrls: async () => new Map([[ASSET_A, 'https://cdn.test/a.png']]),
      } as unknown as Partial<FeedGenerationDeps>),
    ).hydrateItems([PRODUCT_A, PRODUCT_B], scope);

    expect(items[0]?.imageUrls).toEqual(['https://cdn.test/a.png']);
    expect(items[0]?.privateImageCount).toBe(1);
    expect(items[1]?.imageUrls).toEqual([]);
    expect(items[1]?.privateImageCount).toBe(0);
  });

  it('asks the asset resolver only for the ids the port returned', async () => {
    const resolvePublicImageUrls = vi.fn(async () => new Map<string, string>());

    await new FeedGenerationService(
      deps({
        catalogGallery: {
          listForProducts: async () => [
            { productId: PRODUCT_A, assetId: ASSET_A, position: 0 },
            { productId: PRODUCT_B, assetId: ASSET_A, position: 0 },
          ],
        },
        resolvePublicImageUrls,
      } as unknown as Partial<FeedGenerationDeps>),
    ).hydrateItems([PRODUCT_A, PRODUCT_B], scope);

    expect(resolvePublicImageUrls).toHaveBeenCalledWith([ASSET_A]);
  });

  /**
   * Principle XVII item 6 — the off-state half of the new edge, asserted on the
   * seam rather than on an operator's flip. `providePort` wraps the
   * registration in a gate, so an absent owner reaches this caller as a
   * `ModuleDisabledError`. Hydration must let it out: the run's own `catch`
   * then records a failed run — a feed built from a catalogue the platform is
   * not serving is worse than a run that stops and says why — where an empty
   * image list here would have published one silently.
   *
   * `check:port-catches` cannot make this assertion: it reports a `catch` whose
   * every gate belongs to an owner the platform will not withdraw as
   * `OWNER LOCKED` rather than as a violation, and the run's `catch` is one of
   * those. So the property is asserted here instead.
   */
  it('lets the port gate refusal through instead of degrading to no images', async () => {
    const service = new FeedGenerationService(
      deps({
        catalogGallery: {
          listForProducts: async () => {
            throw new ModuleDisabledError('catalog');
          },
        },
      } as unknown as Partial<FeedGenerationDeps>),
    );

    await expect(service.hydrateItems([PRODUCT_A], scope)).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });
});
