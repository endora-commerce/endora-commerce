import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20261114T003519LanguagesDictionaryColumns } from '@endora-commerce/mod-languages/migrations';
import { Migration20260506T112634DictionariesDictionaryInit } from '@endora-commerce/mod-dictionaries/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #611 — `languages.native_label`, `is_rtl`, `fallback_code` and the
 * `languages_fallback_fk` self-reference are created by `languages`, whose
 * `Language` entity maps them, and no longer by `dictionaries`' frozen init.
 *
 * The template has already run every migration, so the first assertion is the
 * fresh-database path. Re-running the class's `up` against that schema is the
 * path of a database that applied the frozen init before the move. `down` then
 * `up` proves the class alone removes and builds all four. Everything runs in
 * one transaction the test rolls back.
 */
describe('languages dictionary_columns migration (issue #611)', () => {
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

  const EXPECTED = {
    columns: [
      { column_name: 'fallback_code', data_type: 'character varying', character_maximum_length: 12, is_nullable: 'YES', column_default: null },
      { column_name: 'is_rtl', data_type: 'boolean', character_maximum_length: null, is_nullable: 'NO', column_default: 'false' },
      { column_name: 'native_label', data_type: 'character varying', character_maximum_length: 64, is_nullable: 'NO', column_default: "''::character varying" },
    ],
    fk: 'FOREIGN KEY (fallback_code) REFERENCES languages(code) ON DELETE SET NULL',
  };

  async function queriesOf(migration: Migration, direction: 'up' | 'down'): Promise<string[]> {
    await migration[direction]();
    return migration.getQueries().map((q) => String(q));
  }

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261114T003519LanguagesDictionaryColumns(em.getDriver(), em.config);
    for (const sql of await queriesOf(migration, direction)) await em.execute(sql);
  }

  async function schema(): Promise<{ columns: unknown[]; fk: string | undefined }> {
    const columns = await em.execute(
      `select column_name, data_type, character_maximum_length, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'languages'
         and column_name in ('native_label', 'is_rtl', 'fallback_code')
       order by column_name`,
    );
    const fk = (await em.execute(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'languages' and c.conname = 'languages_fallback_fk'`,
    )) as Array<{ def: string }>;
    return { columns, fk: fk[0]?.def };
  }

  it('gives languages the three columns and the fallback self-reference', async () => {
    expect(await schema()).toEqual(EXPECTED);
  });

  it('leaves a database that applied the frozen dictionaries init as it is', async () => {
    await run('up');
    expect(await schema()).toEqual(EXPECTED);
  });

  it('removes all four on down and builds them on its own', async () => {
    await run('down');
    expect(await schema()).toEqual({ columns: [], fk: undefined });
    await run('up');
    expect(await schema()).toEqual(EXPECTED);
  });

  it('is no longer created by dictionaries, whose frozen init alters no languages table', async () => {
    for (const direction of ['up', 'down'] as const) {
      const frozen = new Migration20260506T112634DictionariesDictionaryInit(em.getDriver(), em.config);
      const queries = await queriesOf(frozen, direction);
      expect(queries.filter((sql) => /alter table "languages"/.test(sql)), direction).toEqual([]);
    }
  });
});
