import { describe, expect, it } from 'vitest';
// This test constructs the service itself, over a stubbed `EntityManager`, and
// its stub compares the class it is handed by **identity**. So the entity has
// to be the copy the service under test holds — the package's own source, the
// same specifier the service is imported from below — and not the one off the
// published `entities` array, which is a second class with the same name
// (D-160.6.1). Nothing here composes the platform, so there is only one copy in
// this process and `check:singleton-identity`'s conjunct 1 is false.
import { PriceDisplayModeOverride } from '../../../../packages/modules/price_lists/src/backend/entities/price-display-mode-override.entity.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryAssignmentRecord,
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
} from '@endora-commerce/contracts';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import type { PriceListTargetReads } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';

/**
 * Feature 075 / D-87 — `price_lists` reads `catalog`'s `product_categories`
 * bridge through `catalogCategoryReadPort`, never in its own SQL.
 *
 * Four statements crossed the boundary: the single-product and the batched
 * membership read on each of the two services. SQL names no import specifier,
 * so `tsc` compiled every one of them and the rows came back whatever state
 * `catalog` was in — which is exactly the reach `check:module-boundary`'s
 * second predicate exists to see and this module's ledger shard recorded.
 *
 * Two properties, and both matter for a module that decides what a customer
 * pays. The **boundary** one: no statement this module issues may name
 * `product_categories`. The **shape** one: the batched paths make one port call
 * for the whole set, because a page turning into one round trip per card is a
 * regression the ledger drain must not smuggle in.
 */

interface OverrideRow {
  scope: 'product' | 'category' | 'organization';
  targetId: string;
  mode: string;
}

interface FakeEmHandle {
  em: () => EntityManager;
  /** Every statement the services issued through `em.execute`. */
  statements: string[];
}

/**
 * An `EntityManager` that answers this module's own reads and records every
 * raw statement. `execute` answers no rows rather than throwing, so a lingering
 * `product_categories` statement fails on the boundary assertion — naming the
 * SQL it found — instead of on an unrelated stack.
 */
function fakeEm(overrides: readonly OverrideRow[]): FakeEmHandle {
  const statements: string[] = [];
  const em = {
    find: async (entity: unknown, where: Record<string, unknown>): Promise<unknown[]> => {
      if (entity === PriceDisplayModeOverride) {
        return overrides.filter((row) => row.scope === where.scope);
      }
      return [];
    },
    findOne: async (entity: unknown, where: Record<string, unknown>): Promise<unknown> => {
      if (entity === PriceDisplayModeOverride) {
        return (
          overrides.find((row) => row.scope === where.scope && row.targetId === where.targetId) ??
          null
        );
      }
      return null;
    },
    execute: async (sql: string): Promise<unknown[]> => {
      statements.push(sql);
      return [];
    },
  } as unknown as EntityManager;
  return { em: () => em, statements };
}

interface CategoryPortSpy {
  reads: string[][];
  targetReads: PriceListTargetReads;
}

/**
 * `catalog`'s category read port, narrowed to what these paths call, plus the
 * record of every `listAssignmentsForProducts` argument — which is how the
 * batched paths are held to one call for the set.
 */
function categoryPortSpy(assignments: ReadonlyMap<string, readonly string[]>): CategoryPortSpy {
  const reads: string[][] = [];
  const port = {
    listAssignmentsForProducts: async (
      productIds: readonly string[],
    ): Promise<CatalogCategoryAssignmentRecord[]> => {
      reads.push([...productIds]);
      const out: CatalogCategoryAssignmentRecord[] = [];
      for (const productId of productIds) {
        for (const categoryId of assignments.get(productId) ?? []) {
          out.push({ productId, categoryId, slug: `slug-${categoryId}` });
        }
      }
      return out;
    },
    ancestorsOf: async (categoryId: string): Promise<CatalogCategoryRecord[]> =>
      [{ id: categoryId, sortOrder: 1 } as CatalogCategoryRecord],
  } as unknown as CatalogCategoryReadPort;
  return {
    reads,
    targetReads: { catalogCategoryRead: port } as unknown as PriceListTargetReads,
  };
}

const CHANNEL = { id: 'channel-1', defaultCurrency: 'PLN' };

const namesTheBridge = (statements: readonly string[]): string[] =>
  statements.filter((sql) => sql.includes('product_categories'));

describe('price_lists reads category memberships through catalog’s port [unit]', () => {
  it('resolveDisplayMode takes the product’s categories from the port', async () => {
    const { em, statements } = fakeEm([{ scope: 'category', targetId: 'cat-1', mode: 'net_only' }]);
    const spy = categoryPortSpy(new Map([['prod-1', ['cat-1']]]));
    const service = new PriceListService(em, undefined, undefined, undefined, spy.targetReads);

    const mode = await service.resolveDisplayMode({
      productId: 'prod-1',
      organizationId: null,
      salesChannelId: CHANNEL.id,
      customerKind: 'guest',
    });

    expect(namesTheBridge(statements)).toEqual([]);
    expect(spy.reads).toEqual([['prod-1']]);
    // The port's answer is what carried the category override into the chain.
    expect(mode).toBe('net_only');
  });

  it('resolveDisplayModes asks the port once for the whole page', async () => {
    const { em, statements } = fakeEm([{ scope: 'category', targetId: 'cat-1', mode: 'both' }]);
    const spy = categoryPortSpy(
      new Map([
        ['prod-1', ['cat-1']],
        ['prod-2', ['cat-1']],
        ['prod-3', []],
      ]),
    );
    const service = new PriceListService(em, undefined, undefined, undefined, spy.targetReads);

    const modes = await service.resolveDisplayModes({
      productIds: ['prod-1', 'prod-2', 'prod-3'],
      organizationId: null,
      salesChannelId: CHANNEL.id,
      customerKind: 'guest',
    });

    expect(namesTheBridge(statements)).toEqual([]);
    expect(spy.reads).toEqual([['prod-1', 'prod-2', 'prod-3']]);
    expect(modes.get('prod-1')).toBe('both');
    expect(modes.get('prod-2')).toBe('both');
    // No membership, so no category override applies and the chain falls
    // through to the settings tier.
    expect(modes.get('prod-3')).toBe('gross_only');
  });

  it('resolveEngine takes the resolution context’s categories from the port', async () => {
    const { em, statements } = fakeEm([]);
    const spy = categoryPortSpy(new Map([['prod-1', ['cat-1', 'cat-2']]]));
    const service = new PricingService(em, undefined, undefined, spy.targetReads);

    await service.resolveEngine({
      product: { id: 'prod-1', attributeValues: {} },
      context: { quantity: 1, salesChannel: CHANNEL },
    });

    expect(namesTheBridge(statements)).toEqual([]);
    expect(spy.reads.length).toBeGreaterThan(0);
    for (const read of spy.reads) expect(read).toEqual(['prod-1']);
  });

  it('resolveListingPrices asks the port once for a whole page of products', async () => {
    const { em, statements } = fakeEm([]);
    const spy = categoryPortSpy(
      new Map([
        ['prod-1', ['cat-1']],
        ['prod-2', ['cat-2']],
        ['prod-3', []],
      ]),
    );
    const service = new PricingService(em, undefined, undefined, spy.targetReads);

    await service.resolveListingPrices({
      products: [
        { id: 'prod-1', attributeValues: {} },
        { id: 'prod-2', attributeValues: {} },
        { id: 'prod-3', attributeValues: {} },
      ],
      context: { salesChannel: CHANNEL },
    });

    expect(namesTheBridge(statements)).toEqual([]);
    // The page's memberships are read once and handed to `resolveDisplayModes`,
    // so the drain must not turn one round trip into one per card.
    expect(spy.reads).toEqual([['prod-1', 'prod-2', 'prod-3']]);
  });
});
