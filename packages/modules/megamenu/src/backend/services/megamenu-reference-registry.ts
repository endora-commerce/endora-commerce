// In-process registry of references between Megamenu items and the
// upstream entities they target. Consulted by:
//
//   * the catalog category-delete endpoint (Category → MegamenuItem)
//   * the cms page + block delete endpoints (CmsPage / CmsBlock → MegamenuItem)
//   * the AssetReferenceRegistry (Asset → MegamenuItem)
//
// All scans are GIN-index-served by `idx_megamenu_items_target_refs`
// (jsonb_path_ops) so scale is sub-millisecond at the platform's low-
// hundreds item count.

import type { EntityManager } from '@mikro-orm/postgresql';

export interface MegamenuItemReference {
  menuId: string;
  itemId: string;
  menuName: string;
  /** Distinguishes assetId vs iconAssetId hits in the asset scan. */
  via?: 'assetId' | 'iconAssetId';
}

export class MegamenuReferenceRegistry {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findCategoryReferences(categoryId: string): Promise<MegamenuItemReference[]> {
    return this.findByKindAndPath('category-link', 'categoryId', categoryId);
  }

  async findCmsPageReferences(pageId: string): Promise<MegamenuItemReference[]> {
    return this.findByKindAndPath('cms-page-link', 'pageId', pageId);
  }

  async findCmsBlockReferences(blockId: string): Promise<MegamenuItemReference[]> {
    return this.findByKindAndPath('cms-block-embed', 'blockId', blockId);
  }

  /**
   * Asset references — both `target.assetId` (asset items) and
   * `target.iconAssetId` (link items with an icon) count. Returns one
   * row per item; a single item that matches both scanners is rare in
   * practice but the SQL deduplicates regardless.
   */
  async findAssetReferences(assetIds: string[]): Promise<MegamenuItemReference[]> {
    if (assetIds.length === 0) return [];
    const placeholders = assetIds.map(() => '?').join(', ');
    const rows = (await this.emFactory().execute(
      `select mi.id::text     as item_id,
              m.id::text      as menu_id,
              m.name          as menu_name,
              case
                when mi.target->>'assetId'     in (${placeholders}) then 'assetId'
                when mi.target->>'iconAssetId' in (${placeholders}) then 'iconAssetId'
                else null
              end             as via
         from megamenu_items mi
         join megamenus m on m.id = mi.megamenu_id
        where mi.target->>'assetId'     in (${placeholders})
           or mi.target->>'iconAssetId' in (${placeholders})`,
      [...assetIds, ...assetIds, ...assetIds, ...assetIds],
    )) as Array<{ item_id: string; menu_id: string; menu_name: string; via: 'assetId' | 'iconAssetId' }>;
    return rows.map((row) => ({
      itemId: row.item_id,
      menuId: row.menu_id,
      menuName: row.menu_name,
      via: row.via,
    }));
  }

  private async findByKindAndPath(
    kind: string,
    targetField: string,
    value: string,
  ): Promise<MegamenuItemReference[]> {
    const rows = (await this.emFactory().execute(
      `select mi.id::text as item_id,
              m.id::text  as menu_id,
              m.name      as menu_name
         from megamenu_items mi
         join megamenus m on m.id = mi.megamenu_id
        where mi.kind = ?
          and mi.target->>'${targetField}' = ?`,
      [kind, value],
    )) as Array<{ item_id: string; menu_id: string; menu_name: string }>;
    return rows.map((row) => ({
      itemId: row.item_id,
      menuId: row.menu_id,
      menuName: row.menu_name,
    }));
  }
}
