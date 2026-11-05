import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import type {
  CatalogAttributeReadPort,
  CatalogCategoryReadPort,
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CatalogProductRecord,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

/**
 * Issue #684 — a multiselect value is indexed as the array of its options, so a
 * Meilisearch filter `attributes.series = "s-146"` matches a product whose
 * `series` holds `"s-146"` among its options (Meilisearch matches an array
 * field when any element equals the value).
 *
 * The document used to carry the array's JSON text, `"[\"s-146\"]"`, which no
 * equality filter on an option can match: `filter[attr.series]=s-146` answered
 * `[]` on the Meilisearch backend while Postgres answered the product.
 *
 * The document is read off the one `addDocuments` call `upsertProduct` makes —
 * the client is replaced, nothing else of the indexer is.
 */

const added: unknown[][] = [];

vi.mock('meilisearch', () => {
  class FakeIndex {
    async addDocuments(documents: unknown[]) {
      added.push(documents);
      return { taskUid: 1 };
    }
    async deleteDocument() {
      return { taskUid: 2 };
    }
  }
  class Meilisearch {
    tasks = { waitForTask: async () => ({ status: 'succeeded' }) };
    async getIndex() {
      return new FakeIndex();
    }
  }
  return { Meilisearch };
});

const { SearchIndexer } = await import('./search-indexer.js');

// Feature 174 — the indexer reads the channel's languages: one `texts.<L>` per language it offers.
const CHANNEL = { id: 'ch-1', code: 'pl_retail', defaultLanguage: 'pl-PL', languages: ['pl-PL'] };

function productRecord(attributeValues: Record<string, unknown>): CatalogProductRecord {
  return {
    id: 'p1',
    sku: 'SKU-p1',
    slug: 'slug-p1',
    type: 'simple',
    status: 'active',
    name: 'Product p1',
    description: '',
    stockMode: null,
    visibility: 'public',
    attributeValues,
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
    minOrderQuantity: null,
    returnable: false,
  };
}

async function indexedAttributes(attributeValues: Record<string, unknown>): Promise<Record<string, unknown>> {
  added.length = 0;
  const indexer = new SearchIndexer({
    attributeRead: {
      listAll: async () => [],
      listByFlag: async () => [],
    } as unknown as CatalogAttributeReadPort,
    products: {
      findById: async () => productRecord(attributeValues),
      listValueOverridesByProductIds: async () => [],
    } as unknown as CatalogProductReadPort,
    categories: {
      listAssignmentsForProducts: async () => [],
    } as unknown as CatalogCategoryReadPort,
    channelMembership: {
      listChannelsForEntity: async () => [{ id: CHANNEL.id }],
    } as unknown as SalesChannelMembershipPort,
    availability: {
      describeChannelAvailability: async () =>
        new Map([
          [
            'p1',
            {
              liveLanguages: ['pl-PL'],
              window: { from: null, until: null },
              audience: { visibility: 'public', allowedOrganizationIds: [] },
            },
          ],
        ]),
    } as unknown as Pick<CatalogProductAvailabilityPort, 'describeChannelAvailability'>,
  });
  const em = { find: async () => [CHANNEL] } as unknown as EntityManager;

  expect(await indexer.upsertProduct(em, 'p1')).toEqual([CHANNEL.code]);
  expect(added).toHaveLength(1);
  const [document] = added[0] as Array<{ attributes: Record<string, unknown> }>;
  return document!.attributes;
}

describe('the indexed attribute values (issue #684)', () => {
  it('indexes a multiselect as the array of its options, so an option filter matches it', async () => {
    const attributes = await indexedAttributes({ series: ['s-146'], finish: ['matte', 'gloss'] });
    expect(attributes['series']).toEqual(['s-146']);
    expect(attributes['finish']).toEqual(['matte', 'gloss']);
  });

  it('renders each element as String does, the way the Postgres listing compares it', async () => {
    const attributes = await indexedAttributes({ sizes: [1.5, 2, 1e21, true, null], none: [] });
    expect(attributes['sizes']).toEqual(['1.5', '2', '1e+21', 'true', 'null']);
    expect(attributes['none']).toEqual([]);
  });

  it('keeps a scalar value as it is', async () => {
    const attributes = await indexedAttributes({ material: 'steel', weight: 2.5, fragile: true, colour: null });
    expect(attributes).toEqual({ material: 'steel', weight: 2.5, fragile: true, colour: null });
  });

  it('keeps an object value as its JSON text, the shape the query side ignores', async () => {
    const attributes = await indexedAttributes({ dimensions: { w: 1, h: 2 } });
    expect(attributes['dimensions']).toBe('{"w":1,"h":2}');
  });
});
