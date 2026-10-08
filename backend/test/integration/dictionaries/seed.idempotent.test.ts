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
    // A catalogue case below edits `de`. Dropping the edited row is what puts
    // the seeded one back: the next reconciler run finds the code missing.
    await conn.execute(
      `delete from "languages" where "code" = 'de' and "label" = 'Deutsch (operator)'`,
    );
    // And another moves Great Britain's primary language; hand it back, so the
    // next run re-links `en-US` as the primary the other cases expect.
    await conn.execute(
      `update "language_countries" set "is_primary" = false
        where "language_code" = 'en' and "country_code" = 'GB'`,
    );
  });

  afterAll(async () => {
    await runDictionarySeedReconcilerFor((() => db.orm.em) as never);
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

  it('seeds the ISO 639-1 language catalogue once, every row inactive', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    const conn = db.orm.em.getConnection();
    // Remove what an earlier boot seeded, so the first call below is "fresh".
    // Two-letter codes are the catalogue's; `en-US` and `pl-PL` are the init
    // migration's and stay.
    await conn.execute(`delete from "language_countries" where "language_code" ~ '^[a-z]{2}$'`);
    await conn.execute(`delete from "languages" where "code" ~ '^[a-z]{2}$'`);

    const first = await runDictionarySeedReconcilerFor(emFactory as never);
    expect(first.languagesInserted).toBe(183);

    const second = await runDictionarySeedReconcilerFor(emFactory as never);
    expect(second.languagesInserted).toBe(0);
    expect(second.languageCountriesInserted).toBe(0);

    const rows = await conn.execute<
      Array<{ code: string; is_active: boolean; is_default: boolean; native_label: string }>
    >(`select "code","is_active","is_default","native_label" from "languages"`);
    const catalogue = rows.filter((row) => /^[a-z]{2}$/.test(row.code));
    expect(catalogue).toHaveLength(183);
    // The risk this guards: a catalogue row that arrives active becomes a
    // storefront language, a translation column and a feed locale on its own.
    expect(catalogue.filter((row) => row.is_active)).toEqual([]);
    expect(catalogue.filter((row) => row.is_default)).toEqual([]);
    expect(catalogue.find((row) => row.code === 'de')?.native_label).toBe('Deutsch');
    // The two languages the platform shipped with are untouched.
    expect(rows.find((row) => row.code === 'en-US')).toMatchObject({
      is_active: true,
      is_default: true,
    });
    expect(rows.find((row) => row.code === 'pl-PL')?.is_active).toBe(true);
  });

  it('never updates a catalogue language an operator has edited', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    await runDictionarySeedReconcilerFor(emFactory as never);
    const conn = db.orm.em.getConnection();
    await conn.execute(
      `update "languages"
          set "label" = 'Deutsch (operator)', "is_active" = true, "sort_order" = 5
        where "code" = 'de'`,
    );

    const rerun = await runDictionarySeedReconcilerFor(emFactory as never);
    expect(rerun.languagesInserted).toBe(0);

    const rows = await conn.execute<
      Array<{ label: string; is_active: boolean; sort_order: number }>
    >(`select "label","is_active","sort_order" from "languages" where "code" = 'de'`);
    expect(rows[0]).toEqual({ label: 'Deutsch (operator)', is_active: true, sort_order: 5 });
  });

  it('links each catalogue language to the countries the dictionary holds, never as primary', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    await runDictionarySeedReconcilerFor(emFactory as never);
    const conn = db.orm.em.getConnection();

    const german = await conn.execute<Array<{ country_code: string; is_primary: boolean }>>(
      `select "country_code","is_primary" from "language_countries"
        where "language_code" = 'de' order by "country_code"`,
    );
    // `LI` is one of German's countries and is not in the country dictionary:
    // a link is only ever made to a country row that exists.
    expect(german.map((row) => row.country_code)).toEqual(['AT', 'BE', 'CH', 'DE', 'IT', 'LU']);
    expect(german.every((row) => row.is_primary === false)).toBe(true);

    // The shipped primaries keep their flag: `en` joins `en-US` on those
    // countries beside it, not instead of it.
    const english = await conn.execute<
      Array<{ language_code: string; country_code: string; is_primary: boolean }>
    >(
      `select "language_code","country_code","is_primary" from "language_countries"
        where "country_code" = 'GB' and "language_code" in ('en','en-US')
        order by "language_code"`,
    );
    expect(english).toEqual([
      { language_code: 'en', country_code: 'GB', is_primary: false },
      { language_code: 'en-US', country_code: 'GB', is_primary: true },
    ]);
  });

  it('skips a shipped primary link an operator has replaced, instead of failing the boot', async () => {
    const emFactory = (): typeof db.orm.em => db.orm.em;
    await runDictionarySeedReconcilerFor(emFactory as never);
    const conn = db.orm.em.getConnection();
    // What the Languages tab lets an operator do once `en` is on the list:
    // make it Great Britain's primary language, then untick `en-US`.
    await conn.execute(
      `delete from "language_countries" where "language_code" = 'en-US' and "country_code" = 'GB'`,
    );
    await conn.execute(
      `update "language_countries" set "is_primary" = true
        where "language_code" = 'en' and "country_code" = 'GB'`,
    );

    // The shipped link is missing again, and re-inserting it as primary would
    // be a second primary for one country — a unique violation, at boot.
    const rerun = await runDictionarySeedReconcilerFor(emFactory as never);
    expect(rerun.languageCountriesInserted).toBe(0);

    const rows = await conn.execute<Array<{ language_code: string; is_primary: boolean }>>(
      `select "language_code","is_primary" from "language_countries"
        where "country_code" = 'GB' and "language_code" in ('en','en-US')`,
    );
    expect(rows).toEqual([{ language_code: 'en', is_primary: true }]);
  });
});
