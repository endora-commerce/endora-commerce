import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type {
  CatalogAttributeReadPort,
  CatalogProductReadPort,
  CatalogProductRecord,
  OrganizationDetailsPort,
  OrganizationRecord,
  ProductSummary,
} from '@b2b/contracts';
import { SearchIndexer } from '../../../src/modules/search/services/search-indexer.js';
import {
  createSuggestionPricingEnricher,
  type SuggestionPriceResolverPort,
} from '../../../src/modules/search/services/suggestion-pricing-enricher.js';

/**
 * Feature 075, Phase C — `search` asks `catalog` and `organizations` for their
 * rows instead of querying their tables (FR-012).
 *
 * Both reads used to be `em.find(<their entity>, …)` from inside this module,
 * which is the shape Principle XVII cannot gate: deactivation drops no tables,
 * so the indexer kept rewriting Meilisearch documents and the typeahead kept
 * pricing hits out of modules an operator had switched off. Through a port the
 * same read answers 503 `MODULE_DISABLED`, and both owners are binding
 * `dependencies` of this module's manifest.
 *
 * These cases assert the demand, not the plumbing: an `EntityManager` that
 * **refuses** to serve any entity, plus stub ports, must be enough. A fake that
 * would notice the old query is what makes the test able to fail — before the
 * cut, `upsertProduct` threw out of the fake's `findOne(Product, …)` and the
 * enricher threw out of its `find`.
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

function organizationRecord(id: string, customerGroupId: string | null): OrganizationRecord {
  return {
    id,
    name: 'Acme',
    legalName: null,
    taxId: '1234567890',
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    customerGroupId,
    registeredAddress: { street: 'Main 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    orderConfirmationEmails: [],
    vatValidatedAt: null,
    vatValidationProvider: null,
    vatValidationOutcome: null,
    blockedReason: null,
    blockedAt: null,
    rejectedReason: null,
    rejectedAt: null,
    approvedAt: null,
    approvedByAdminUserId: null,
    requiresCartApproval: false,
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    parentId: null,
    path: `/${id}/`,
    creditInheritanceMode: null,
    customFieldValues: {},
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };
}

/**
 * An `EntityManager` that refuses every entity read. `search` owns one table
 * (`search_phrase_records`) and neither path here touches it, so "refuse
 * everything" is the sharpest fake available: any surviving `em.find` /
 * `em.findOne` of another module's row fails loudly, naming the class.
 */
function refusingEm(): EntityManager {
  const refuse = (entity: { name?: string }): never => {
    throw new Error(
      `search queried '${entity.name ?? '(anonymous)'}' directly — that row belongs to another module`,
    );
  };
  return {
    findOne: async (entity: { name?: string }) => refuse(entity),
    find: async (entity: { name?: string }) => refuse(entity),
    // A raw statement is refused rather than answered with `[]`: this module's
    // remaining boundary crossings were SQL (D-87), and a fake that hands back
    // "no rows" hides the crossing instead of failing on it.
    execute: async (sql: string) => {
      throw new Error(`search ran raw SQL across a module boundary: ${sql}`);
    },
    getConnection: () => ({
      execute: async (sql: string) => {
        throw new Error(`search ran raw SQL across a module boundary: ${sql}`);
      },
    }),
  } as unknown as EntityManager;
}

/**
 * A port that must not be consulted on the path under test. It answers with a
 * throw rather than an empty result: "nobody asked" and "the owner had nothing"
 * are different facts, and a stub that renders the first as the second is the
 * fixture-substitution shape `check:fixture-substitution` refuses.
 */
function notReached<T>(name: string): T {
  return new Proxy({} as object, {
    get: (_target, property) => () => {
      throw new Error(`search reached ${name}.${String(property)} on a path that must not`);
    },
  }) as T;
}

const attributeRead = {
  listAll: async () => [],
  listByFlag: async () => [],
  getByIdOrKey: async () => null,
  optionLabelIndex: async () => new Map(),
} as unknown as CatalogAttributeReadPort;

describe('search — the catalog and organizations reads go through ports', () => {
  it('resolves a product for the incremental index upsert from catalogProductReadPort', async () => {
    const asked: string[] = [];
    const products = {
      findById: async (id: string) => {
        asked.push(id);
        return null;
      },
      findByIds: async () => [],
      listValueOverridesByProductIds: async () => [],
    } as unknown as CatalogProductReadPort;

    const indexer = new SearchIndexer({
      attributeRead,
      products,
      // Neither is reached: the product read answers "no such product" and
      // `upsertProduct` returns before it asks anyone else anything.
      categories: notReached('catalogCategoryReadPort'),
      channelMembership: notReached('salesChannelMembershipPort'),
    });
    // The port answers "no such product", so the method returns before it
    // reaches Meilisearch — which is exactly the reach this case needs, since
    // the read under test happens first.
    const touched = await indexer.upsertProduct(refusingEm(), 'p1');

    expect(touched).toEqual([]);
    expect(asked).toEqual(['p1']);
  });

  it('prices a suggestion from the product and organisation rows the owners hand over', async () => {
    const askedProductIds: string[][] = [];
    const askedOrgIds: string[] = [];
    const products = {
      findByIds: async (ids: readonly string[]) => {
        askedProductIds.push([...ids]);
        return ids.map((id) => productRecord(id));
      },
    } as unknown as CatalogProductReadPort;
    const organizations = {
      findById: async (id: string) => {
        askedOrgIds.push(id);
        return organizationRecord(id, 'group-1');
      },
    } as unknown as OrganizationDetailsPort;

    const seen: Array<{ productId: string; organizationId: string | null }> = [];
    const pricingService: SuggestionPriceResolverPort = {
      resolveEngine: async (input) => {
        seen.push({
          productId: input.product.id,
          organizationId: input.context.organization?.id ?? null,
        });
        return {
          base: { bracket: { amount: '12.00' } },
          sale: null,
          displayMode: 'net_only',
          currencyCode: 'PLN',
        };
      },
    };

    const enrich = createSuggestionPricingEnricher({
      catalogProducts: products,
      organizations,
      pricingService,
    });

    const items = [{ id: 'p1' }, { id: 'p2' }] as unknown as ProductSummary[];
    const out = await enrich(items, {
      organizationId: 'org-1',
      resolvedChannel: { id: 'ch-1', defaultCurrency: 'PLN' },
    } as never);

    expect(askedProductIds).toEqual([['p1', 'p2']]);
    expect(askedOrgIds).toEqual(['org-1']);
    expect(seen).toEqual([
      { productId: 'p1', organizationId: 'org-1' },
      { productId: 'p2', organizationId: 'org-1' },
    ]);
    expect(out.map((i) => i.basePrice)).toEqual([
      { amount: '12.00', currency: 'PLN' },
      { amount: '12.00', currency: 'PLN' },
    ]);
  });

  it('asks nobody for an organisation when the suggestion is anonymous', async () => {
    const askedOrgIds: string[] = [];
    const products = {
      findByIds: async (ids: readonly string[]) => ids.map((id) => productRecord(id)),
    } as unknown as CatalogProductReadPort;
    const organizations = {
      findById: async (id: string) => {
        askedOrgIds.push(id);
        return null;
      },
    } as unknown as OrganizationDetailsPort;

    const enrich = createSuggestionPricingEnricher({
      catalogProducts: products,
      organizations,
      pricingService: {
        resolveEngine: async () => ({
          base: { bracket: null },
          sale: null,
          displayMode: 'net_only',
          currencyCode: 'PLN',
        }),
      },
    });

    const out = await enrich([{ id: 'p1' }] as unknown as ProductSummary[], {
      organizationId: null,
      resolvedChannel: { id: 'ch-1', defaultCurrency: 'PLN' },
    } as never);

    expect(askedOrgIds).toEqual([]);
    expect(out[0]?.basePrice).toBeNull();
  });
});
