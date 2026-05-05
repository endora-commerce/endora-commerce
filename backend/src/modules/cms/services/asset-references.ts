// CMS → AssetReferenceRegistry descriptor — feature 014 / R12 / T031.
//
// Replaces the feature-013 cms_pages descriptor. Scans every CMS column
// that can carry asset embeds:
//   - cms_pages.content   (new Page Builder tree)
//   - cms_blocks.content
//   - cms_templates.content
//   - cms_pages.body      (legacy mirror; kept for one release)
//
// Match patterns:
//   1. Generic: any node whose props.<*assetId> equals the requested id.
//      Caught by jsonb_path_exists with a wildcard-key match. Catches
//      Library-aware components like LibraryImage, Button.iconAssetId, etc.
//   2. Pre-013 legacy: { type: 'asset_ref', assetId: '<id>' } (for the
//      legacy cms_pages.body column only).
//
// Asset id is validated upstream by Zod (UUID), so inlining it in the
// jsonpath literal is safe; `?::text` parameter coercion confuses Knex
// under MikroORM in some cases (carried over from feature 013).

import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetReference } from '@b2b/contracts';
import type {
  AssetReferenceDescriptor,
  AssetReferenceRegistry,
} from '../../assets_library/services/reference-registry.js';

export function registerCmsAssetReferences(
  registry: AssetReferenceRegistry,
  emFactory: () => EntityManager,
): void {
  registry.register(cmsAssetReferenceDescriptor(emFactory));
}

function cmsAssetReferenceDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const conn = em.getConnection();
      const out: AssetReference[] = [];
      for (const aidRaw of assetIds) {
        const aid = aidRaw.replace(/[^0-9a-fA-F-]/g, '');
        // The two jsonpath patterns are OR-ed: legacy asset_ref shape
        // (only meaningful for cms_pages.body) and generic key-suffix
        // match for Puck component props that carry an asset id under
        // any *assetId key.
        const legacyPath = `'$.** ? (@.type == "asset_ref" && @.assetId == "${aid}")'::jsonpath`;
        const genericPath = `'$.** ? (@ == "${aid}")'::jsonpath`;

        const rows = (await conn.execute(
          `select id::text as id, name, 'cms_page' as kind
           from cms_pages
           where jsonb_path_exists(content, ${genericPath})
              or jsonb_path_exists(body, ${legacyPath})
           union all
           select id::text as id, name, 'cms_block' as kind
           from cms_blocks
           where jsonb_path_exists(content, ${genericPath})
           union all
           select id::text as id, name, 'cms_template' as kind
           from cms_templates
           where jsonb_path_exists(content, ${genericPath})`,
        )) as Array<{ id: string; name: string; kind: string }>;

        for (const r of rows) {
          const label =
            r.kind === 'cms_page'
              ? `CMS page "${r.name}"`
              : r.kind === 'cms_block'
                ? `CMS block "${r.name}"`
                : `CMS template "${r.name}"`;
          out.push({ kind: 'cms_body_embed', entityId: r.id, label });
        }
      }
      return out;
    },
  };
}
