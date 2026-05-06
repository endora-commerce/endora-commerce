import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T005 — Migration test for feature 016 / `037_blog_init.ts`. Verifies the
 * eleven new tables, the per-channel partial-unique slug indexes on the
 * scope rows for posts + categories, the GIN index on `blog_posts.content`,
 * the partial unique on `blog_tags.code`, and the supporting btree indexes
 * per `data-model.md` § Migration `037_blog_init.ts`.
 */
describe('blog migration (T005 — 037_blog_init)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates every blog_* table', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name like 'blog_%'
       order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'blog_categories',
      'blog_category_languages',
      'blog_category_sales_channels',
      'blog_post_categories',
      'blog_post_languages',
      'blog_post_related_posts',
      'blog_post_related_products',
      'blog_post_sales_channels',
      'blog_post_tags',
      'blog_posts',
      'blog_tags',
    ]);
  });

  it('places the expected columns on blog_posts including content/status/published_at', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'blog_posts'`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    for (const expected of [
      'id',
      'name',
      'slug',
      'active',
      'status',
      'published_at',
      'description',
      'meta_title',
      'meta_description',
      'meta_keywords',
      'content',
      'version',
      'created_at',
      'updated_at',
      'deleted_at',
    ]) {
      expect(cols.has(expected), `missing column "${expected}" on blog_posts`).toBe(true);
    }
  });

  it('places the expected columns on blog_categories including is_system + main_image_asset_id', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'blog_categories'`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    for (const expected of [
      'id',
      'parent_id',
      'position',
      'name',
      'slug',
      'enabled',
      'description',
      'main_image_asset_id',
      'meta_title',
      'meta_description',
      'meta_keywords',
      'is_system',
      'version',
      'created_at',
      'updated_at',
      'deleted_at',
    ]) {
      expect(cols.has(expected), `missing column "${expected}" on blog_categories`).toBe(true);
    }
  });

  it('creates the GIN index on blog_posts.content for asset-reference scanning', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string; indexdef: string }>>(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'blog_posts'`,
    );
    const gin = rows.find((r) => r.indexname === 'idx_blog_posts_content_refs');
    expect(gin, 'idx_blog_posts_content_refs missing').toBeDefined();
    expect(/USING gin/i.test(gin!.indexdef)).toBe(true);
  });

  it('creates the (status, published_at desc) newest-first index on blog_posts', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'blog_posts'`,
    );
    expect(rows.map((r) => r.indexname)).toContain('idx_blog_posts_status_published_at');
  });

  it('creates the per-(channel, slug) partial unique on blog_post_sales_channels', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'blog_post_sales_channels'`,
    );
    const partial = rows.some(
      (r) =>
        /UNIQUE/i.test(r.indexdef) &&
        /sales_channel_id/.test(r.indexdef) &&
        /slug/.test(r.indexdef) &&
        /WHERE\s+\(?deleted_at\s+IS\s+NULL\)?/i.test(r.indexdef),
    );
    expect(
      partial,
      'partial unique on (sales_channel_id, slug) WHERE deleted_at IS NULL on blog_post_sales_channels',
    ).toBe(true);
  });

  it('creates the per-(channel, slug) partial unique on blog_category_sales_channels', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'blog_category_sales_channels'`,
    );
    const partial = rows.some(
      (r) =>
        /UNIQUE/i.test(r.indexdef) &&
        /sales_channel_id/.test(r.indexdef) &&
        /slug/.test(r.indexdef) &&
        /WHERE\s+\(?deleted_at\s+IS\s+NULL\)?/i.test(r.indexdef),
    );
    expect(
      partial,
      'partial unique on (sales_channel_id, slug) WHERE deleted_at IS NULL on blog_category_sales_channels',
    ).toBe(true);
  });

  it('creates the global UNIQUE on blog_tags.code (partial: WHERE deleted_at IS NULL)', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'blog_tags'`,
    );
    const tagUniq = rows.some(
      (r) =>
        /UNIQUE/i.test(r.indexdef) &&
        /\(code\)/.test(r.indexdef) &&
        /WHERE\s+\(?deleted_at\s+IS\s+NULL\)?/i.test(r.indexdef),
    );
    expect(tagUniq, 'partial unique on (code) WHERE deleted_at IS NULL on blog_tags').toBe(true);
  });

  it('creates the (parent_id, position) tree-fetch index on blog_categories', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'blog_categories'`,
    );
    expect(rows.map((r) => r.indexname)).toContain('idx_blog_categories_parent_position');
  });

  it('creates supporting indexes on join tables for storefront listings', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ tablename: string; indexname: string }>>(
      `select tablename, indexname from pg_indexes
       where schemaname = 'public'
         and tablename in ('blog_post_categories','blog_post_tags','blog_post_related_posts')`,
    );
    const byTable = new Map<string, string[]>();
    for (const r of rows) {
      const list = byTable.get(r.tablename) ?? [];
      list.push(r.indexname);
      byTable.set(r.tablename, list);
    }
    expect(byTable.get('blog_post_categories')).toContain('idx_blog_post_categories_category_id');
    expect(byTable.get('blog_post_tags')).toContain('idx_blog_post_tags_tag_id');
    expect(byTable.get('blog_post_related_posts')).toContain(
      'idx_blog_post_related_posts_related',
    );
  });
});
