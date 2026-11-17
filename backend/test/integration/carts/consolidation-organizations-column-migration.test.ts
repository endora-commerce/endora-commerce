import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20260611T140352CartsConsolidation } from '@endora-commerce/mod-carts/migrations';
import { Migration20261104T094535OrganizationsDropLegacyRoleColumns } from '@endora-commerce/mod-organizations/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #611 — `carts`' frozen consolidation no longer adds or drops
 * `organizations.requires_cart_approval`.
 *
 * The column is `organizations`' and is already retired by that module's own
 * `Migration20261104T094535OrganizationsDropLegacyRoleColumns` (M4 of
 * `specs/170-organization-roles/`), whose `down()` re-creates it with the
 * definition the frozen `carts` statement had. So the column's whole remaining
 * lifecycle is the owner's, and a fresh database reaches the same schema
 * without it ever existing. Everything runs in one transaction the test rolls
 * back.
 */
describe('carts consolidation and organizations.requires_cart_approval (issue #611)', () => {
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

  async function queriesOf(migration: Migration, direction: 'up' | 'down'): Promise<string[]> {
    await migration[direction]();
    return migration.getQueries().map((q) => String(q));
  }

  async function column(): Promise<unknown[]> {
    return em.execute(
      `select data_type, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'organizations' and column_name = 'requires_cart_approval'`,
    );
  }

  it('is absent from a freshly migrated database', async () => {
    expect(await column()).toEqual([]);
  });

  it('is re-created by the owner alone, with the frozen definition, on M4 down', async () => {
    const m4 = new Migration20261104T094535OrganizationsDropLegacyRoleColumns(em.getDriver(), em.config);
    for (const sql of await queriesOf(m4, 'down')) await em.execute(sql);
    expect(await column()).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
  });

  it('is no longer written by carts, whose frozen consolidation names no organizations table', async () => {
    for (const direction of ['up', 'down'] as const) {
      const frozen = new Migration20260611T140352CartsConsolidation(em.getDriver(), em.config);
      const queries = await queriesOf(frozen, direction);
      expect(queries.filter((sql) => /"organizations"/.test(sql)), direction).toEqual([]);
    }
  });
});
