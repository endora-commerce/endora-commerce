import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20261114T000706CatalogCategoryMainImage } from '@endora-commerce/mod-catalog/migrations';
import { Migration20260505T102206AssetsLibraryInit } from '@endora-commerce/mod-assets-library/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #611 — `categories.main_image_asset_id`, its foreign key to `assets`
 * and its index are created by `catalog`, whose `Category.mainImageAssetId`
 * maps the column, and no longer by `assets_library`'s frozen init.
 *
 * The template has already run every migration, so the schema assertions are
 * the fresh-database path. Re-running the class's `up` against that schema is
 * the path of a database that applied the frozen init before the move: it has
 * all three already and must be left as it is. Dropping them first proves the
 * class alone builds them. Everything runs in one transaction the test rolls
 * back.
 */
describe('catalog category_main_image migration (issue #611)', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  const FK = 'FOREIGN KEY (main_image_asset_id) REFERENCES assets(id) ON DELETE SET NULL';

  async function queriesOf(migration: Migration, direction: 'up' | 'down'): Promise<string[]> {
    await migration[direction]();
    return migration.getQueries().map((q) => String(q));
  }

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261114T000706CatalogCategoryMainImage(em.getDriver(), em.config);
    for (const sql of await queriesOf(migration, direction)) await em.execute(sql);
  }

  async function schema(): Promise<{ column: number; fk: string | undefined; index: number }> {
    const column = (await em.execute(
      `select count(*)::int as n from information_schema.columns
       where table_schema = 'public' and table_name = 'categories'
         and column_name = 'main_image_asset_id' and data_type = 'uuid' and is_nullable = 'YES'`,
    )) as Array<{ n: number }>;
    const fk = (await em.execute(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'categories' and c.conname = 'categories_main_image_fk'`,
    )) as Array<{ def: string }>;
    const index = (await em.execute(
      `select count(*)::int as n from pg_indexes
       where schemaname = 'public' and tablename = 'categories'
         and indexname = 'categories_main_image_asset_id_index'`,
    )) as Array<{ n: number }>;
    return { column: column[0]!.n, fk: fk[0]?.def, index: index[0]!.n };
  }

  it('gives categories the column, its foreign key to assets and its index', async () => {
    expect(await schema()).toEqual({ column: 1, fk: FK, index: 1 });
  });

  it('leaves a database that applied the frozen assets_library init as it is', async () => {
    await run('up');
    expect(await schema()).toEqual({ column: 1, fk: FK, index: 1 });
  });

  it('builds all three on its own', async () => {
    await em.execute('alter table "categories" drop column "main_image_asset_id"');
    expect(await schema()).toEqual({ column: 0, fk: undefined, index: 0 });
    await run('up');
    expect(await schema()).toEqual({ column: 1, fk: FK, index: 1 });
  });

  it('keeps them on down, because the categories rows outlive the module', async () => {
    await run('down');
    expect(await schema()).toEqual({ column: 1, fk: FK, index: 1 });
  });

  it('is no longer created by assets_library, whose frozen init names no categories table', async () => {
    for (const direction of ['up', 'down'] as const) {
      const frozen = new Migration20260505T102206AssetsLibraryInit(em.getDriver(), em.config);
      const queries = await queriesOf(frozen, direction);
      expect(queries.filter((sql) => /"categories"/.test(sql)), direction).toEqual([]);
    }
  });
});
