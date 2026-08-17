import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import type { CatalogCategoryReadPort, CatalogCategoryRecord } from '@b2b/contracts';
import { Category } from '../entities/category.entity.js';

/**
 * The category read model `catalog` publishes (feature 075, Phase P).
 *
 * Fourteen inbound sites read the `Category` entity: the inventory threshold
 * resolver, `price_lists` walking the ancestor chain, `product_feeds` mapping
 * the tree onto an external taxonomy, `seo` rendering a category page.
 *
 * `ancestorsOf` is the one method that is not a transcription of an existing
 * call. `price_lists` walks the parent pointer with a `findOne` per level —
 * a loop whose depth is data, in a module that does not own the table. Moving
 * it here bounds it: the write path forbids a cycle, but a corrupt
 * `parent_id` should degrade into a short answer rather than hang a request.
 */
const MAX_ANCESTOR_DEPTH = 64;

export class CatalogCategoryReadService implements CatalogCategoryReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(
    id: string,
    options?: { liveOnly?: boolean },
  ): Promise<CatalogCategoryRecord | null> {
    const category = await this.emFactory().findOne(Category, {
      id,
      ...liveFilter(options),
    });
    return category ? toCatalogCategoryRecord(category) : null;
  }

  async findByIds(
    ids: readonly string[],
    options?: { liveOnly?: boolean },
  ): Promise<CatalogCategoryRecord[]> {
    if (ids.length === 0) return [];
    const categories = await this.emFactory().find(Category, {
      id: { $in: [...ids] },
      ...liveFilter(options),
    });
    return categories.map(toCatalogCategoryRecord);
  }

  async findBySlug(slug: string): Promise<CatalogCategoryRecord | null> {
    const category = await this.emFactory().findOne(Category, { slug });
    return category ? toCatalogCategoryRecord(category) : null;
  }

  async countByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.emFactory().count(Category, { id: { $in: [...ids] } });
  }

  async listAll(options?: { liveOnly?: boolean }): Promise<CatalogCategoryRecord[]> {
    const categories = await this.emFactory().find(
      Category,
      liveFilter(options) as FilterQuery<Category>,
      { orderBy: { sortOrder: 'asc', slug: 'asc' } },
    );
    return categories.map(toCatalogCategoryRecord);
  }

  async listWithInventoryThresholds(): Promise<CatalogCategoryRecord[]> {
    const categories = await this.emFactory().find(Category, {
      $or: [
        { inventoryThresholdHigh: { $ne: null } },
        { inventoryThresholdMedium: { $ne: null } },
        { inventoryThresholdLow: { $ne: null } },
      ],
    });
    return categories.map(toCatalogCategoryRecord);
  }

  async ancestorsOf(categoryId: string): Promise<CatalogCategoryRecord[]> {
    const em = this.emFactory();
    const chain: CatalogCategoryRecord[] = [];
    const seen = new Set<string>();
    let cursorId: string | null = categoryId;
    while (cursorId !== null && chain.length < MAX_ANCESTOR_DEPTH && !seen.has(cursorId)) {
      seen.add(cursorId);
      const cursor: Category | null = await em.findOne(Category, { id: cursorId });
      if (!cursor) break;
      chain.push(toCatalogCategoryRecord(cursor));
      cursorId = cursor.parentCategoryId ?? null;
    }
    return chain;
  }
}

function liveFilter(options?: { liveOnly?: boolean }): { deletedAt?: null } {
  return options?.liveOnly ? { deletedAt: null } : {};
}

export function toCatalogCategoryRecord(category: Category): CatalogCategoryRecord {
  return {
    id: category.id,
    parentCategoryId: category.parentCategoryId ?? null,
    name: category.name,
    slug: category.slug,
    sortOrder: category.sortOrder,
    metaTitleOverride: category.metaTitleOverride ?? null,
    metaDescriptionOverride: category.metaDescriptionOverride ?? null,
    customFieldValues: category.customFieldValues ?? {},
    isActive: category.isActive,
    inventoryThresholdHigh: category.inventoryThresholdHigh ?? null,
    inventoryThresholdMedium: category.inventoryThresholdMedium ?? null,
    inventoryThresholdLow: category.inventoryThresholdLow ?? null,
    mainImageAssetId: category.mainImageAssetId ?? null,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    deletedAt: category.deletedAt ?? null,
  };
}
