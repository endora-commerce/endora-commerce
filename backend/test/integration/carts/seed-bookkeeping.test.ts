import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';

/**
 * `CartWritePort.replaceItemsForCustomer` and the basket's own bookkeeping
 * (`specs/143-crm-sales-opportunities/`, research N-QS5 (a), N-QSR4).
 *
 * The seed set `lastActivityAt` on a row another `EntityManager` managed, so
 * nothing wrote it: a basket that had sat idle and was then filled by a
 * reorder or a quote conversion kept its old activity time, and the
 * abandonment sweep reads that column. The repair is one line and nothing
 * held it.
 */
describe('carts — a seeded basket is a basket somebody just used', () => {
  let h: BackendServerHandle;
  const CTX = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
  const LINE = { productId: SEED_PRODUCT_101_ID, quantity: 2, unitPrice: '11.25', currency: 'PLN' };

  const basket = async () => {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('moves lastActivityAt of a basket that had sat idle', async () => {
    const first = await cartWritePortOf(h).replaceItemsForCustomer(CTX, [LINE]);
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await h
      .em()
      .getConnection()
      .execute(`update "carts" set "last_activity_at" = ? where "id" = ?`, [longAgo, first.cart.id]);
    expect((await basket()).lastActivityAt.getTime()).toBeLessThan(Date.now() - 80 * 24 * 60 * 60 * 1000);

    const before = Date.now();
    const seeded = await cartWritePortOf(h).replaceItemsForCustomer(CTX, [LINE]);

    expect(seeded.cart.id).toBe(first.cart.id);
    expect((await basket()).lastActivityAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // What the port answers is the row as written, not the row as first read.
    expect(seeded.cart.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
