import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20261114T002913AdminUsersPreferredLanguage } from '@endora-commerce/mod-admin-users/migrations';
import { Migration20260507T091405I18nAdminI18nInit } from '@endora-commerce/mod-i18n/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #611 — `admin_users.preferred_language` is created by `admin_users`,
 * whose `AdminUser.preferredLanguage` maps it, and no longer by `_i18n`'s
 * frozen admin init.
 *
 * The template has already run every migration, so the first assertion is the
 * fresh-database path. Re-running the class's `up` against that schema is the
 * path of a database that applied the frozen init before the move. `down` then
 * `up` proves the class alone removes and builds the column. Everything runs in
 * one transaction the test rolls back.
 */
describe('admin_users preferred_language migration (issue #611)', () => {
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

  const EXPECTED = [
    { data_type: 'character varying', character_maximum_length: 12, is_nullable: 'YES', column_default: null },
  ];

  async function queriesOf(migration: Migration, direction: 'up' | 'down'): Promise<string[]> {
    await migration[direction]();
    return migration.getQueries().map((q) => String(q));
  }

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261114T002913AdminUsersPreferredLanguage(em.getDriver(), em.config);
    for (const sql of await queriesOf(migration, direction)) await em.execute(sql);
  }

  async function column(): Promise<unknown[]> {
    return em.execute(
      `select data_type, character_maximum_length, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'admin_users' and column_name = 'preferred_language'`,
    );
  }

  it('gives admin_users a nullable preferred_language', async () => {
    expect(await column()).toEqual(EXPECTED);
  });

  it('leaves a database that applied the frozen _i18n init as it is', async () => {
    await run('up');
    expect(await column()).toEqual(EXPECTED);
  });

  it('removes the column on down and builds it on its own', async () => {
    await run('down');
    expect(await column()).toEqual([]);
    await run('up');
    expect(await column()).toEqual(EXPECTED);
  });

  it('is no longer created by _i18n, whose frozen init names no admin_users table', async () => {
    for (const direction of ['up', 'down'] as const) {
      const frozen = new Migration20260507T091405I18nAdminI18nInit(em.getDriver(), em.config);
      const queries = await queriesOf(frozen, direction);
      expect(queries.filter((sql) => /"admin_users"/.test(sql)), direction).toEqual([]);
    }
  });
});
