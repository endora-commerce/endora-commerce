// Megamenu → AssetReferenceRegistry descriptor — feature 015 / T015.
//
// Scans `megamenu_items.target` for both `assetId` (asset items) and
// `iconAssetId` (link items with an icon). Both edges block deletion of
// the upstream Library Asset with a 409.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetReference } from '@b2b/contracts';
import type {
  AssetReferenceDescriptor,
  AssetReferenceRegistry,
} from '../../assets_library/services/reference-registry.js';

export function registerMegamenuAssetReferences(
  registry: AssetReferenceRegistry,
  emFactory: () => EntityManager,
): void {
  registry.register(megamenuAssetReferenceDescriptor(emFactory));
}

function megamenuAssetReferenceDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const conn = emFactory().getConnection();
      const placeholders = assetIds.map(() => '?').join(', ');
      const rows = (await conn.execute(
        `select mi.id::text as item_id, m.name as menu_name
           from megamenu_items mi
           join megamenus m on m.id = mi.megamenu_id
          where mi.target->>'assetId'     in (${placeholders})
             or mi.target->>'iconAssetId' in (${placeholders})`,
        [...assetIds, ...assetIds],
      )) as Array<{ item_id: string; menu_name: string }>;
      return rows.map((r) => ({
        kind: 'megamenu_item_target',
        entityId: r.item_id,
        label: `Megamenu "${r.menu_name}"`,
      }));
    },
  };
}
