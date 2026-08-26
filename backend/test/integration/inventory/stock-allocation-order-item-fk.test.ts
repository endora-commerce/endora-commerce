import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Migration20260818T081243InventoryStockAllocationOrderItemFk } from '@endora-commerce/mod-inventory/migrations';

/**
 * `stock_allocations_order_item_fk` (D-94.1, site 1 of the co-transactional
 * family D-90 opened).
 *
 * `placeOrder` locks `stock_levels`, increments `reserved` and writes these
 * rows on its own `EntityManager`, and D-78 point 2 rules such a seam
 * permanent only when a declared foreign key holds it — which is why the
 * `payments` seam was settled and this one was escalated for months. The
 * constraint is what makes the classification honest, so it is asserted here
 * rather than assumed: the same `create table` constrained `warehouse_id` and
 * left this column bare.
 */
describe('stock_allocations.order_item_id foreign key (D-94.1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const insertAllocation = (em: EntityManager, orderItemId: string): Promise<unknown> =>
    em.getConnection().execute(
      `insert into "stock_allocations"
         ("id", "order_item_id", "warehouse_id", "quantity", "is_backorder", "created_at")
       values (?, ?, ?, 1, false, now())`,
      [randomUUID(), orderItemId, '00000000-0000-4000-8000-00000000d017'],
    );

  it('declares stock_allocations_order_item_fk into order_items with on delete restrict', async () => {
    const rows = (await h.em().getConnection().execute(
      `select con."conname", con."confdeltype", ref."relname" as "referenced"
         from "pg_constraint" con
         join "pg_class" ref on ref."oid" = con."confrelid"
        where con."conrelid" = '"stock_allocations"'::regclass
          and con."contype" = 'f'`,
    )) as Array<{ conname: string; confdeltype: string; referenced: string }>;

    expect(rows).toContainEqual(
      expect.objectContaining({
        conname: 'stock_allocations_order_item_fk',
        confdeltype: 'r',
        referenced: 'order_items',
      }),
    );
  });

  it('refuses an allocation row pointing at no order item', async () => {
    await expect(insertAllocation(h.em(), randomUUID())).rejects.toMatchObject({ code: '23503' });
  });

  /**
   * The migration answers an orphaned `order_item_id` with a sentence naming
   * the reserved units at stake, not with a bare `23503`: the column has been
   * accepting unconstrained values since 2026-05-03, and an operator whose data
   * has orphans is looking at stock reserved for a line that no longer exists
   * and that no code path will ever release.
   *
   * The whole thing runs inside one transaction that is rolled back, so the
   * constraint the first case asserts is restored whatever happens here.
   */
  it('the migration reports orphaned order_item_ids instead of failing bare', async () => {
    const em = h.em();
    const conn = em.getConnection();
    const migration = new Migration20260818T081243InventoryStockAllocationOrderItemFk(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    const queries = migration.getQueries() as string[];

    await expect(
      conn.transactional(async (trx) => {
        await conn.execute(
          `alter table "stock_allocations" drop constraint "stock_allocations_order_item_fk"`,
          [],
          'run',
          trx,
        );
        await conn.execute(
          `insert into "stock_allocations"
             ("id", "order_item_id", "warehouse_id", "quantity", "is_backorder", "created_at")
           values (?, ?, ?, 3, false, now())`,
          [randomUUID(), randomUUID(), '00000000-0000-4000-8000-00000000d017'],
          'run',
          trx,
        );
        for (const sql of queries) {
          await conn.execute(sql, [], 'run', trx);
        }
      }),
    ).rejects.toThrow(/orphaned stock_allocations\.order_item_id[\s\S]*3 reserved unit/i);
  });
});
