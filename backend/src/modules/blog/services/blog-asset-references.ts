// Blog → AssetReferenceRegistry descriptor — feature 016 / T018.
//
// Registers two reference edges with the Library Asset reference registry
// so the Library's soft-delete path (feature 013 / FR-030) blocks deletion
// of any asset still pointed at by:
//
//   - blog_categories.main_image_asset_id    (column-level reference)
//   - jsonb references inside blog_posts.content or
//     blog_categories.description (Page Builder asset embeds)
//
// The jsonb edge uses `jsonb_path_exists` driven by the GIN index
// `idx_blog_posts_content_refs` and the matching index on
// `blog_categories.description` (created via the GIN's content path).

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReference,
  AssetReferenceDescriptor,
  AssetReferenceRegistryPort,
} from '@b2b/contracts';

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
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const conn = emFactory().getConnection();
      const placeholders = assetIds.map(() => '?').join(', ');
      const rows = (await conn.execute(
        `select id::text as id, slug
           from blog_categories
          where main_image_asset_id in (${placeholders})
            and deleted_at is null`,
        [...assetIds],
      )) as Array<{ id: string; slug: string }>;
      return rows.map((r) => ({
        kind: 'blog_category_main_image',
        entityId: r.id,
        label: `Blog category "${r.slug}"`,
      }));
    },
  };
}

function blogContentTreeReferenceDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'blog',
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const conn = emFactory().getConnection();
      const out: AssetReference[] = [];
      for (const aidRaw of assetIds) {
        // The asset id is a UUID; this regex is a defensive pre-filter to
        // keep the literal-injected jsonpath safe (the same idiom feature
        // 014's CMS asset-references uses).
        const aid = aidRaw.replace(/[^0-9a-fA-F-]/g, '');
        const path = `'$.** ? (@ == "${aid}")'::jsonpath`;

        const rows = (await conn.execute(
          `select id::text as id, slug, 'blog_post' as kind
             from blog_posts
            where deleted_at is null
              and jsonb_path_exists(content, ${path})
           union all
           select id::text as id, slug, 'blog_category' as kind
             from blog_categories
            where deleted_at is null
              and description is not null
              and jsonb_path_exists(description, ${path})`,
        )) as Array<{ id: string; slug: string; kind: string }>;

        for (const r of rows) {
          const label =
            r.kind === 'blog_post'
              ? `Blog post "${r.slug}"`
              : `Blog category description "${r.slug}"`;
          out.push({
            kind:
              r.kind === 'blog_post'
                ? 'blog_post_content'
                : 'blog_category_description',
            entityId: r.id,
            label,
          });
        }
      }
      return out;
    },
  };
}
