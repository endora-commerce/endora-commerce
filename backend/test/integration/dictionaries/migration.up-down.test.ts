import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T005 — Migration test for feature 017 / `038_dictionary_init.ts`.
 *
 * Verifies the schema additions described in `data-model.md`:
 *   - new tables: countries, dictionary_translations, language_countries
 *   - ALTER columns on languages (native_label, is_rtl, fallback_code)
 *   - ALTER columns on currencies (symbol_position, decimal_places)
 *   - the partial-unique-default index on countries
 *   - the partial-unique-primary-per-country index on language_countries
 *   - the FK from countries.default_currency_code to currencies(code)
 *   - the CHECK constraints on currencies + countries
 *
 * The reverse-direction (down) migration is exercised end-to-end by the
 * MikroORM `migration:fresh` path in CI; this test focuses on the
 * post-up shape so consumers (services, routes, contract tests) can
 * trust the schema they sit on.
 */
describe('dictionary migration — 038_dictionary_init', () => {
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
         and table_name in ('countries','dictionary_translations','language_countries')
       order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'countries',
      'dictionary_translations',
      'language_countries',
    ]);
  });

  it('extends languages with native_label, is_rtl, fallback_code', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'languages'`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    for (const expected of ['native_label', 'is_rtl', 'fallback_code']) {
      expect(cols.has(expected), `missing column "${expected}"`).toBe(true);
    }
  });

  it('extends currencies with symbol_position, decimal_places', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'currencies'`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    expect(cols.has('symbol_position')).toBe(true);
    expect(cols.has('decimal_places')).toBe(true);
  });

  it('creates partial unique index "uniq_countries_one_default"', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string; indexdef: string }>>(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'countries'`,
    );
    const def = rows.find((r) => r.indexname === 'uniq_countries_one_default')?.indexdef;
    expect(def).toBeDefined();
    expect(def).toMatch(/UNIQUE INDEX/i);
    expect(def).toMatch(/WHERE.*is_default/i);
  });

  it('creates partial unique index "uniq_language_countries_primary_per_country"', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string; indexdef: string }>>(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'language_countries'`,
    );
    const def = rows.find(
      (r) => r.indexname === 'uniq_language_countries_primary_per_country',
    )?.indexdef;
    expect(def).toBeDefined();
    expect(def).toMatch(/WHERE.*is_primary/i);
  });

  it('adds FK countries.default_currency_code → currencies(code)', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<
      Array<{ conname: string; confrelid: string; confdeltype: string }>
    >(
      `select c.conname, t2.relname as confrelid, c.confdeltype
       from pg_constraint c
       join pg_class t1 on c.conrelid = t1.oid
       join pg_class t2 on c.confrelid = t2.oid
       where t1.relname = 'countries' and c.conname = 'countries_default_currency_fk'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.confrelid).toBe('currencies');
    expect(rows[0]?.confdeltype).toBe('n'); // ON DELETE SET NULL
  });

  it('FK dictionary_translations.language_code → languages(code) cascades', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ confdeltype: string }>>(
      `select c.confdeltype from pg_constraint c
       join pg_class t on c.conrelid = t.oid
       where t.relname = 'dictionary_translations' and c.conname = 'dictionary_translations_lang_fk'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.confdeltype).toBe('c'); // ON DELETE CASCADE
  });

  it('enforces region CHECK constraint on countries', async () => {
    const conn = db.orm.em.getConnection();
    await expect(
      conn.execute(
        `insert into countries (code, alpha3_code, numeric_code, label, region, created_at, updated_at)
         values ('ZZ', 'ZZZ', '999', 'Test', 'Atlantis', now(), now())`,
      ),
    ).rejects.toThrow();
  });

  it('enforces decimal_places CHECK on currencies', async () => {
    const conn = db.orm.em.getConnection();
    await expect(
      conn.execute(`update currencies set decimal_places = 7 where code = 'PLN'`),
    ).rejects.toThrow();
  });

  it('enforces symbol_position CHECK on currencies', async () => {
    const conn = db.orm.em.getConnection();
    await expect(
      conn.execute(`update currencies set symbol_position = 'middle' where code = 'PLN'`),
    ).rejects.toThrow();
  });

  it('enforces partial unique-default invariant on countries', async () => {
    // Behavioural verification: with at least one row already
    // `is_default = true` (the seed reconciler sets PL as default at boot
    // — see `seed.idempotent.test.ts`), inserting another default-true
    // row must be refused by the partial unique index.
    const conn = db.orm.em.getConnection();
    await expect(
      conn.execute(
        `insert into countries (code, alpha3_code, numeric_code, label, region, is_default, created_at, updated_at)
         values ('AA', 'AAA', '901', 'Atest', 'Europe', true, now(), now())`,
      ),
    ).rejects.toThrow(/uniq_countries_one_default/);
  });
});
