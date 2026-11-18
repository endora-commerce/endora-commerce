// Blog → AssetReferenceRegistry descriptor — feature 016 / T018.
//
// Registers two reference edges with the Library Asset reference registry
// so the Library's soft-delete path (feature 013 / FR-030) blocks deletion
// of any asset still pointed at by:
//
//   - blog_categories.main_image_asset_id    (column-level reference)
//   - blog_posts.main_image_asset_id         (column-level reference, feature 163)
//   - jsonb references inside blog_posts.content or
//     blog_categories.description (Page Builder asset embeds)
//
// The jsonb edge walks each Page Builder document once and matches the string
// values under its `*assetId` keys against the whole batch of asked ids
// (feature 166, R-6; issue #1359).

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReferenceDescriptor,
  AssetReferenceHit,
  AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';

export function registerBlogAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register(blogMainImageReferenceDescriptor(emFactory));
  registry.register(blogContentTreeReferenceDescriptor(emFactory));
}

function blogMainImageReferenceDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'blog',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const placeholders = assetIds.map(() => '?').join(', ');
      const rows = (await em.execute(
        `select id::text as id, slug, 'blog_category' as kind, main_image_asset_id::text as asset_id
           from blog_categories
          where main_image_asset_id in (${placeholders})
            and deleted_at is null
         union all
         select id::text as id, slug, 'blog_post' as kind, main_image_asset_id::text as asset_id
           from blog_posts
          where main_image_asset_id in (${placeholders})
            and deleted_at is null`,
        [...assetIds, ...assetIds],
      )) as Array<{ id: string; slug: string; kind: string; asset_id: string }>;
      return rows.map((r) =>
        r.kind === 'blog_post'
          ? {
              assetId: r.asset_id,
              kind: 'blog_post_main_image',
              entityId: r.id,
              label: `Blog post "${r.slug}"`,
            }
          : {
              assetId: r.asset_id,
              kind: 'blog_category_main_image',
              entityId: r.id,
              label: `Blog category "${r.slug}"`,
            },
      );
    },
  };
}

/**
 * A reference is a string value under a key ending in `assetId`
 * (case-insensitive) — the rule every renderer reads embeds by
 * (`walkAssetIds`), and the one the save's own check reads (issue #544). An id
 * under any other key is never rendered, so it is no reference: it neither
 * blocks deleting the file nor lists a hidden file for every reader (issue
 * #1359). It used to be any string equal to the id.
 *
 * One statement for the whole batch (`specs/166-asset-reference-visibility/`
 * research R-6): every object of each document (`strict $.**` visits every
 * level, array elements included) is walked once and its `*assetId` entries
 * are matched against the asked ids, so a document is walked once however many
 * ids are asked, and the matched value is the asset id each hit is tagged
 * with. The ids travel as one `text[]` literal built from hex-and-dash
 * characters only — `em.execute` formats a JavaScript array as a list, not as
 * one array value. The jsonpath filter's `?` is written `\\?`: `em.execute`
 * reads a bare `?` as a placeholder.
 */
function blogContentTreeReferenceDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'blog',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      const ids = [
        ...new Set(assetIds.map((raw) => raw.replace(/[^0-9a-fA-F-]/g, '')).filter((id) => id !== '')),
      ];
      if (ids.length === 0) return [];
      const rows = (await emFactory().execute(
        `with asked as (select unnest(?::text[]) as aid)
         select distinct p.id::text as id, p.slug, 'blog_post' as kind, e.value as asset_id
           from blog_posts p
           cross join lateral jsonb_path_query(p.content, 'strict $.** \\? (@.type() == "object")') as o(node)
           cross join lateral jsonb_each_text(o.node) as e(key, value)
          where p.deleted_at is null
            and e.key ~* 'assetid$'
            and e.value in (select aid from asked)
         union all
         select distinct c.id::text as id, c.slug, 'blog_category' as kind, e.value as asset_id
           from blog_categories c
           cross join lateral jsonb_path_query(c.description, 'strict $.** \\? (@.type() == "object")') as o(node)
           cross join lateral jsonb_each_text(o.node) as e(key, value)
          where c.deleted_at is null
            and c.description is not null
            and e.key ~* 'assetid$'
            and e.value in (select aid from asked)`,
        [`{${ids.map((id) => `"${id}"`).join(',')}}`],
      )) as Array<{ id: string; slug: string; kind: string; asset_id: string }>;

      return rows.map((r) => ({
        assetId: r.asset_id,
        kind: r.kind === 'blog_post' ? 'blog_post_content' : 'blog_category_description',
        entityId: r.id,
        label: r.kind === 'blog_post' ? `Blog post "${r.slug}"` : `Blog category description "${r.slug}"`,
      }));
    },
  };
}
