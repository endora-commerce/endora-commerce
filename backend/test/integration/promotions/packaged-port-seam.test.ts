import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PromotionUsageFinalizer } from '@endora-commerce/mod-promotions/ports';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Promotion } from '../../helpers/package-entities.js';

/**
 * The co-transactional promotion seam, measured **across a package boundary**
 * (feature 080, T040b; D-169, D-171).
 *
 * `promotions` is `@endora-commerce/mod-promotions` now, and
 * `PromotionUsageFinalizer` is on its type-only `./ports` subpath — the second
 * of the two seams D-169 names, `CreditLimitPort` having been the first. The
 * subpath exists because `finalizeUsage` names a MikroORM `EntityManager` and
 * `packages/contracts` is compiled by `admin` and `storefront` and holds none.
 *
 * The type in this file's `import type` is the one the consumer sees. The value
 * is resolved from the composed container under `promotionUsageFinalizer`,
 * exactly as `orders` resolves it. So the two halves of D-171's claim — *the
 * interface is published, the implementation is reached through the container* —
 * are the two halves of this file, and nothing here type-asserts its way past
 * either: a signature drift in the package's `dist` fails the `import type`, and
 * a registration that stopped being a port fails the resolution.
 *
 * **What is asserted is the guarantee the foreign key exists for**, not that a
 * method can be called. `promotion_usages_order_fk` (`promotion_usages.order_id`
 * -> `orders.id`, `on delete restrict`) and the `update … where count < limit`
 * race gate are one mechanism: a placement that rolls back must redeem nothing
 * and must consume no counter. That property is invisible to a unit test with a
 * stubbed transaction and it is precisely what a package boundary could have
 * broken — a second `EntityManager` on the package's side, a second copy of the
 * entity metadata, a `dist` compiled against a stale contract. It is measured
 * here by rolling a real caller transaction back and reading the database
 * afterwards.
 *
 * The `orders` half is deliberately its own case rather than a full placement:
 * this file's subject is the seam, and driving it directly is what makes a
 * failure name the seam instead of naming whichever of placement's twenty other
 * collaborators moved.
 */
describe('PromotionUsageFinalizer across the package boundary (D-169/D-171)', () => {
  let h: BackendServerHandle;
  let salesChannelId: string;

  /** The port as its **owner** publishes it, resolved as `orders` resolves it. */
  const port = (): PromotionUsageFinalizer =>
    (h.container.cradle as unknown as { promotionUsageFinalizer: PromotionUsageFinalizer })
      .promotionUsageFinalizer;

  /**
   * Both aggregates are written so the **query** always returns exactly one
   * row, and a missing row is read as a failure rather than defaulted to a
   * number (issue #159). `count(*)` is one row by construction; the counter is
   * `coalesce`d in SQL, where "no counter yet" genuinely means zero uses — the
   * absence is answered by the database rather than by a `??` in the assertion,
   * which is what would let a query that returned nothing at all read as a
   * clean zero.
   */
  const oneNumber = async (sql: string, params: unknown[]): Promise<number> => {
    const rows = (await h.em().execute(sql, params)) as Array<{ n: number }>;
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`[seam] an aggregate that must return one row returned none: ${sql}`);
    }
    return row.n;
  };

  const redemptionsOf = (promotionId: string): Promise<number> =>
    oneNumber(`select count(*)::int as n from "promotion_usages" where promotion_id = ?`, [
      promotionId,
    ]);

  const counterOf = (promotionId: string): Promise<number> =>
    oneNumber(
      `select coalesce(
                (select "count" from "promotion_usage_counters"
                  where "scope_type" = 'global' and "scope_key" = ?), 0)::int as n`,
      [promotionId],
    );

  /** A promotion with a global usage cap, so the counter path is exercised. */
  const seedPromotion = async (limit: number): Promise<string> => {
    const em = h.em();
    const promo = em.create(Promotion, {
      name: `T040b seam promotion ${randomUUID()}`,
      kind: 'percentage_off',
      value: '10.0000',
      isActive: true,
      usageLimitGlobal: limit,
    });
    await em.persistAndFlush(promo);
    return promo.id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const rows = (await h
      .em()
      .execute(
        `select "id" from "sales_channels" where "system_default" = true limit 1`,
      )) as Array<{ id: string }>;
    const found = rows[0]?.id;
    if (found === undefined) {
      // The system-default channel is an install invariant (D-47…D-51). A
      // fabricated id here would make every assertion below a claim about a
      // channel nobody has.
      throw new Error('[seam] no system-default sales channel — the harness did not seed');
    }
    salesChannelId = found;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** An order row the redemption's foreign key can point at. */
  const insertOrder = async (em: EntityManager): Promise<string> => {
    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId,
      status: 'pending',
      paymentStatus: 'awaiting_payment',
      deliveryAddress: {
        recipientName: 'S',
        street: 's',
        city: 'c',
        postalCode: '00-000',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'S',
        street: 's',
        city: 'c',
        postalCode: '00-000',
        country: 'PL',
      },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'p', name: 'P', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'tr', name: 'TR', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    return order.id;
  };

  const finalizeOn = (tx: EntityManager, orderId: string, promotionId: string): Promise<void> =>
    port().finalizeUsage(tx, {
      orderId,
      currency: 'PLN',
      ctx: {
        organizationId: null,
        customerAccountId: null,
        customerGroupId: null,
        salesChannelId,
      },
      applied: [{ promotionId, couponId: null, amount: 1 }],
    });

  it('redeems on the caller`s transaction and the row survives the commit', async () => {
    const promotionId = await seedPromotion(5);
    const em = h.em().fork();
    await em.transactional(async (tx) => {
      const orderId = await insertOrder(tx as EntityManager);
      await finalizeOn(tx as EntityManager, orderId, promotionId);
    });

    expect(await redemptionsOf(promotionId)).toBe(1);
    expect(await counterOf(promotionId)).toBe(1);
  });

  it('redeems nothing when the caller`s transaction rolls back', async () => {
    const promotionId = await seedPromotion(5);
    const em = h.em().fork();
    const marker = `t040b-promo-rollback-${randomUUID()}`;

    await expect(
      em.transactional(async (tx) => {
        const orderId = await insertOrder(tx as EntityManager);
        await finalizeOn(tx as EntityManager, orderId, promotionId);
        // The redemption is real *inside* the transaction — otherwise the
        // assertions below would pass for a call that redeemed nothing at all.
        const seen = (await (tx as EntityManager).execute(
          `select count(*)::int as n from "promotion_usages" where order_id = ?`,
          [orderId],
        )) as Array<{ n: number }>;
        expect(seen[0]?.n).toBe(1);
        const bumped = (await (tx as EntityManager).execute(
          `select "count"::int as n from "promotion_usage_counters"
            where "scope_type" = 'global' and "scope_key" = ?`,
          [promotionId],
        )) as Array<{ n: number }>;
        expect(bumped[0]?.n).toBe(1);
        throw new Error(marker);
      }),
    ).rejects.toThrow(marker);

    expect(await redemptionsOf(promotionId)).toBe(0);
    expect(await counterOf(promotionId)).toBe(0);
  });

  it('rolls the caller back when the cap is hit, rather than half-redeeming (SC-005)', async () => {
    const promotionId = await seedPromotion(1);
    const em = h.em().fork();
    await em.transactional(async (tx) => {
      const orderId = await insertOrder(tx as EntityManager);
      await finalizeOn(tx as EntityManager, orderId, promotionId);
    });
    expect(await redemptionsOf(promotionId)).toBe(1);

    const second = h.em().fork();
    await expect(
      second.transactional(async (tx) => {
        const orderId = await insertOrder(tx as EntityManager);
        await finalizeOn(tx as EntityManager, orderId, promotionId);
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // The cap hit took the whole placement with it: still one redemption and
    // still one counted use.
    expect(await redemptionsOf(promotionId)).toBe(1);
    expect(await counterOf(promotionId)).toBe(1);
  });

  it('refuses at the port gate while `promotions` is off, rather than half-redeeming', async () => {
    const promotionId = await seedPromotion(5);
    await withModuleOff('promotions', 'deactivated', async () => {
      const em = h.em().fork();
      await expect(
        em.transactional(async (tx) => {
          const orderId = await insertOrder(tx as EntityManager);
          await finalizeOn(tx as EntityManager, orderId, promotionId);
        }),
      ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    });
    expect(await redemptionsOf(promotionId)).toBe(0);
    expect(await counterOf(promotionId)).toBe(0);
  });
});
