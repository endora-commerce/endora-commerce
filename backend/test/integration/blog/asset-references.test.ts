import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { registerBlogAssetReferences } from '../../../../packages/modules/blog/src/backend/services/blog-asset-references.js';
import { AssetReferenceRegistry } from '../../../src/modules/assets_library/services/reference-registry.js';

const ASSET_A = '33333333-3333-3333-3333-333333333333';
const ASSET_B = '44444444-4444-4444-4444-444444444444';

/**
 * Integration test for the blog asset-reference descriptors (T017 / R13).
 * Seeds an asset row, then verifies that a Category referencing it via
 * `main_image_asset_id` and a Post referencing it inside its Page Builder
 * content tree both surface as inbound references.
 */
describe('blog asset references (T017 — registry descriptors)', () => {
  let db: TestDb;
  let registry: AssetReferenceRegistry;

  beforeAll(async () => {
    db = await setupTestDb();
    const conn = db.orm.em.getConnection();
    // Seed two assets at the suite level (outside per-test transactions).
    await conn.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values
         (?, 'image', 'a.png', 'image/png', 1024, 'local:a-key', now(), now()),
         (?, 'image', 'b.png', 'image/png', 1024, 'local:b-key', now(), now())
       on conflict (id) do nothing`,
      [ASSET_A, ASSET_B],
    );
  });

  afterAll(async () => {
    const conn = db.orm.em.getConnection();
    await conn.execute(
      'truncate blog_post_related_products, blog_post_related_posts, blog_post_tags, blog_post_categories, blog_post_languages, blog_post_sales_channels, blog_posts, blog_category_languages, blog_category_sales_channels, blog_categories, blog_tags cascade',
    );
    await conn.execute(`delete from assets where id in (?, ?)`, [ASSET_A, ASSET_B]);
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    // Defensive cleanup — the per-test transaction should provide
    // isolation but raw `getConnection().execute()` writes inside the
    // helper bypass it on some MikroORM/pg-pool combinations. The blog
    // tables are not used by any other suite, so a wholesale wipe here
    // is safe.
    const conn = db.em().getConnection();
    await conn.execute('truncate blog_post_related_products, blog_post_related_posts, blog_post_tags, blog_post_categories, blog_post_languages, blog_post_sales_channels, blog_posts, blog_category_languages, blog_category_sales_channels, blog_categories, blog_tags cascade');
    registry = new AssetReferenceRegistry();
    registerBlogAssetReferences(registry, () => db.em());
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('returns no references for an unused asset', async () => {
    const refs = await registry.findReferences(ASSET_A);
    expect(refs.filter((r) => r.kind.startsWith('blog_'))).toEqual([]);
  });

  it('surfaces a Category whose main_image_asset_id matches', async () => {
    const conn = db.em().getConnection();
    const categoryId = randomUUID();
    await conn.execute(
      `insert into blog_categories (id, slug, name, main_image_asset_id, version, created_at, updated_at)
       values (?, 'guides', '{"en-US":"Guides"}'::jsonb, ?, 1, now(), now())`,
      [categoryId, ASSET_A],
    );
    const refs = await registry.findReferences(ASSET_A);
    const blogRefs = refs.filter((r) => r.kind === 'blog_category_main_image');
    expect(blogRefs).toHaveLength(1);
    expect(blogRefs[0]!.entityId).toBe(categoryId);
    expect(blogRefs[0]!.label).toContain('guides');
  });

  it('surfaces a Post whose content tree contains the asset id', async () => {
    const conn = db.em().getConnection();
    const postId = randomUUID();
    const content = {
      schema_version: 1,
      languages: {
        'en-US': {
          type: 'root',
          children: [
            { type: 'image', props: { assetId: ASSET_B } },
          ],
        },
      },
    };
    await conn.execute(
      `insert into blog_posts (id, slug, name, content, version, created_at, updated_at)
       values (?, 'welcome', '{"en-US":"Welcome"}'::jsonb, ?::jsonb, 1, now(), now())`,
      [postId, JSON.stringify(content)],
    );
    const refs = await registry.findReferences(ASSET_B);
    const blogRefs = refs.filter((r) => r.kind === 'blog_post_content');
    expect(blogRefs).toHaveLength(1);
    expect(blogRefs[0]!.entityId).toBe(postId);
    expect(blogRefs[0]!.label).toContain('welcome');
  });

  it('surfaces a Category description containing the asset id', async () => {
    const conn = db.em().getConnection();
    const categoryId = randomUUID();
    const description = {
      schema_version: 1,
      languages: {
        'en-US': {
          type: 'root',
          children: [
            { type: 'image', props: { assetId: ASSET_A } },
          ],
        },
      },
    };
    await conn.execute(
      `insert into blog_categories (id, slug, name, description, version, created_at, updated_at)
       values (?, 'pictures', '{"en-US":"Pictures"}'::jsonb, ?::jsonb, 1, now(), now())`,
      [categoryId, JSON.stringify(description)],
    );
    const refs = await registry.findReferences(ASSET_A);
    const blogRefs = refs.filter((r) => r.kind === 'blog_category_description');
    expect(blogRefs).toHaveLength(1);
    expect(blogRefs[0]!.entityId).toBe(categoryId);
  });

  it('ignores soft-deleted rows', async () => {
    const conn = db.em().getConnection();
    const categoryId = randomUUID();
    await conn.execute(
      `insert into blog_categories (id, slug, name, main_image_asset_id, version, created_at, updated_at, deleted_at)
       values (?, 'tombstone', '{"en-US":"Tombstone"}'::jsonb, ?, 1, now(), now(), now())`,
      [categoryId, ASSET_A],
    );
    const refs = await registry.findReferences(ASSET_A);
    expect(refs.filter((r) => r.kind === 'blog_category_main_image')).toEqual([]);
  });
});
