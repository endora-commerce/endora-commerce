import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20261117T033143OrganizationsCustomerGroupColumn } from '@endora-commerce/mod-organizations/migrations';
import { Migration20260426T075235PriceListsPricingInit } from '@endora-commerce/mod-price-lists/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #611 — `organizations.customer_group_id` and its index are created by
 * `organizations`, whose `Organization.customerGroupId` maps the column, and no
 * longer by `price_lists`' frozen pricing init.
 *
 * The template has already run every migration, so the first assertion is the
 * fresh-database path. Re-running the class's `up` against that schema is the
 * path of a database that applied the frozen init before the move. `down` then
 * `up` proves the class alone removes and builds both. Everything runs in one
 * transaction the test rolls back.
 */
describe('organizations customer_group_column migration (issue #611)', () => {
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

  const EXPECTED = { column: [{ data_type: 'uuid', is_nullable: 'YES', column_default: null }], index: 1 };

  async function queriesOf(migration: Migration, direction: 'up' | 'down'): Promise<string[]> {
    await migration[direction]();
    return migration.getQueries().map((q) => String(q));
  }

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261117T033143OrganizationsCustomerGroupColumn(em.getDriver(), em.config);
    for (const sql of await queriesOf(migration, direction)) await em.execute(sql);
  }

  async function schema(): Promise<{ column: unknown[]; index: number }> {
    const column = await em.execute(
      `select data_type, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'organizations' and column_name = 'customer_group_id'`,
    );
    const index = (await em.execute(
      `select count(*)::int as n from pg_indexes
       where schemaname = 'public' and tablename = 'organizations'
         and indexname = 'organizations_customer_group_id_index'`,
    )) as Array<{ n: number }>;
    return { column, index: index[0]!.n };
  }

  it('gives organizations a nullable customer_group_id and its index', async () => {
    expect(await schema()).toEqual(EXPECTED);
  });

  it('leaves a database that applied the frozen price_lists init as it is', async () => {
    await run('up');
    expect(await schema()).toEqual(EXPECTED);
  });

  it('removes both on down and builds them on its own', async () => {
    await run('down');
    expect(await schema()).toEqual({ column: [], index: 0 });
    await run('up');
    expect(await schema()).toEqual(EXPECTED);
  });

  it('is no longer created by price_lists, whose frozen init names no organizations table', async () => {
    for (const direction of ['up', 'down'] as const) {
      const frozen = new Migration20260426T075235PriceListsPricingInit(em.getDriver(), em.config);
      const queries = await queriesOf(frozen, direction);
      expect(queries.filter((sql) => /"organizations"/.test(sql)), direction).toEqual([]);
    }
  });
});
