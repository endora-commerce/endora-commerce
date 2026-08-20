// Megamenu → AssetReferenceRegistry descriptor — feature 015 / T015.
//
// Scans `megamenu_items.target` for both `assetId` (asset items) and
// `iconAssetId` (link items with an icon). Both edges block deletion of
// the upstream Library Asset with a 409.
//
// The registry and the descriptor are named by their `@b2b/contracts` shapes
// since feature 075's Phase C: this file describes what it contributes, and
// `assets_library` decides what enumerating it means — including the policy
// that honours this scanner while `megamenu` is switched off, which is why the
// seam stays an ungated registration rather than becoming a port.

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReference,
  AssetReferenceDescriptor,
  AssetReferenceRegistryPort,
} from '@b2b/contracts';

export function registerMegamenuAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register(megamenuAssetReferenceDescriptor(emFactory));
}

function megamenuAssetReferenceDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'megamenu',
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const placeholders = assetIds.map(() => '?').join(', ');
      const rows = (await em.execute(
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
