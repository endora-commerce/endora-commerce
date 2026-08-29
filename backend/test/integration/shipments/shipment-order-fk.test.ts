import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Migration20260817T194652ShipmentsOrderFk } from '../../../../packages/modules/shipments/src/migrations/20260817T194652_shipments_order_fk.js';

/**
 * `shipments_order_fk` (D-90).
 *
 * `receive-shipment-handler.ts` moves the shipment row and the order status in
 * one `em.transactional`, and D-78 point 2 rules such a seam permanent only
 * when a declared foreign key holds it — which is why the identical `payments`
 * seam is settled and this one was not. The constraint is what makes the
 * classification honest, so it is asserted here rather than assumed: the column
 * carried an index and nothing else from 2026-06-11 until this migration.
 */
describe('shipments.order_id foreign key (D-90)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const insertShipment = (em: EntityManager, orderId: string): Promise<unknown> =>
    em.getConnection().execute(
      `insert into "shipments"
         ("id", "order_id", "delivery_method_id", "status", "attempt_no", "created_at", "updated_at")
       values (?, ?, ?, 'pending', 1, now(), now())`,
      [randomUUID(), orderId, randomUUID()],
    );

  it('declares shipments_order_fk into orders with on delete restrict', async () => {
    const rows = (await h.em().getConnection().execute(
      `select con."conname", con."confdeltype", ref."relname" as "referenced"
         from "pg_constraint" con
         join "pg_class" ref on ref."oid" = con."confrelid"
        where con."conrelid" = '"shipments"'::regclass
          and con."contype" = 'f'`,
    )) as Array<{ conname: string; confdeltype: string; referenced: string }>;

    expect(rows).toContainEqual(
      expect.objectContaining({
        conname: 'shipments_order_fk',
        confdeltype: 'r',
        referenced: 'orders',
      }),
    );
  });

  it('refuses a shipment row pointing at no order', async () => {
    await expect(insertShipment(h.em(), randomUUID())).rejects.toMatchObject({ code: '23503' });
  });

  /**
   * The migration answers an orphaned `order_id` with a sentence, not with a
   * bare Postgres constraint error: the table has been accepting unconstrained
   * `order_id`s for two months, so an operator whose data has orphans needs to
   * read what to do about them.
   *
   * The whole thing runs inside one transaction that is rolled back, so the
   * constraint the first case asserts is restored whatever happens here.
   */
  it('the migration reports orphaned order_ids instead of failing bare', async () => {
    const em = h.em();
    const conn = em.getConnection();
    const migration = new Migration20260817T194652ShipmentsOrderFk(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    const queries = migration.getQueries() as string[];
    const orphanId = randomUUID();

    await expect(
      conn.transactional(async (trx) => {
        await conn.execute(`alter table "shipments" drop constraint "shipments_order_fk"`, [], 'run', trx);
        await conn.execute(
          `insert into "shipments"
             ("id", "order_id", "delivery_method_id", "status", "attempt_no", "created_at", "updated_at")
           values (?, ?, ?, 'pending', 1, now(), now())`,
          [randomUUID(), orphanId, randomUUID()],
          'run',
          trx,
        );
        for (const sql of queries) {
          await conn.execute(sql, [], 'run', trx);
        }
      }),
    ).rejects.toThrow(/orphaned shipments\.order_id/i);
  });
});
