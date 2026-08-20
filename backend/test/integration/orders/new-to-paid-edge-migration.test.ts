import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Migration20260820T100201OrdersNewToPaidTransition } from '../../../src/modules/orders/migrations/20260820T100201_orders_new_to_paid_transition.js';

/**
 * Feature 085 (Phase A) — the `new -> paid` edge, and the migration that gives
 * it to a graph that already exists.
 *
 * The migration is not driven through `orm.getMigrator()`: it has already run
 * against this database (that is the first assertion), and re-running it is
 * precisely what the migrator will not do. Idempotency is a property of the
 * statements, so the statements are what this file executes — inside the
 * fixture's transaction, through `db.em().execute`, so every row it touches is
 * rolled back and the shared reference table is left as it was found.
 */

/** The statements `up()` emits, as the migrator would run them. */
function upStatements(): string[] {
  const migration = new Migration20260820T100201OrdersNewToPaidTransition(
    // The base class only assigns these; nothing in `up()` reaches the driver.
    undefined as never,
    undefined as never,
  );
  void migration.up();
  return migration.getQueries().map((query) => String(query));
}

interface EdgeRow {
  id: string;
  is_system: boolean;
}

describe('085 Phase A — order_status_transitions gains new -> paid', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(() => db.beginTx());
  afterEach(() => db.rollbackTx());
  afterAll(() => db.close());

  const edgeRows = async (): Promise<EdgeRow[]> =>
    (await db
      .em()
      .execute(
        `select "id", "is_system" from "order_status_transitions" ` +
          `where "from_status_code" = 'new' and "to_status_code" = 'paid'`,
      )) as EdgeRow[];

  const runUp = async (): Promise<void> => {
    for (const sql of upStatements()) await db.em().execute(sql);
  };

  it('has already applied the edge — the migration is registered and ran', async () => {
    expect(await edgeRows()).toHaveLength(1);
  });

  it('is safe to re-run: a second application inserts no duplicate', async () => {
    await runUp();
    await runUp();
    expect(await edgeRows()).toHaveLength(1);
  });

  it('keeps an edge an operator added by hand, exactly as they made it', async () => {
    // Scoped to the one pair this migration owns — never a table-wide wipe.
    await db
      .em()
      .execute(
        `delete from "order_status_transitions" ` +
          `where "from_status_code" = 'new' and "to_status_code" = 'paid'`,
      );
    const handMadeId = randomUUID();
    await db.em().execute(
      `insert into "order_status_transitions" ("id", "from_status_code", "to_status_code", "is_system", "created_at") ` +
        `values (?, 'new', 'paid', true, now())`,
      [handMadeId],
    );

    await runUp();

    const rows = await edgeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(handMadeId);
    // `true` was the operator's choice, not this migration's default of `false`.
    expect(rows[0]?.is_system).toBe(true);
  });

  it('inserts the edge on a graph that does not have it, as a non-system row', async () => {
    await db
      .em()
      .execute(
        `delete from "order_status_transitions" ` +
          `where "from_status_code" = 'new' and "to_status_code" = 'paid'`,
      );
    expect(await edgeRows()).toHaveLength(0);

    await runUp();

    const rows = await edgeRows();
    expect(rows).toHaveLength(1);
    // The explicit defaults are stored `is_system = false`; `true` is reserved
    // for the universal on_hold/cancelled edges the graph service materializes.
    expect(rows[0]?.is_system).toBe(false);
  });
});
