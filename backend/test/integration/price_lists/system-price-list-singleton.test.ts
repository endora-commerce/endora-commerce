import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PriceList } from '../../../src/modules/price_lists/entities/price-list.entity.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import {
  SINGLE_SYSTEM_PRICE_LIST_SQL,
  SYSTEM_PRICE_LIST_INDEX,
} from '../../../src/modules/price_lists/migrations/20260817T055457_price_lists_single_system_price_list.js';

/**
 * Issue #50 — exactly one system price list, and the database says so.
 *
 * `is_system` marks the terminal fallback of the resolution chain, and the
 * issue-#132 ruling made that row load-bearing for every catalogue listing.
 * The singleton was a convention until now: the service layer protects the
 * seeded `Default` row from deletion and from losing its rule, but nothing
 * stopped a second row being *created* with the flag — and a feed test fixture
 * did exactly that, which is how the guard in `default-seed-and-migration`
 * started failing.
 *
 * `price_lists` is `@RuleScoped()` and carries no tenant column (organisation
 * targeting lives inside `application_rule`), so the constraint is
 * platform-wide by construction: one `is_system` row in the table.
 */
describe('price_lists — at most one system price list (#50)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    // The shared test DB truncates `price_lists` between server-backed test
    // files; re-seed Default so this file always starts from the one system row.
    await new DefaultPriceListMigrator(() => db.em()).seedDefault();
  });

  function ordinaryList(code: string, isSystem: boolean): PriceList {
    return db.em().create(PriceList, {
      code,
      name: `List ${code}`,
      currency: 'PLN',
      type: 'base',
      status: 'active',
      applicationRule: { kind: 'all' },
      isSystem,
      modifiedAt: new Date(),
    });
  }

  it('refuses a second row carrying the system flag', async () => {
    try {
      const em = db.em();
      const before = await em.find(PriceList, { isSystem: true });
      expect(before.map((row) => row.id)).toEqual([DEFAULT_PRICE_LIST_ID]);

      em.persist(ordinaryList('second_system', true));
      await expect(em.flush()).rejects.toThrow(/price_lists_is_system_unique/);
    } finally {
      await db.rollbackTx();
    }
  });

  it('leaves ordinary lists alone — the index is partial, not a unique boolean', async () => {
    try {
      const em = db.em();
      em.persist(ordinaryList('ordinary_one', false));
      em.persist(ordinaryList('ordinary_two', false));
      await expect(em.flush()).resolves.toBeUndefined();

      const system = await em.find(PriceList, { isSystem: true });
      expect(system).toHaveLength(1);
    } finally {
      await db.rollbackTx();
    }
  });

  it('lets another list take the flag once the current holder gives it up', async () => {
    try {
      const em = db.em();
      const current = await em.findOneOrFail(PriceList, { id: DEFAULT_PRICE_LIST_ID });
      // Released first, in its own write: the index is not deferrable, so the
      // handover is two statements and not a swap inside one flush.
      current.isSystem = false;
      await em.flush();

      em.persist(ordinaryList('successor_system', true));
      await expect(em.flush()).resolves.toBeUndefined();

      const system = await em.find(PriceList, { isSystem: true });
      expect(system).toHaveLength(1);
      expect(system[0]!.code).toBe('successor_system');
    } finally {
      await db.rollbackTx();
    }
  });

  /**
   * The half of the migration a freshly created test database never exercises:
   * it is already clean, so `create unique index` is all that runs. A deployment
   * that drifted is the case that matters, and the demotion has to keep the
   * seeded `Default` row rather than whichever row Postgres happens to return.
   */
  it('demotes the extra system rows an already-drifted database carries, keeping Default', async () => {
    try {
      const em = db.em();
      const conn = em.getConnection();
      // Every statement below names the test's own transaction context: on any
      // other connection the `drop index` would queue behind this transaction's
      // lock on `price_lists` and simply hang.
      const tx = em.getTransactionContext();
      const write = async (sql: string): Promise<void> => {
        await conn.execute(sql, [], 'run', tx);
      };
      const read = async (sql: string): Promise<Array<{ id: string }>> =>
        conn.execute<Array<{ id: string }>>(sql, [], 'all', tx);

      // Re-create the drift the constraint now forbids: drop the index, then
      // add two more system rows — one older than Default, one newer.
      await write(`drop index "${SYSTEM_PRICE_LIST_INDEX}";`);
      await write(
        `insert into price_lists (id, code, name, currency, is_default, priority, type, status,
                                  application_rule, is_system, modified_at, created_at, updated_at)
         values ('11111111-0000-4000-8000-000000000001', 'drifted_old', 'Drifted old', 'PLN',
                 false, 0, 'base', 'active', '{"kind":"all"}'::jsonb, true,
                 now(), now() - interval '10 years', now()),
                ('11111111-0000-4000-8000-000000000002', 'drifted_new', 'Drifted new', 'PLN',
                 false, 0, 'base', 'active', '{"kind":"all"}'::jsonb, true,
                 now(), now(), now());`,
      );

      for (const statement of SINGLE_SYSTEM_PRICE_LIST_SQL) await write(statement);

      const survivors = await read(`select id from price_lists where is_system = true`);
      expect(survivors.map((row) => row.id)).toEqual([DEFAULT_PRICE_LIST_ID]);
      // Demotion clears a flag; it removes no list.
      const kept = await read(
        `select id from price_lists where code in ('drifted_old', 'drifted_new')`,
      );
      expect(kept).toHaveLength(2);
    } finally {
      await db.rollbackTx();
    }
  });
});
