// CMS → AssetReferenceRegistry descriptor — feature 014 / R12 / T031.
//
// Replaces the feature-013 cms_pages descriptor. Scans every CMS column
// that can carry asset embeds:
//   - cms_pages.content
//   - cms_blocks.content
//   - cms_templates.content
//   - cms_pages.share_image_asset_id (feature 163, data-model §1.1 — a
//     plain uuid column, not an FK, because assets live in `assets_library`)
//
// Match shape: a string value under a key ending in `assetId`
// (case-insensitive) anywhere in the tree — `LibraryImage.assetId`,
// `Button.iconAssetId`, `Card.mainImageAssetId`, etc. That is the rule every
// renderer reads embeds by (`walkAssetIds`), and the one the save's own check
// reads (issue #544). An id under any other key is never rendered, so it is no
// reference: it neither blocks deleting the file nor lists a hidden file for
// every reader (issue #1359). It used to be any string equal to the id.
//
// One statement for the whole batch (`specs/166-asset-reference-visibility/`
// research R-6): every object of each document (`strict $.**` visits every
// level, array elements included) is walked once and its `*assetId` entries
// are matched against the asked ids, so a document is walked once however
// many ids are asked, and the matched value is the asset id each hit is tagged
// with. The ids travel as one `text[]` literal built from hex-and-dash
// characters only — `em.execute` formats a JavaScript array as a list, not as
// one array value. The jsonpath filter's `?` is written `\\?`: `em.execute`
// reads a bare `?` as a placeholder.

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReferenceDescriptor,
  AssetReferenceHit,
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
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      const ids = [
        ...new Set(assetIds.map((raw) => raw.replace(/[^0-9a-fA-F-]/g, '')).filter((id) => id !== '')),
      ];
      if (ids.length === 0) return [];
      const asked = `{${ids.map((id) => `"${id}"`).join(',')}}`;
      const rows = (await emFactory().execute(
        `with asked as (select unnest(?::text[]) as aid)
         select distinct p.id::text as id, p.name, 'cms_page' as kind, e.value as asset_id
           from cms_pages p
           cross join lateral jsonb_path_query(p.content, 'strict $.** \\? (@.type() == "object")') as o(node)
           cross join lateral jsonb_each_text(o.node) as e(key, value)
          where e.key ~* 'assetid$'
            and e.value in (select aid from asked)
         union all
         select p.id::text as id, p.name, 'cms_page_share_image' as kind, a.aid as asset_id
           from cms_pages p
           join asked a on p.share_image_asset_id::text = lower(a.aid)
         union all
         select distinct b.id::text as id, b.name, 'cms_block' as kind, e.value as asset_id
           from cms_blocks b
           cross join lateral jsonb_path_query(b.content, 'strict $.** \\? (@.type() == "object")') as o(node)
           cross join lateral jsonb_each_text(o.node) as e(key, value)
          where e.key ~* 'assetid$'
            and e.value in (select aid from asked)
         union all
         select distinct t.id::text as id, t.name, 'cms_template' as kind, e.value as asset_id
           from cms_templates t
           cross join lateral jsonb_path_query(t.content, 'strict $.** \\? (@.type() == "object")') as o(node)
           cross join lateral jsonb_each_text(o.node) as e(key, value)
          where e.key ~* 'assetid$'
            and e.value in (select aid from asked)`,
        [asked],
      )) as Array<{ id: string; name: string; kind: string; asset_id: string }>;

      return rows.map((r) => {
        const label =
          r.kind === 'cms_page'
            ? `CMS page "${r.name}"`
            : r.kind === 'cms_page_share_image'
              ? `CMS page "${r.name}" (sharing image)`
              : r.kind === 'cms_block'
              ? `CMS block "${r.name}"`
              : `CMS template "${r.name}"`;
        return { assetId: r.asset_id, kind: 'cms_body_embed', entityId: r.id, label };
      });
    },
  };
}
