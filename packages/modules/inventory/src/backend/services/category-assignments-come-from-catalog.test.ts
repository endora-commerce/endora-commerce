import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
  CatalogProductReadPort,
  CatalogProductRecord,
} from '@endora-commerce/contracts';
import { StockLevelService } from './stock-level-service.js';

/**
 * Feature 075, the `inventory` shard — the threshold chain asks `catalog` which
 * categories a product is in.
 *
 * It read `product_categories` directly until this test: a `catalog` table with
 * no entity class, joined here in SQL that names no import specifier, on the
 * line above a `catalogCategories.findByIds` call that already asked the owner
 * the *next* question. The port has answered the first half since D-87
 * (`listAssignmentsForProducts`), so nothing had to be published for this — only
 * asked.
 *
 * The fake `EntityManager` refuses any statement naming the table, which is what
 * makes this a test of the boundary rather than of the band arithmetic: an
 * implementation that kept the join fails here even if every band it computes is
 * right.
 */

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';
const CATEGORY = '33333333-3333-4333-8333-333333333333';

function productRecord(id: string): CatalogProductRecord {
  return { id, sku: `sku-${id.slice(0, 4)}`, manageStock: true } as CatalogProductRecord;
}

function categoryRecord(id: string): CatalogCategoryRecord {
  return {
    id,
    slug: 'tools',
    inventoryThresholdHigh: 50,
    inventoryThresholdMedium: 20,
    inventoryThresholdLow: 5,
  } as CatalogCategoryRecord;
}

/**
 * Answers the stock reads this module owns and throws on anything naming
 * another module's table — the assertion, expressed as a collaborator.
 */
function fakeEm(): EntityManager {
  return {
    execute: async (sql: unknown) => {
      const text = typeof sql === 'string' ? sql : '';
      if (/product_categories|\bproducts\b|categories/i.test(text)) {
        throw new Error(`inventory must not query catalog's tables: ${text}`);
      }
      return [];
    },
    find: async () => [],
    findOne: async () => null,
  } as unknown as EntityManager;
}

describe('inventory — category assignments come from the catalog port', () => {
  it('asks `listAssignmentsForProducts` once for the whole batch', async () => {
    const listAssignmentsForProducts = vi.fn(async () => [
      { productId: PRODUCT_A, categoryId: CATEGORY, slug: 'tools' },
      { productId: PRODUCT_B, categoryId: CATEGORY, slug: 'tools' },
    ]);
    const findByIds = vi.fn(async () => [categoryRecord(CATEGORY)]);
    const categories = { listAssignmentsForProducts, findByIds } as unknown as
      CatalogCategoryReadPort;
    const products = {
      findByIds: async () => [productRecord(PRODUCT_A), productRecord(PRODUCT_B)],
    } as unknown as CatalogProductReadPort;

    const service = new StockLevelService(fakeEm, products, categories);
    const bands = await service.resolveAvailabilityBands([PRODUCT_A, PRODUCT_B]);

    expect(listAssignmentsForProducts).toHaveBeenCalledTimes(1);
    expect(listAssignmentsForProducts).toHaveBeenCalledWith([PRODUCT_A, PRODUCT_B]);
    // Both products resolve, both are out of stock — the point is that the
    // categories arrived at all, not what the thresholds said.
    expect(bands.get(PRODUCT_A)?.band).toBe('out_of_stock');
    expect(bands.get(PRODUCT_B)?.band).toBe('out_of_stock');
  });

  it('does not ask for category rows when no product has an assignment', async () => {
    const findByIds = vi.fn(async () => []);
    const categories = {
      listAssignmentsForProducts: async () => [],
      findByIds,
    } as unknown as CatalogCategoryReadPort;
    const products = {
      findByIds: async () => [productRecord(PRODUCT_A)],
    } as unknown as CatalogProductReadPort;

    const service = new StockLevelService(fakeEm, products, categories);
    await service.resolveAvailabilityBands([PRODUCT_A]);

    expect(findByIds).toHaveBeenCalledWith([]);
  });
});
