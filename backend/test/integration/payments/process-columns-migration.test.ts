import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20261114T001851PaymentsProcessColumns } from '@endora-commerce/mod-payments/migrations';
import { Migration20260611T140353PaymentMethodsAdapter } from '@endora-commerce/mod-payment-methods/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #611 — `payments.provider_details`, `failure_reason` and `attempt_no`
 * are created by `payments`, whose `Payment` entity maps them, and no longer
 * by `payment_methods`' frozen adapter migration.
 *
 * The template has already run every migration, so the first assertion is the
 * fresh-database path. Re-running the class's `up` against that schema is the
 * path of a database that applied the frozen migration before the move.
 * Dropping the columns first proves the class alone builds them. Everything
 * runs in one transaction the test rolls back.
 */
describe('payments process_columns migration (issue #611)', () => {
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
    { column_name: 'attempt_no', data_type: 'integer', is_nullable: 'NO', column_default: '1' },
    { column_name: 'failure_reason', data_type: 'text', is_nullable: 'YES', column_default: null },
    { column_name: 'provider_details', data_type: 'jsonb', is_nullable: 'YES', column_default: null },
  ];

  async function queriesOf(migration: Migration, direction: 'up' | 'down'): Promise<string[]> {
    await migration[direction]();
    return migration.getQueries().map((q) => String(q));
  }

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261114T001851PaymentsProcessColumns(em.getDriver(), em.config);
    for (const sql of await queriesOf(migration, direction)) await em.execute(sql);
  }

  async function columns(): Promise<unknown[]> {
    return em.execute(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'payments'
         and column_name in ('provider_details', 'failure_reason', 'attempt_no')
       order by column_name`,
    );
  }

  it('gives payments the three payment-process columns', async () => {
    expect(await columns()).toEqual(EXPECTED);
  });

  it('leaves a database that applied the frozen payment_methods migration as it is', async () => {
    await run('up');
    expect(await columns()).toEqual(EXPECTED);
  });

  it('builds the three on its own', async () => {
    await em.execute(
      'alter table "payments" drop column "provider_details", drop column "failure_reason", drop column "attempt_no"',
    );
    expect(await columns()).toEqual([]);
    await run('up');
    expect(await columns()).toEqual(EXPECTED);
  });

  it('keeps them on down, because the payments rows outlive the module', async () => {
    await run('down');
    expect(await columns()).toEqual(EXPECTED);
  });

  it('is no longer created by payment_methods, whose frozen migration names no payments table', async () => {
    for (const direction of ['up', 'down'] as const) {
      const frozen = new Migration20260611T140353PaymentMethodsAdapter(em.getDriver(), em.config);
      const queries = await queriesOf(frozen, direction);
      expect(queries.filter((sql) => /"payments"/.test(sql)), direction).toEqual([]);
    }
  });
});
