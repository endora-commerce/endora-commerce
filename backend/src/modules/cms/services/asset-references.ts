// CMS → AssetReferenceRegistry descriptor — feature 014 / R12 / T031.
//
// Replaces the feature-013 cms_pages descriptor. Scans every CMS column
// that can carry asset embeds:
//   - cms_pages.content
//   - cms_blocks.content
//   - cms_templates.content
//
// Match shape: any node whose `assetId` (or any `*assetId` key under
// `props`) equals the requested id. Caught by jsonb_path_exists with a
// wildcard-key match — handles components like LibraryImage,
// Button.iconAssetId, Card.mainImageAssetId, etc.
//
// Asset id is validated upstream by Zod (UUID), so inlining it in the
// jsonpath literal is safe; `?::text` parameter coercion confuses Knex
// under MikroORM in some cases (carried over from feature 013).

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReference,
  AssetReferenceDescriptor,
  AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';

export function registerCmsAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register(cmsAssetReferenceDescriptor(emFactory));
}

function cmsAssetReferenceDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'cms',
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const out: AssetReference[] = [];
      for (const aidRaw of assetIds) {
        const aid = aidRaw.replace(/[^0-9a-fA-F-]/g, '');
        const path = `'$.** ? (@ == "${aid}")'::jsonpath`;

        const rows = (await em.execute(
          `select id::text as id, name, 'cms_page' as kind
           from cms_pages
           where jsonb_path_exists(content, ${path})
           union all
           select id::text as id, name, 'cms_block' as kind
           from cms_blocks
           where jsonb_path_exists(content, ${path})
           union all
           select id::text as id, name, 'cms_template' as kind
           from cms_templates
           where jsonb_path_exists(content, ${path})`,
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
