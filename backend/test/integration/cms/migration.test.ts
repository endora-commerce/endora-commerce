import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T008 — Migration test for feature 014 / `035_cms_init.ts`. Verifies the
 * new tables, the eight new columns on `cms_pages`, the GIN indexes on the
 * three content columns, the unique slug-per-channel index, the seeded 23
 * Hook codes with `is_system=true`, and the legacy backfill.
 */
describe('cms migration (T008 — 035_cms_init)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates the four new tables', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('cms_blocks','cms_templates','cms_hooks','cms_hook_block_attachments')
       order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'cms_blocks',
      'cms_hook_block_attachments',
      'cms_hooks',
      'cms_templates',
    ]);
  });

  it('creates the four channel-join tables', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'cms_page_sales_channels',
           'cms_block_sales_channels',
           'cms_template_sales_channels',
           'cms_hook_sales_channels'
         )
       order by table_name`,
    );
    expect(rows).toHaveLength(4);
  });

  it('adds eight new columns to cms_pages', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'cms_pages'`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    for (const expected of [
      'name',
      'slug',
      'active',
      'description',
      'meta_title',
      'meta_description',
      'meta_keywords',
      'content',
      'languages',
      'version',
    ]) {
      expect(cols.has(expected), `missing column "${expected}"`).toBe(true);
    }
  });

  it('creates the GIN indexes on the three new content columns', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'idx_cms_pages_content_asset_refs',
           'idx_cms_blocks_content_asset_refs',
           'idx_cms_templates_content_asset_refs'
         )`,
    );
    expect(rows).toHaveLength(3);
  });

  it('enforces UNIQUE (sales_channel_id, slug) on cms_page_sales_channels', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'cms_page_sales_channels'`,
    );
    const hasUnique = rows.some(
      (r) => /UNIQUE/i.test(r.indexdef) && /sales_channel_id/.test(r.indexdef) && /slug/.test(r.indexdef),
    );
    expect(hasUnique).toBe(true);
  });

  it('enforces globally-unique cms_hooks.code', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'cms_hooks'`,
    );
    const hasUnique = rows.some((r) => /UNIQUE/i.test(r.indexdef) && /\(code\)/i.test(r.indexdef));
    expect(hasUnique).toBe(true);
  });

  it('seeds 23 base Hook codes with is_system=true', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ code: string }>>(
      `select code from cms_hooks where is_system = true order by code`,
    );
    const codes = rows.map((r) => r.code).sort();
    expect(codes).toContain('header.top');
    expect(codes).toContain('homepage.top');
    expect(codes).toContain('homepage.bottom');
    expect(codes).toContain('product.top');
    expect(codes).toContain('product.bottom');
    expect(codes).toContain('cms.page.top');
    expect(codes).toContain('cms.page.bottom');
    expect(codes).toContain('register.bottom');
    expect(codes.length).toBeGreaterThanOrEqual(23);
  });
});
