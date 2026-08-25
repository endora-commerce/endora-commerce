import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import type {
  CatalogAttributeReadPort,
  CatalogGalleryPort,
  CatalogProductReadPort,
  CatalogProductRecord,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import type { SalesChannelMembershipPort } from '../../../src/kernel/ports/sales-channel.js';
import { ComparableAttributeProjection } from '../../../../packages/modules/comparisons/src/backend/services/comparable-attribute-projection.js';
import { ComparisonService } from '../../../../packages/modules/comparisons/src/backend/services/comparison-service.js';
import { ShareTokenGenerator } from '../../../../packages/modules/comparisons/src/backend/services/share-token-generator.js';

/**
 * Feature 075 / D-87, the `comparisons` shard — the base image of a comparison
 * column is asked of `catalog`, not joined out of its tables.
 *
 * `loadBaseImageUrls` was one statement over three tables:
 * `gallery_item_labels` → `gallery_items` → `assets`. Two of them are
 * `catalog`'s and the third is `assets_library`'s, so the single statement was
 * three cross-module reaches — and a join cannot be half replaced, which is why
 * the three ledger entries retire together.
 *
 * `catalogGalleryPort.baseImageUrls` is the replacement `list(productId)` could
 * never be: it takes the batch, it does not assert the products exist, and it
 * answers with a **url**, resolved on `catalog`'s side through the asset port
 * that module already holds.
 *
 * The fake `EntityManager` refuses every one of the three tables, so an
 * implementation that keeps the join fails here whatever it renders.
 */

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';

function productRecord(id: string): CatalogProductRecord {
  return {
    id,
    sku: `SKU-${id}`,
    slug: `slug-${id}`,
    type: 'simple',
    status: 'active',
    name: { en: `Product ${id}` },
    description: {},
    stockMode: null,
    visibility: 'public',
    attributeValues: {},
    allowedOrganizationIds: [],
    attributeSetId: 'set-1',
    downloadAssetId: null,
    downloadUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
    deletedAt: null,
    manageStock: false,
    backorderEnabled: false,
    lowStockThreshold: null,
    lowStockThresholdMode: 'cumulative',
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
  } as unknown as CatalogProductRecord;
}

/** Serves this module's own rows and refuses the three tables the join named. */
function fakeEm(bridgeRows: unknown[]): () => EntityManager {
  const refuse = async (sql: string): Promise<unknown[]> => {
    if (/gallery_item_labels|gallery_items|\bassets\b/i.test(sql)) {
      throw new Error(`comparisons must not query that table itself: ${sql}`);
    }
    return [];
  };
  const em = {
    find: async (entity: { name?: string }) =>
      entity.name === 'ComparisonProduct' ? bridgeRows : [],
    findOne: async () => null,
    execute: refuse,
    getConnection: () => ({ execute: refuse }),
  };
  return () => em as unknown as EntityManager;
}

const settingsStub = { get: async () => 4 } as unknown as SettingsService;

const attributePortStub: CatalogAttributeReadPort = {
  listAll: async () => [],
  getByIdOrKey: async () => null,
  listByFlag: async () => [],
  optionLabelIndex: async () => new Map(),
};

const refusingChannelMembership = new Proxy(
  {},
  {
    get: (_target, property) => () => {
      throw new Error(`comparisons unexpectedly called the channel bridge.${String(property)}`);
    },
  },
) as SalesChannelMembershipPort;

const catalogProducts = {
  findById: async () => null,
  findByIds: async (ids: readonly string[]) => ids.map((id) => productRecord(id)),
  findBySku: async () => null,
  findBySkus: async () => [],
  countByIds: async () => 0,
  listAll: async () => [],
  listVariantsByProductIds: async () => [],
  findVariantsBySkus: async () => [],
  findVariantInProduct: async () => null,
  findPackagingUnitInProduct: async () => null,
  listLinksBySourceIds: async () => [],
  listValueOverridesByProductIds: async () => [],
} as unknown as CatalogProductReadPort;

function serviceWith(gallery: CatalogGalleryPort, bridgeRows: unknown[]): ComparisonService {
  return new ComparisonService(
    fakeEm(bridgeRows),
    new ComparableAttributeProjection(),
    new ShareTokenGenerator(),
    catalogProducts,
    refusingChannelMembership,
    gallery,
    settingsStub,
    attributePortStub,
    { resolveListingPrices: async () => new Map() },
  );
}

const COMPARISON = {
  id: 'cmp-1',
  shareToken: 'tok',
  displayMode: 'all',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} as never;

function bridgeRow(productId: string, position: number): unknown {
  return { productId, position, addedAt: new Date('2026-02-01T00:00:00.000Z') };
}

function galleryPort(
  baseImageUrls: CatalogGalleryPort['baseImageUrls'],
): CatalogGalleryPort {
  return {
    list: async () => {
      throw new Error('comparisons must not ask for one product at a time');
    },
    listForProducts: async () => [],
    baseImageUrls,
    create: async () => {
      throw new Error('comparisons writes no gallery');
    },
    delete: async () => {
      throw new Error('comparisons writes no gallery');
    },
    reorder: async () => {
      throw new Error('comparisons writes no gallery');
    },
  } as unknown as CatalogGalleryPort;
}

describe('comparisons — the base image arrives over catalogGalleryPort', () => {
  it('asks the port once for the whole comparison and renders what it returns', async () => {
    const baseImageUrls = vi.fn(async (ids: readonly string[]) => {
      const out = new Map<string, string | null>();
      for (const id of ids) out.set(id, null);
      out.set(PRODUCT_A, 'https://cdn.test/a.png');
      return out;
    });

    const view = await serviceWith(galleryPort(baseImageUrls), [
      bridgeRow(PRODUCT_A, 0),
      bridgeRow(PRODUCT_B, 1),
    ]).buildOwnerView(COMPARISON, 'channel-1');

    expect(baseImageUrls).toHaveBeenCalledTimes(1);
    expect(baseImageUrls).toHaveBeenCalledWith([PRODUCT_A, PRODUCT_B]);
    expect(view.products.map((p) => p.primaryAssetUrl)).toEqual([
      'https://cdn.test/a.png',
      null,
    ]);
  });

  it('does not ask at all for a comparison with no visible products', async () => {
    const baseImageUrls = vi.fn(async () => new Map<string, string | null>());

    const view = await serviceWith(galleryPort(baseImageUrls), []).buildOwnerView(
      COMPARISON,
      'channel-1',
    );

    expect(baseImageUrls).not.toHaveBeenCalled();
    expect(view.products).toEqual([]);
  });

  /**
   * Principle XVII item 6 — the off-state half of the new edge, asserted on the
   * seam rather than on an operator's flip. `providePort` wraps the
   * registration in a gate, so an absent owner reaches this caller as a
   * `ModuleDisabledError`, and `catalog` is a binding dependency of this
   * module: a comparison is a list of that module's products, so a view whose
   * products cannot be read has no column to put an image in and the refusal
   * must reach the caller rather than be absorbed into an imageless one.
   *
   * `check:port-catches` cannot make this assertion here — a `catch` whose
   * every gate belongs to an owner the platform will not withdraw is reported
   * as `OWNER LOCKED` rather than as a violation — so it is asserted in a test.
   */
  it('lets the port gate refusal through instead of degrading to no image', async () => {
    const service = serviceWith(
      galleryPort(async () => {
        throw new ModuleDisabledError('catalog');
      }),
      [bridgeRow(PRODUCT_A, 0)],
    );

    await expect(service.buildOwnerView(COMPARISON, 'channel-1')).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });
});
