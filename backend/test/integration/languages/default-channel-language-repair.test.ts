import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261003T115043LanguagesRepairDefaultChannelLanguage } from '@endora-commerce/mod-languages/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * The repair for sales channels the boot reconciler created with the bare `en`
 * language code, executed rather than described.
 *
 * Until the fix, `DefaultChannelReconciler` inserted the system-default channel
 * with `languages = ["en"]` / `default_language = 'en'`, while the languages
 * dictionary seeds `en-US` and `pl-PL` and nothing else. Every admin PATCH of
 * that channel's languages then answered `409 DICTIONARY_ENTRY_NOT_FOUND`,
 * because the service re-validates each listed code — the unchanged `en`
 * included — against the dictionary. Instances scaffolded before the fix hold
 * that row; this migration is what reaches them on the next `setup` / `upgrade`.
 *
 * The statements come from the migration class, not from a copy of them here,
 * and the rows are written in raw SQL because the point is a row in a state the
 * code can no longer produce. Everything runs inside a transaction that is
 * rolled back, so the template's own default channel is restored afterwards.
 */
describe('languages — repairing a sales channel created with the bare `en` code', () => {
  let db: TestDb;
  let em: EntityManager;

  async function runMigration(): Promise<void> {
    const migration = new Migration20261003T115043LanguagesRepairDefaultChannelLanguage(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    for (const query of migration.getQueries()) {
      await em.execute(query as string);
    }
  }

  async function insertChannel(
    code: string,
    languages: string[],
    defaultLanguage: string,
    version = 1,
  ): Promise<void> {
    await em.execute(
      `insert into "sales_channels"
         ("id","code","name","languages","default_language","currencies","default_currency",
          "active","system_default","version","is_public","status","created_at","updated_at")
       values (gen_random_uuid(), ?, '{"en":"Fixture"}'::jsonb, ?::jsonb, ?, '["EUR"]'::jsonb, 'EUR',
               true, false, ?, false, 'active', now(), now())`,
      [code, JSON.stringify(languages), defaultLanguage, version],
    );
  }

  async function channel(
    code: string,
  ): Promise<{ languages: string[]; default_language: string; version: number }> {
    const rows = (await em.execute(
      'select "languages", "default_language", "version" from "sales_channels" where "code" = ?',
      [code],
    )) as Array<{ languages: string[]; default_language: string; version: number }>;
    expect(rows, `channel ${code} exists`).toHaveLength(1);
    return rows[0]!;
  }

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    em = await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('rewrites the reconciler-created `en` channel to `en-US` and bumps its version', async () => {
    // The system-default channel itself, put in the state a pre-fix instance
    // holds — the case the repair exists for.
    await em.execute(
      `update "sales_channels" set "languages" = '["en"]'::jsonb, "default_language" = 'en',
         "version" = 3 where "system_default" = true`,
    );
    const code = (
      (await em.execute('select "code" from "sales_channels" where "system_default" = true')) as Array<{
        code: string;
      }>
    )[0]!.code;

    await runMigration();

    const repaired = await channel(code);
    expect(repaired.languages).toEqual(['en-US']);
    expect(repaired.default_language).toBe('en-US');
    // An admin form holding version 3 must be refused rather than overwrite the
    // repair, so the optimistic-concurrency token moves with it.
    expect(repaired.version).toBe(4);
  });

  it('repairs a non-default channel of the same shape too', async () => {
    // A reconciler-created channel that was later demoted by `setDefault` keeps
    // the broken language and is just as unwritable.
    await insertChannel('chlang-demoted', ['en'], 'en');

    await runMigration();

    expect(await channel('chlang-demoted')).toMatchObject({
      languages: ['en-US'],
      default_language: 'en-US',
      version: 2,
    });
  });

  it('leaves the channel alone when `en` is a real dictionary language', async () => {
    // An operator who added `en` to the dictionary has made the code valid; the
    // channel is then configured, not broken, and is not the repair's to touch.
    await em.execute(
      `insert into "languages" ("code","label","is_default","is_active","sort_order","created_at","updated_at")
       values ('en', 'English', false, true, 9, now(), now())`,
    );
    await insertChannel('chlang-real-en', ['en'], 'en', 5);

    await runMigration();

    expect(await channel('chlang-real-en')).toMatchObject({
      languages: ['en'],
      default_language: 'en',
      version: 5,
    });
  });

  it('leaves the channel alone when there is no `en-US` to repair it to', async () => {
    await em.execute(`update "languages" set "is_default" = false`);
    await em.execute(`delete from "languages" where "code" = 'en-US'`);
    await insertChannel('chlang-no-target', ['en'], 'en');

    await runMigration();

    expect(await channel('chlang-no-target')).toMatchObject({
      languages: ['en'],
      default_language: 'en',
      version: 1,
    });
  });

  it('touches no channel an operator configured', async () => {
    await insertChannel('chlang-configured', ['pl-PL', 'en-US'], 'pl-PL', 7);
    await insertChannel('chlang-en-us-only', ['en-US'], 'en-US', 2);

    await runMigration();

    expect(await channel('chlang-configured')).toMatchObject({
      languages: ['pl-PL', 'en-US'],
      default_language: 'pl-PL',
      version: 7,
    });
    expect(await channel('chlang-en-us-only')).toMatchObject({
      languages: ['en-US'],
      default_language: 'en-US',
      version: 2,
    });
  });

  it('is idempotent — a second run changes nothing', async () => {
    await insertChannel('chlang-rerun', ['en'], 'en');

    await runMigration();
    const afterFirst = await channel('chlang-rerun');
    await runMigration();

    expect(await channel('chlang-rerun')).toEqual(afterFirst);
  });
});
