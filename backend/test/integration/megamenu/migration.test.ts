import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T004 — Migration test for feature 015 / `036_megamenu_init.ts`. Verifies the
 * three new tables, the GIN index on `megamenu_items.target`, the partial
 * unique index on `megamenu_bindings (sales_channel_id, language) WHERE active`,
 * and the supporting btree indexes per `data-model.md` § Migration ordering.
 */
describe('megamenu migration (T004 — 036_megamenu_init)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates the three new tables', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('megamenus','megamenu_items','megamenu_bindings')
       order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'megamenu_bindings',
      'megamenu_items',
      'megamenus',
    ]);
  });

  it('places the expected columns on megamenu_items including target/labels', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'megamenu_items'`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    for (const expected of [
      'id',
      'megamenu_id',
      'parent_id',
      'position',
      'kind',
      'labels',
      'descriptions',
      'target',
      'created_at',
      'updated_at',
    ]) {
      expect(cols.has(expected), `missing column "${expected}"`).toBe(true);
    }
  });

  it('creates the GIN index on megamenu_items.target', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string; indexdef: string }>>(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'megamenu_items'`,
    );
    const gin = rows.find((r) => r.indexname === 'idx_megamenu_items_target_refs');
    expect(gin, 'idx_megamenu_items_target_refs missing').toBeDefined();
    expect(/USING gin/i.test(gin!.indexdef)).toBe(true);
  });

  it('creates the (megamenu_id, parent_id, position) tree-fetch index', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'megamenu_items'`,
    );
    expect(rows.map((r) => r.indexname)).toContain('idx_megamenu_items_tree');
  });

  it('enforces partial unique on (sales_channel_id, language) WHERE active = true', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'megamenu_bindings'`,
    );
    const partial = rows.some((r) =>
      /UNIQUE/i.test(r.indexdef) &&
      /sales_channel_id/.test(r.indexdef) &&
      /language/.test(r.indexdef) &&
      /WHERE\s+\(?active/i.test(r.indexdef),
    );
    expect(partial, 'partial unique index on (sales_channel_id, language) WHERE active=true').toBe(true);
  });

  it('places (sales_channel_id, language) lookup index on megamenu_bindings', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'megamenu_bindings'`,
    );
    expect(rows.map((r) => r.indexname)).toContain('idx_megamenu_bindings_channel_lang');
  });
});
