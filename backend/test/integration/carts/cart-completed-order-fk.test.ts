import { Cart, type CartRow } from '../../helpers/package-entities.js';
import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';


/**
 * `carts_completed_order_fk` (D-94.1, site 2 — the one where the column itself
 * was missing).
 *
 * `placeOrder` empties the cart and marks it `completed` inside the placement
 * transaction, because a placement that fails must leave the basket exactly as
 * the buyer left it. There was no foreign key in either direction to declare
 * that seam with, and the **cart-side** pointer is the direction that forces
 * it: an `orders.cart_id` would have been satisfiable by completing the cart in
 * a second transaction, since the cart is already committed when the order row
 * is written.
 *
 * `on delete set null`, matching the pointer this table already carries for its
 * other terminal transition (`carts_converted_to_qr_fk`): deleting the order
 * does not invalidate the fact that the cart was once completed.
 */
describe('carts.completed_order_id foreign key (D-94.1)', () => {
  let h: BackendServerHandle;
  /**
   * The system-default channel, read rather than defaulted: `carts` already
   * constrains `sales_channel_id`, and a fabricated id would raise `23503` for
   * that constraint instead of the one this file is about. `findOneOrFail`
   * because exactly one system-default channel always exists (D-47).
   */
  let salesChannelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    salesChannelId = (await h.em().findOneOrFail(SalesChannel, { systemDefault: true })).id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const seedCart = async (): Promise<CartRow> => {
    const em = h.em();
    const cart = em.create(Cart, {
      customerAccountId: randomUUID(),
      organizationId: randomUUID(),
      salesChannelId,
      status: 'active',
    });
    await em.persistAndFlush(cart);
    return cart;
  };

  it('declares carts_completed_order_fk into orders with on delete set null', async () => {
    const rows = (await h.em().getConnection().execute(
      `select con."conname", con."confdeltype", ref."relname" as "referenced"
         from "pg_constraint" con
         join "pg_class" ref on ref."oid" = con."confrelid"
        where con."conrelid" = '"carts"'::regclass
          and con."contype" = 'f'`,
    )) as Array<{ conname: string; confdeltype: string; referenced: string }>;

    expect(rows).toContainEqual(
      expect.objectContaining({
        conname: 'carts_completed_order_fk',
        confdeltype: 'n',
        referenced: 'orders',
      }),
    );
  });

  it('refuses a completion pointer naming no order', async () => {
    const cart = await seedCart();

    await expect(
      h
        .em()
        .getConnection()
        .execute(`update "carts" set "completed_order_id" = ? where "id" = ?`, [
          randomUUID(),
          cart.id,
        ]),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'carts_completed_order_fk',
    });
  });

  /**
   * The column is new, so every existing row starts `null` — which is why this
   * migration is the one of the four that ships **no** orphan report. The other
   * three need one precisely because their columns have been accepting
   * unverified values for months.
   */
  it('starts null on every cart, which is why the migration needs no orphan report', async () => {
    const cart = await seedCart();
    const em = h.em();
    em.clear();

    const reloaded = await em.findOneOrFail(Cart, { id: cart.id });
    expect(reloaded.completedOrderId ?? null).toBeNull();
  });
});
