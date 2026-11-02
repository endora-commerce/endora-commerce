import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart, CartItem } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
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
  /** The basket of the system-default channel — the one a request naming none uses. */
  let CTX: { customerAccountId: string; organizationId: string; salesChannelId: string };
  const LINE = { productId: SEED_PRODUCT_101_ID, quantity: 2, unitPrice: '11.25', currency: 'PLN' };

  const basket = async () => {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    CTX = {
      customerAccountId: TEST_CUSTOMER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: await systemDefaultSalesChannelId(h.em()),
    };
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

  /**
   * Feature 159 (research N-31) — a quote may hold one product on several lines
   * (in different groups), and the seed writes them in one flush. The basket is
   * read by creation time, so lines sharing one came back in random-id order.
   */
  it('reads a seed of repeated lines back in seed order, every time', async () => {
    const quantities = [5, 3, 7, 1, 4, 2, 6, 9];
    for (let round = 0; round < 3; round += 1) {
      const seeded = await cartWritePortOf(h).replaceItemsForCustomer(
        CTX,
        quantities.map((quantity) => ({ ...LINE, quantity })),
      );
      expect(seeded.items.map((item) => item.quantity)).toEqual(quantities);
      const read = await cartWritePortOf(h).replaceItemsForCustomer(CTX, quantities.map((quantity) => ({ ...LINE, quantity })));
      expect(read.items.map((item) => item.quantity)).toEqual(quantities);
    }
  });

  /**
   * Issue #167 — a line seeded with an agreement names the quote it came from,
   * so placement can read that quote again; a seed without one (a reorder)
   * names none.
   */
  it('names the source quote on each agreed line, and none on a reorder seed', async () => {
    const quoteRequestId = '00000000-0000-4000-8000-0000000167a1';
    const agreed = await cartWritePortOf(h).replaceItemsForCustomer(CTX, [LINE, { ...LINE, quantity: 3 }], {
      sourceQuoteRequestId: quoteRequestId,
    });
    expect(agreed.items.map((item) => item.quoteRequestId)).toEqual([quoteRequestId, quoteRequestId]);
    const em = h.em();
    em.clear();
    const stored = await em.find(CartItem, { cartId: agreed.cart.id }, { filters: false });
    expect(stored.map((item) => item.quoteRequestId)).toEqual([quoteRequestId, quoteRequestId]);

    const reorder = await cartWritePortOf(h).replaceItemsForCustomer(CTX, [LINE]);
    expect(reorder.items.map((item) => item.quoteRequestId ?? null)).toEqual([null]);
  });
});
