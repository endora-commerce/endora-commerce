import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20261117T065542CurrenciesTable } from '@endora-commerce/mod-currencies/migrations';
import { Migration20260425T161557LanguagesCurrenciesInit } from '@endora-commerce/mod-languages/migrations';
import { Migration20260506T112634DictionariesDictionaryInit } from '@endora-commerce/mod-dictionaries/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #611 — the `currencies` table, its two indexes, its PLN/EUR seed and
 * the `symbol_position` / `decimal_places` columns with their checks are
 * created by `currencies`, whose `Currency` entity maps them. Until then
 * `languages`' frozen init created the table and inserted the rows, and
 * `dictionaries`' frozen init added the columns.
 *
 * The template has already run every migration from empty, so the first case
 * is the fresh-database path. Re-running the class's `up` against that schema
 * is the path of a database that applied both frozen inits before the move,
 * and it must leave the operator's rows as they are — an edited label stays
 * edited and a deleted currency stays deleted. `down` then `up` proves the
 * class alone builds the table and seeds it. Everything runs in one
 * transaction the test rolls back.
 */
describe('currencies table migration (issue #611)', () => {
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

  const EXPECTED_SCHEMA = {
    columns: [
      { column_name: 'code', data_type: 'character varying', character_maximum_length: 3, is_nullable: 'NO', column_default: null },
      { column_name: 'label', data_type: 'character varying', character_maximum_length: 64, is_nullable: 'NO', column_default: null },
      { column_name: 'symbol', data_type: 'character varying', character_maximum_length: 8, is_nullable: 'NO', column_default: null },
      { column_name: 'is_default', data_type: 'boolean', character_maximum_length: null, is_nullable: 'NO', column_default: 'false' },
      { column_name: 'is_active', data_type: 'boolean', character_maximum_length: null, is_nullable: 'NO', column_default: 'true' },
      { column_name: 'sort_order', data_type: 'integer', character_maximum_length: null, is_nullable: 'NO', column_default: '0' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', character_maximum_length: null, is_nullable: 'NO', column_default: null },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', character_maximum_length: null, is_nullable: 'NO', column_default: null },
      { column_name: 'symbol_position', data_type: 'character varying', character_maximum_length: 8, is_nullable: 'NO', column_default: "'suffix'::character varying" },
      { column_name: 'decimal_places', data_type: 'smallint', character_maximum_length: null, is_nullable: 'NO', column_default: '2' },
    ],
    constraints: [
      { conname: 'currencies_decimal_places_check', def: 'CHECK (((decimal_places >= 0) AND (decimal_places <= 6)))' },
      { conname: 'currencies_pkey', def: 'PRIMARY KEY (code)' },
      {
        conname: 'currencies_symbol_position_check',
        def: "CHECK (((symbol_position)::text = ANY ((ARRAY['prefix'::character varying, 'suffix'::character varying])::text[])))",
      },
    ],
    indexes: [
      { indexname: 'currencies_is_active_index', indexdef: 'CREATE INDEX currencies_is_active_index ON public.currencies USING btree (is_active)' },
      { indexname: 'currencies_pkey', indexdef: 'CREATE UNIQUE INDEX currencies_pkey ON public.currencies USING btree (code)' },
      {
        indexname: 'uniq_currencies_one_default',
        indexdef: 'CREATE UNIQUE INDEX uniq_currencies_one_default ON public.currencies USING btree (is_default) WHERE (is_default = true)',
      },
    ],
  };

  const SEEDED_ROWS = [
    { code: 'PLN', label: 'Polish zloty', symbol: 'zł', is_default: true, is_active: true, sort_order: 0, symbol_position: 'suffix', decimal_places: 2 },
    { code: 'EUR', label: 'Euro', symbol: '€', is_default: false, is_active: true, sort_order: 1, symbol_position: 'suffix', decimal_places: 2 },
  ];

  async function queriesOf(migration: Migration, direction: 'up' | 'down'): Promise<string[]> {
    await migration[direction]();
    return migration.getQueries().map((q) => String(q));
  }

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261117T065542CurrenciesTable(em.getDriver(), em.config);
    for (const sql of await queriesOf(migration, direction)) await em.execute(sql);
  }

  async function tableExists(): Promise<boolean> {
    const rows = (await em.execute(`select to_regclass('public.currencies') is not null as present`)) as Array<{ present: boolean }>;
    return rows[0]?.present === true;
  }

  async function schema(): Promise<typeof EXPECTED_SCHEMA> {
    const columns = await em.execute(
      `select column_name, data_type, character_maximum_length, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'currencies'
       order by ordinal_position`,
    );
    const constraints = await em.execute(
      `select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'currencies' order by c.conname`,
    );
    const indexes = await em.execute(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'currencies' order by indexname`,
    );
    return { columns, constraints, indexes } as typeof EXPECTED_SCHEMA;
  }

  async function rows(): Promise<unknown[]> {
    return em.execute(
      `select code, label, symbol, is_default, is_active, sort_order, symbol_position, decimal_places
       from "currencies" order by sort_order, code`,
    );
  }

  it('gives a fresh database the table, its columns, checks and indexes, and the PLN default', async () => {
    expect(await schema()).toEqual(EXPECTED_SCHEMA);
    expect(await rows()).toEqual(SEEDED_ROWS);
  });

  it('leaves a database that applied the frozen inits as it is, operator edits included', async () => {
    await em.execute(`update "currencies" set "label" = 'Zloty (edited)', "decimal_places" = 3 where "code" = 'PLN'`);
    await em.execute(`delete from "currencies" where "code" = 'EUR'`);
    const before = await rows();

    await run('up');

    expect(await schema()).toEqual(EXPECTED_SCHEMA);
    expect(await rows()).toEqual(before);
    expect(before).toHaveLength(1);
  });

  it('does not re-seed a table the operator emptied', async () => {
    await em.execute(`delete from "currencies" where "code" in ('PLN', 'EUR')`);
    expect(await rows()).toEqual([]);
    await run('up');
    expect(await rows()).toEqual([]);
  });

  it('drops the table on down and builds and seeds it on its own', async () => {
    await run('down');
    expect(await tableExists()).toBe(false);
    await run('up');
    expect(await schema()).toEqual(EXPECTED_SCHEMA);
    expect(await rows()).toEqual(SEEDED_ROWS);
  });

  it('is no longer created or altered by languages or dictionaries, whose frozen inits name no currencies table', async () => {
    for (const Frozen of [Migration20260425T161557LanguagesCurrenciesInit, Migration20260506T112634DictionariesDictionaryInit]) {
      for (const direction of ['up', 'down'] as const) {
        const queries = await queriesOf(new Frozen(em.getDriver(), em.config), direction);
        expect(queries.filter((sql) => /"currencies"/.test(sql)), `${Frozen.name} ${direction}`).toEqual([]);
      }
    }
  });
});
