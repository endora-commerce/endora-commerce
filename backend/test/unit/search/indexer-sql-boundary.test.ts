import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type {
  CatalogAttributeReadPort,
  CatalogCategoryAssignmentRecord,
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CatalogProductRecord,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '../../../src/kernel/ports/sales-channel.js';
import type { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { SearchIndexer } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';

/**
 * Feature 075 / D-87 — the indexer's four raw-SQL reaches across the boundary.
 *
 * Phase C converted this file's entity reads to `catalogProductReadPort` and
 * left the statements, because raw SQL names no import specifier and nothing in
 * the tree could see them. The `sql` predicate can, and it found nine: three
 * statements joining `catalog`'s `product_categories` and `categories`, and two
 * touching the `sales_channel_products` bridge Principle XII reserves for the
 * membership accessor.
 *
 * The fake below is what makes these cases able to fail: an `EntityManager`
 * that serves the kernel's own `SalesChannel` rows, refuses every other entity
 * by name, and **throws on any raw statement**, quoting it. Before the cut each
 * case died inside `getConnection().execute`, naming the query that crossed.
 * The previous fake answered `[]` there, which is the fixture-substitution
 * shape `check:fixture-substitution` refuses — a boundary crossing rendered as
 * "no rows".
 */

function productRecord(id: string): CatalogProductRecord {
  return {
    id,
    sku: `SKU-${id}`,
    slug: `slug-${id}`,
    type: 'simple',
    status: 'active',
    name: { 'en-US': `Product ${id}` },
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
  };
}

/**
 * Serves the kernel entity this module is allowed to read and nothing else.
 *
 * The channel list is deliberately empty in every case here: `upsertProduct`
 * reads the memberships and the category assignments *before* it walks the
 * channels, so zero channels means the reads under test all happen and no
 * Meilisearch client is ever reached.
 */
function boundaryRefusingEm(channels: SalesChannel[] = []): EntityManager {
  const refuseEntity = (entity: { name?: string }): never => {
    throw new Error(
      `search queried '${entity?.name ?? '(anonymous)'}' directly — that row belongs to another module`,
    );
  };
  const refuseSql = (sql: string): never => {
    throw new Error(
      `search ran raw SQL across a module boundary: ${sql.trim().split('\n')[0]?.trim()}`,
    );
  };
  return {
    find: async (entity: { name?: string }) =>
      entity?.name === 'SalesChannel' ? channels : refuseEntity(entity),
    findOne: async (entity: { name?: string }) => refuseEntity(entity),
    execute: async (sql: string) => refuseSql(sql),
    getConnection: () => ({ execute: async (sql: string) => refuseSql(sql) }),
  } as unknown as EntityManager;
}

const attributeRead = {
  listAll: async () => [],
  listByFlag: async () => [],
  getByIdOrKey: async () => null,
  optionLabelIndex: async () => new Map(),
} as unknown as CatalogAttributeReadPort;

interface Recorder {
  assignmentsFor: string[][];
  subtreesFor: string[];
  membershipsFor: string[];
}

function ports(recorder: Recorder, product: CatalogProductRecord | null): {
  products: CatalogProductReadPort;
  categories: CatalogCategoryReadPort;
  channelMembership: SalesChannelMembershipPort;
} {
  const assignment = (productId: string): CatalogCategoryAssignmentRecord => ({
    productId,
    categoryId: 'cat-1',
    slug: 'tools',
  });
  return {
    products: {
      findById: async () => product,
      findByIds: async (ids: readonly string[]) => (product ? [...ids].map(productRecord) : []),
      listValueOverridesByProductIds: async () => [],
    } as unknown as CatalogProductReadPort,
    categories: {
      listAssignmentsForProducts: async (productIds: readonly string[]) => {
        recorder.assignmentsFor.push([...productIds]);
        return productIds.map(assignment);
      },
      listProductIdsInSubtree: async (categoryId: string) => {
        recorder.subtreesFor.push(categoryId);
        return ['p1', 'p2'];
      },
    } as unknown as CatalogCategoryReadPort,
    channelMembership: {
      listChannelsForEntity: async (_type: string, entityId: string) => {
        recorder.membershipsFor.push(entityId);
        return [];
      },
      listEntityIdsForChannel: async () => ({ entityIds: [], total: 0 }),
    } as unknown as SalesChannelMembershipPort,
  };
}

function recorder(): Recorder {
  return { assignmentsFor: [], subtreesFor: [], membershipsFor: [] };
}

describe('search indexer — the raw-SQL reaches cross no module boundary', () => {
  it('reads the channel memberships of a product through the sanctioned bridge accessor', async () => {
    const seen = recorder();
    const indexer = new SearchIndexer({ attributeRead, ...ports(seen, productRecord('p1')) });

    const touched = await indexer.upsertProduct(boundaryRefusingEm(), 'p1');

    expect(touched).toEqual([]);
    expect(seen.membershipsFor).toEqual(['p1']);
  });

  it('reads the category assignments of a product through catalogCategoryReadPort', async () => {
    const seen = recorder();
    const indexer = new SearchIndexer({ attributeRead, ...ports(seen, productRecord('p1')) });

    await indexer.upsertProduct(boundaryRefusingEm(), 'p1');

    expect(seen.assignmentsFor).toEqual([['p1']]);
  });

  it('walks a category subtree through catalogCategoryReadPort', async () => {
    const seen = recorder();
    // No product resolves, so each `upsertProduct` returns before it reaches
    // Meilisearch — the assertion here is the subtree read, not the re-index.
    const indexer = new SearchIndexer({ attributeRead, ...ports(seen, null) });

    const count = await indexer.reindexCategorySubtree(boundaryRefusingEm(), 'cat-1');

    expect(count).toBe(2);
    expect(seen.subtreesFor).toEqual(['cat-1']);
  });
});
