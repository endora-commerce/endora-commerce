// CMS → Assets Library reference descriptor — feature 013 / US6 / T096.
//
// Registers a single jsonbBodyScan descriptor that consults
// `cms_pages.body` for nodes shaped { type: 'asset_ref', assetId }.
// The GIN index `idx_cms_pages_body_asset_refs` (created in migration
// 034) keeps the probe sub-millisecond at the platform's scale.

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
  registry.register(cmsBodyEmbedDescriptor(emFactory));
}

function cmsBodyEmbedDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const conn = em.getConnection();
      // jsonb_path_exists returns true if any node matches; we run one
      // existence query per asset id — n is small (admin-rare deletes).
      const out: AssetReference[] = [];
      for (const aid of assetIds) {
        // Inline the asset id into the jsonpath literal — it is a UUID
        // (validated upstream by Zod), so injection is not a concern. The
        // alternative `?::text` parameter cast confuses some Postgres
        // parameter-coercion paths under Knex, hence the inline form.
        const safeAid = aid.replace(/[^0-9a-fA-F-]/g, '');
        const rows = (await conn.execute(
          `select id::text as id, title
           from cms_pages
           where jsonb_path_exists(
             body,
             '$.** ? (@.type == "asset_ref" && @.assetId == "${safeAid}")'::jsonpath
           )`,
        )) as Array<{ id: string; title: Record<string, string> | string | null }>;
        for (const r of rows) {
          const title =
            typeof r.title === 'string'
              ? r.title
              : (r.title?.['en-US'] ?? r.title?.['en'] ?? Object.values(r.title ?? {})[0] ?? '(untitled)');
          out.push({
            kind: 'cms_body_embed',
            entityId: r.id,
            label: `CMS page "${title}"`,
          });
        }
      }
      return out;
    },
  };
}
