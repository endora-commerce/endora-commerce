import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryAssignmentRecord,
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
} from '@b2b/contracts';
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

  /**
   * Feature 075 / D-87 — the `product_categories` bridge, which has no entity
   * class and was therefore joined in raw SQL by whoever needed it. `search`
   * ran this statement three times from inside its indexer.
   *
   * `em.execute` rather than `getConnection().execute`: the two are the same
   * outside a transaction and only the first joins one when the caller has it
   * open (issue #200).
   */
  async listAssignmentsForProducts(
    productIds: readonly string[],
    options?: { activeOnly?: boolean },
  ): Promise<CatalogCategoryAssignmentRecord[]> {
    if (productIds.length === 0) return [];
    const placeholders = productIds.map(() => '?').join(',');
    const activeFilter = options?.activeOnly === true ? ' and c.is_active = true' : '';
    const rows = await this.emFactory().execute<
      Array<{ product_id: string; category_id: string; slug: string }>
    >(
      `select pc.product_id, pc.category_id, c.slug
         from product_categories pc
         join categories c on c.id = pc.category_id
        where pc.product_id in (${placeholders})${activeFilter}`,
      [...productIds],
    );
    return rows.map((row) => ({
      productId: row.product_id,
      categoryId: row.category_id,
      slug: row.slug,
    }));
  }

  /**
   * One recursive query rather than a query per level: a subtree re-projection
   * runs on every category write, and the depth of the tree is data.
   *
   * No `is_active` / `deleted_at` filter anywhere in the walk — see the port's
   * contract. The caller re-projects *because* a category changed, and a
   * deactivation is the change that matters most.
   */
  async listProductIdsInSubtree(categoryId: string): Promise<string[]> {
    const rows = await this.emFactory().execute<Array<{ product_id: string }>>(
      `with recursive subtree as (
           select id from categories where id = ?
            union all
           select c.id from categories c join subtree s on c.parent_category_id = s.id
         )
         select distinct pc.product_id
           from product_categories pc
           join subtree s on s.id = pc.category_id`,
      [categoryId],
    );
    return rows.map((row) => row.product_id);
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
