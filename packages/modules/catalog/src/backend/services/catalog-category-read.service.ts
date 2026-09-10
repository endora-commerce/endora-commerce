import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryAssignmentRecord,
  CatalogCategoryProductCount,
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
} from '@endora-commerce/contracts';
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

  /**
   * The selection walk — see the port's contract for why it is not a batched
   * {@link listProductIdsInSubtree}. It skips soft-deleted categories and it
   * tolerates a cycle; the structural read above does neither, deliberately.
   *
   * It was `CatalogQueryService.expandCategoryProductIds` until
   * `specs/110-instance-repository/` T118c, reached by both composition roots
   * over the unpublished `catalogQueryPort` name and by nothing else. It is a
   * category read, so it belongs to the category read model; there is one copy.
   */
  async expandCategoryProductIds(
    categoryIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    if (categoryIds.length === 0) return result;
    const em = this.emFactory();

    const requested = [...new Set(categoryIds)];
    // Descendant ids per requested root (BFS, one query per level for the
    // whole batch — the tree is shallow and this keeps the round trips flat).
    const descendants = new Map<string, string[]>();
    for (const id of requested) descendants.set(id, [id]);

    // Visited set per root. Re-parenting is guarded against cycles
    // (`category-admin.service.ts`), but that guard itself is written to
    // tolerate *pre-existing* cycles in the data, so a corrupted
    // `parent_category_id` chain is reachable here. Without this the loop
    // never terminates: it would re-query the same level forever and grow
    // `descendants` without bound.
    const seen = new Map<string, Set<string>>(requested.map((id) => [id, new Set([id])]));

    let frontier = new Map<string, string[]>(requested.map((id) => [id, [id]]));
    while (frontier.size > 0) {
      const parentIds = [...new Set([...frontier.values()].flat())];
      const children = await em.find(Category, {
        parentCategoryId: { $in: parentIds },
        deletedAt: null,
      });
      if (children.length === 0) break;
      const childrenByParent = new Map<string, string[]>();
      for (const child of children) {
        const parent = String(child.parentCategoryId);
        childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), child.id]);
      }
      const next = new Map<string, string[]>();
      for (const [root, level] of frontier) {
        const visited = seen.get(root) ?? new Set<string>();
        const nextLevel = level
          .flatMap((id) => childrenByParent.get(id) ?? [])
          .filter((id) => !visited.has(id));
        if (nextLevel.length === 0) continue;
        for (const id of nextLevel) visited.add(id);
        seen.set(root, visited);
        descendants.set(root, [...(descendants.get(root) ?? []), ...nextLevel]);
        next.set(root, nextLevel);
      }
      frontier = next;
    }

    const allIds = [...new Set([...descendants.values()].flat())];
    const rows = await em.execute<{ category_id: string; product_id: string }[]>(
      `select category_id, product_id from product_categories
        where category_id in (${allIds.map(() => '?').join(',')})`,
      allIds,
    );
    const productsByCategory = new Map<string, string[]>();
    for (const row of rows) {
      productsByCategory.set(row.category_id, [
        ...(productsByCategory.get(row.category_id) ?? []),
        row.product_id,
      ]);
    }
    for (const id of requested) {
      const set = new Set<string>();
      for (const categoryId of descendants.get(id) ?? []) {
        for (const productId of productsByCategory.get(categoryId) ?? []) set.add(productId);
      }
      result.set(id, set);
    }
    return result;
  }

  /**
   * The one category, not its subtree — see the port's contract for why the two
   * are separate methods. `pim_ergonode` wrote this statement itself before the
   * port had it, to detach the products of a category the source tree dropped.
   */
  async listProductIdsInCategory(categoryId: string): Promise<string[]> {
    const rows = await this.emFactory().execute<Array<{ product_id: string }>>(
      'select distinct pc.product_id from product_categories pc where pc.category_id = ?',
      [categoryId],
    );
    return rows.map((row) => row.product_id);
  }

  /**
   * One grouped query rather than a count per id: the caller renders a source
   * hierarchy of a few hundred bound categories on one screen, so a count per
   * row would be a few hundred round trips every time it loads.
   */
  async countLiveProductsByCategory(
    categoryIds: readonly string[],
  ): Promise<CatalogCategoryProductCount[]> {
    if (categoryIds.length === 0) return [];
    const placeholders = categoryIds.map(() => '?').join(',');
    const rows = await this.emFactory().execute<
      Array<{ category_id: string; product_count: number }>
    >(
      `select pc.category_id, count(*)::int as product_count
         from product_categories pc
         join products p on p.id = pc.product_id and p.deleted_at is null
        where pc.category_id in (${placeholders})
        group by pc.category_id`,
      [...categoryIds],
    );
    return rows.map((row) => ({
      categoryId: row.category_id,
      productCount: Number(row.product_count),
    }));
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
