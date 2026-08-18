import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Migration20260818T081251PromotionsPromotionUsageOrderFk } from '../../../src/modules/promotions/migrations/20260818T081251_promotions_promotion_usage_order_fk.js';

/**
 * `promotion_usages_order_fk` (D-94.1, site 3 of the co-transactional family).
 *
 * `finalizeUsage(tx, …)` runs on the placement `EntityManager` so a usage cap
 * hit at the last moment rolls the order back with it (SC-005). The constraint
 * is what makes that seam declarable under D-78 point 2; `promotion_usages` was
 * created with a unique constraint, two indexes and no foreign key on any
 * column at all.
 */
describe('promotion_usages.order_id foreign key (D-94.1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const insertUsage = (em: EntityManager, orderId: string): Promise<unknown> =>
    em.getConnection().execute(
      `insert into "promotion_usages"
         ("id", "promotion_id", "order_id", "sales_channel_id", "discount_amount", "currency", "created_at")
       values (?, ?, ?, ?, '1.00', 'PLN', now())`,
      [randomUUID(), randomUUID(), orderId, randomUUID()],
    );

  it('declares promotion_usages_order_fk into orders with on delete restrict', async () => {
    const rows = (await h.em().getConnection().execute(
      `select con."conname", con."confdeltype", ref."relname" as "referenced"
         from "pg_constraint" con
         join "pg_class" ref on ref."oid" = con."confrelid"
        where con."conrelid" = '"promotion_usages"'::regclass
          and con."contype" = 'f'`,
    )) as Array<{ conname: string; confdeltype: string; referenced: string }>;

    expect(rows).toContainEqual(
      expect.objectContaining({
        conname: 'promotion_usages_order_fk',
        confdeltype: 'r',
        referenced: 'orders',
      }),
    );
  });

  it('refuses a redemption row pointing at no order', async () => {
    await expect(insertUsage(h.em(), randomUUID())).rejects.toMatchObject({ code: '23503' });
  });

  /**
   * The migration names the orphans and says what to do with them — including
   * the deliberate decision that `promotion_usage_counters` is left
   * over-counting, which retires a coupon early rather than letting it be
   * redeemed past its cap (D-94.2, remedy 2).
   *
   * Rolled back whatever happens, so the constraint above survives this case.
   */
  it('the migration reports orphaned order_ids instead of failing bare', async () => {
    const em = h.em();
    const conn = em.getConnection();
    const migration = new Migration20260818T081251PromotionsPromotionUsageOrderFk(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    const queries = migration.getQueries() as string[];

    await expect(
      conn.transactional(async (trx) => {
        await conn.execute(
          `alter table "promotion_usages" drop constraint "promotion_usages_order_fk"`,
          [],
          'run',
          trx,
        );
        await conn.execute(
          `insert into "promotion_usages"
             ("id", "promotion_id", "order_id", "sales_channel_id", "discount_amount", "currency", "created_at")
           values (?, ?, ?, ?, '1.00', 'PLN', now())`,
          [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
          'run',
          trx,
        );
        for (const sql of queries) {
          await conn.execute(sql, [], 'run', trx);
        }
      }),
    ).rejects.toThrow(/orphaned promotion_usages\.order_id[\s\S]*over-counting on purpose/i);
  });
});
