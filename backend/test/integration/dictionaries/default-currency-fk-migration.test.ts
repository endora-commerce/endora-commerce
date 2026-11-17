import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20261117T065601DictionariesDefaultCurrencyFk } from '@endora-commerce/mod-dictionaries/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #611 — `countries_default_currency_fk` is added by an above-watermark
 * `dictionaries` migration rather than by the module's frozen init. Since
 * `currencies` creates its own table in its own block, which runs after the
 * whole frozen prefix, a frozen statement referencing `"currencies"` would
 * fail on a database migrated from empty.
 *
 * The template has run every migration from empty, so the first case is the
 * fresh-database path. Re-running `up` is the path of a database that applied
 * the frozen init with the FK; `down` drops the FK and nothing else.
 */
describe('dictionaries default_currency_fk migration (issue #611)', () => {
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

  const FK = 'FOREIGN KEY (default_currency_code) REFERENCES currencies(code) ON DELETE SET NULL';

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration: Migration = new Migration20261117T065601DictionariesDefaultCurrencyFk(em.getDriver(), em.config);
    await migration[direction]();
    for (const sql of migration.getQueries().map((q) => String(q))) await em.execute(sql);
  }

  async function fk(): Promise<string | undefined> {
    const rows = (await em.execute(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'countries' and c.conname = 'countries_default_currency_fk'`,
    )) as Array<{ def: string }>;
    return rows[0]?.def;
  }

  async function present(table: string): Promise<boolean> {
    const rows = (await em.execute(`select to_regclass(?) is not null as present`, [`public.${table}`])) as Array<{ present: boolean }>;
    return rows[0]?.present === true;
  }

  it('gives a fresh database the countries -> currencies foreign key', async () => {
    expect(await fk()).toBe(FK);
  });

  it('leaves a database that applied the frozen dictionaries init as it is', async () => {
    await run('up');
    expect(await fk()).toBe(FK);
  });

  it('drops only the foreign key on down and adds it again on up', async () => {
    await run('down');
    expect(await fk()).toBeUndefined();
    expect(await present('countries')).toBe(true);
    expect(await present('currencies')).toBe(true);
    await run('up');
    expect(await fk()).toBe(FK);
  });
});
