import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';


/**
 * T010 — Seed reconciler idempotency for the Dictionary module
 * (feature 017 / R6).
 *
 * Boot N — populates the registry on a fresh install.
 * Boot N+1 — second run is a no-op for every row.
 * Boot N+2 (after operator edit) — operator edits are preserved.
 */
describe('dictionary SeedReconciler idempotency', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterEach(async () => {
    // Clean up extra rows the test might have inserted, but keep the
    // baseline so other tests in the file still see a populated DB.
    const conn = db.orm.em.getConnection();
    await conn.execute(`delete from "language_countries" where "country_code" = 'AA'`);
    await conn.execute(`delete from "countries" where "code" = 'AA'`);
  });

  afterAll(async () => {
    await db.close();
  });

  it('first run inserts the seed catalogue; second run is a no-op', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    
    // Wipe any seed state from prior tests so the first call is "fresh".
    const conn = db.orm.em.getConnection();
    await conn.execute(`delete from "dictionary_translations"`);
    await conn.execute(`delete from "language_countries"`);
    await conn.execute(`delete from "countries"`);
    // Currencies created by migration 012 (PLN, EUR) are kept; the
    // reconciler should NOT delete them — it only inserts missing ones.

    const first = await runDictionarySeedReconcilerFor(emFactory as never);
    expect(first.countriesInserted).toBeGreaterThan(0);
    expect(first.currenciesInserted).toBeGreaterThanOrEqual(0); // PLN/EUR already exist
    expect(first.translationsInserted).toBeGreaterThan(0);
    expect(first.languageCountriesInserted).toBeGreaterThan(0);

    const second = await runDictionarySeedReconcilerFor(emFactory as never);
    expect(second.countriesInserted).toBe(0);
    expect(second.currenciesInserted).toBe(0);
    expect(second.translationsInserted).toBe(0);
    expect(second.languageCountriesInserted).toBe(0);
  });

  it('preserves operator edits to seeded country labels', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    
    // First boot — seeds the catalogue.
    await runDictionarySeedReconcilerFor(emFactory as never);

    // Operator edits the label of `PL` and the dial code of `DE`.
    const conn = db.orm.em.getConnection();
    await conn.execute(
      `update "countries" set "label" = 'Rzeczpospolita Polska' where "code" = 'PL'`,
    );
    await conn.execute(`update "countries" set "dial_code" = '+9999' where "code" = 'DE'`);

    // Re-run the reconciler — operator edits must remain intact.
    await runDictionarySeedReconcilerFor(emFactory as never);

    const rows = await conn.execute<Array<{ code: string; label: string; dial_code: string }>>(
      `select "code","label","dial_code" from "countries" where "code" in ('PL','DE')`,
    );
    const pl = rows.find((r) => r.code === 'PL');
    const de = rows.find((r) => r.code === 'DE');
    expect(pl?.label).toBe('Rzeczpospolita Polska');
    expect(de?.dial_code).toBe('+9999');
  });

  it('never updates an existing currency row (operator edits sticky by construction)', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    
    // Seed once, then operator edits JPY arbitrarily.
    await runDictionarySeedReconcilerFor(emFactory as never);
    const conn = db.orm.em.getConnection();
    await conn.execute(
      `update "currencies"
         set "decimal_places" = 4, "symbol_position" = 'suffix', "label" = 'YEN-edited'
       where "code" = 'JPY'`,
    );

    // Re-running the reconciler must NOT touch existing rows. The
    // contract is: only insert missing rows; never update existing ones.
    await runDictionarySeedReconcilerFor(emFactory as never);
    const rows = await conn.execute<
      Array<{ decimal_places: number; symbol_position: string; label: string }>
    >(
      `select "decimal_places","symbol_position","label" from "currencies" where "code" = 'JPY'`,
    );
    expect(rows[0]?.decimal_places).toBe(4);
    expect(rows[0]?.symbol_position).toBe('suffix');
    expect(rows[0]?.label).toBe('YEN-edited');
  });

  it('skips translation rows whose parent entry is missing (polymorphic FK at the service layer)', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    
    // Insert a country without translation, then add a translation row
    // for a non-seeded code — the reconciler must NOT create translations
    // for codes it doesn't own.
    const conn = db.orm.em.getConnection();
    await conn.execute(
      `insert into "countries" ("code","alpha3_code","numeric_code","label","region","created_at","updated_at")
       values ('AA','AAA','901','Atlantis Test','Europe',now(),now())
       on conflict do nothing`,
    );

    const before = await conn.execute<Array<{ count: string }>>(
      `select count(*)::text as count from "dictionary_translations" where "entry_code" = 'AA'`,
    );
    await runDictionarySeedReconcilerFor(emFactory as never);
    const after = await conn.execute<Array<{ count: string }>>(
      `select count(*)::text as count from "dictionary_translations" where "entry_code" = 'AA'`,
    );
    expect(after[0]?.count).toBe(before[0]?.count);
  });

  it('honours the partial-unique-default invariant by leaving PL as the only default', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    
    await runDictionarySeedReconcilerFor(emFactory as never);

    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ code: string }>>(
      `select "code" from "countries" where "is_default" = true`,
    );
    expect(rows.map((r) => r.code)).toEqual(['PL']);
  });

  it('seeds en-US primary associations for the English-speaking subset', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    
    await runDictionarySeedReconcilerFor(emFactory as never);
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ country_code: string }>>(
      `select "country_code" from "language_countries"
       where "language_code" = 'en-US' and "is_primary" = true
       order by "country_code"`,
    );
    expect(rows.map((r) => r.country_code).sort()).toEqual(
      ['AU', 'CA', 'GB', 'IE', 'NZ', 'US'].sort(),
    );
  });
});
