import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteRequestReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { Cart, StockLevel } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { seedOtherTestCustomer } from '../../helpers/seed-organizations.js';
import { checkOutBasket, convertQuoteRequestToCart, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const OTHER_ORG_CUSTOMER = { b2b_session: 'stub-customer-session-other-org' };
const ADMIN = { b2b_session: 'stub-admin-session' };

interface OrderReply {
  id: string;
  sourceQuoteRequestId: string | null;
  itemGroups: Array<{ id: string; name: string; position: number }>;
  items: Array<{ productId: string; groupId: string | null; position: number; unitPrice: string; quantity: number }>;
}

/**
 * Feature 159, US4 — the order placed from an accepted, grouped quote keeps
 * its groups (`specs/159-quote-request-item-groups/contracts/orders-api.md` §2;
 * FR-050 … FR-053, FR-083, SC-003).
 *
 * Every quote below is walked through the routes a buyer and an operator use:
 * raised by the buyer, priced and grouped by the operator, accepted, converted
 * into the basket, checked out. Only the forgeries are written by hand.
 */
describe('159 — an order placed from a grouped quote keeps its groups', () => {
  let h: BackendServerHandle;

  const sql = async <T extends object>(query: string, params: unknown[] = []): Promise<T[]> =>
    h.em().getConnection().execute<T[]>(query, params);

  /**
   * A quote of the buyer's Organization, accepted: Hall A [103, 101], Hall B
   * [102], and an empty group Unused — or as `layout` says.
   */
  async function acceptedGroupedQuote(
    customer: Record<string, string> = CUSTOMER,
    layout: {
      groups: Array<{ key: string; name: string }>;
      items: Array<{ productId: string; groupKey: string | null; agreedUnitPrice: number; quantity?: number }>;
    } = {
      groups: [
        { key: 'a', name: 'Hall A' },
        { key: 'u', name: 'Unused' },
        { key: 'b', name: 'Hall B' },
      ],
      items: [
        { productId: SEED_PRODUCT_103_ID, groupKey: 'a', agreedUnitPrice: 13 },
        { productId: SEED_PRODUCT_101_ID, groupKey: 'a', agreedUnitPrice: 11 },
        { productId: SEED_PRODUCT_102_ID, groupKey: 'b', agreedUnitPrice: 12 },
      ],
    },
  ): Promise<string> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customer,
      payload: {
        items: layout.items.map(({ productId, quantity }) => ({ productId, quantity: quantity ?? 3, desiredUnitPrice: 20 })),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const rfq = (created.json() as { data: { id: string; version: number } }).data;
    const priced = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${rfq.id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${rfq.version}"` },
      payload: {
        groups: layout.groups,
        items: layout.items.map((item) => ({ ...item, quantity: item.quantity ?? 3 })),
      },
    });
    expect(priced.statusCode, priced.body).toBe(200);
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${rfq.id}`, cookies: customer });
    const current = (detail.json() as { data: { currentRevisionNumber: number } }).data;
    const accepted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfq.id}/accept-revision`,
      cookies: customer,
      payload: { expectedRevisionNumber: current.currentRevisionNumber },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    return rfq.id;
  }

  const place = () => whenOrderCreatedSettled(h, () => checkOutBasket(h));

  const orderAs = async (orderId: string, cookies: Record<string, string>, admin = false): Promise<OrderReply> => {
    const res = await h.app.inject({
      method: 'GET',
      url: admin ? `/api/v1/admin/orders/${orderId}` : `/api/v1/orders/${orderId}`,
      cookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: OrderReply }).data;
  };

  /** `[group name | '-', productId, position]` per line, in the reply's order. */
  const shapeOf = (order: OrderReply) => {
    const names = new Map(order.itemGroups.map((group) => [group.id, group.name]));
    return order.items.map((item) => [item.groupId ? names.get(item.groupId) : '-', item.productId, item.position]);
  };

  const storedGroups = (orderId: string) =>
    sql<{ name: string; position: number }>(
      `select "name", "position" from "order_item_groups" where "order_id" = ? order by "position"`,
      [orderId],
    );

  const addToBasket = async (productId: string, quantity = 1) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: CUSTOMER,
      payload: { productId, quantity },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  const forgeBasketSource = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
    cart.sourceQuoteRequestId = quoteRequestId;
    await em.flush();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const productId of [SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID]) {
      const stocked = await em.count(StockLevel, { productId }, { filters: false });
      if (stocked === 0) {
        em.create(StockLevel, {
          productId,
          warehouseId: '00000000-0000-4000-8000-00000000d017',
          onHand: 100,
          reserved: 0,
        });
      }
    }
    await em.flush();
    await em.execute(`update "stock_levels" set "on_hand" = 100000`);
    await seedOtherTestCustomer(em);
  }, 90_000);

  beforeEach(async () => {
    await sql(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
      TEST_CUSTOMER_ID,
    ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('an unchanged basket gives the order the quote groups, their order and each group’s lines (SC-003)', async () => {
    const quoteId = await acceptedGroupedQuote();
    await convertQuoteRequestToCart(h, quoteId);
    const placed = await place();

    const mine = await orderAs(placed.id, CUSTOMER);
    expect(mine.sourceQuoteRequestId).toBe(quoteId);
    expect(mine.itemGroups.map((group) => [group.name, group.position])).toEqual([
      ['Hall A', 0],
      ['Hall B', 1],
    ]);
    expect(shapeOf(mine)).toEqual([
      ['Hall A', SEED_PRODUCT_103_ID, 0],
      ['Hall A', SEED_PRODUCT_101_ID, 1],
      ['Hall B', SEED_PRODUCT_102_ID, 0],
    ]);
    // The empty quote group is not carried (FR-034), and the groups are the order's own rows.
    expect(await storedGroups(placed.id)).toEqual([
      { name: 'Hall A', position: 0 },
      { name: 'Hall B', position: 1 },
    ]);
    const quoteGroupIds = (
      await sql<{ id: string }>(`select "id" from "quote_request_item_groups" where "quote_request_id" = ?`, [quoteId])
    ).map((row) => row.id);
    for (const group of mine.itemGroups) expect(quoteGroupIds).not.toContain(group.id);

    // The operator reads the same arrangement.
    expect(shapeOf(await orderAs(placed.id, ADMIN, true))).toEqual(shapeOf(mine));
  });

  it('one product split over two groups at one price lands in the right groups, whatever the basket order (N-31)', async () => {
    // Z's line first in the quote's own line order: quantity, not position, must decide.
    const splitQuote = () =>
      acceptedGroupedQuote(CUSTOMER, {
        groups: [
          { key: 'y', name: 'Group Y' },
          { key: 'z', name: 'Group Z' },
        ],
        items: [
          { productId: SEED_PRODUCT_102_ID, groupKey: 'z', agreedUnitPrice: 12, quantity: 2 },
          { productId: SEED_PRODUCT_101_ID, groupKey: 'z', agreedUnitPrice: 11, quantity: 3 },
          { productId: SEED_PRODUCT_101_ID, groupKey: 'y', agreedUnitPrice: 11, quantity: 5 },
        ],
      });
    const expected = [
      ['Group Y', SEED_PRODUCT_101_ID, 0],
      ['Group Z', SEED_PRODUCT_102_ID, 0],
      ['Group Z', SEED_PRODUCT_101_ID, 1],
    ];

    // As seeded: the basket reads back in the quote's display order.
    await convertQuoteRequestToCart(h, await splitQuote());
    const seeded = await orderAs((await place()).id, CUSTOMER);
    expect(shapeOf(seeded)).toEqual(expected);
    expect(seeded.items.map((item) => item.quantity)).toEqual([5, 2, 3]);

    // Re-timed so the split lines read back swapped: the carry does not lean on the basket's order.
    const second = await splitQuote();
    await convertQuoteRequestToCart(h, second);
    await sql(
      `update "cart_items" set "created_at" = "created_at" - interval '1 hour'
        where "quantity" = 3 and "cart_id" in (select "id" from "carts" where "source_quote_request_id" = ? and "status" = 'active')`,
      [second],
    );
    const swapped = await orderAs((await place()).id, CUSTOMER);
    expect(shapeOf(swapped)).toEqual(expected);
    expect(swapped.items.map((item) => item.quantity)).toEqual([5, 2, 3]);
  });

  it('a product added to the basket after the conversion is ungrouped, after the quote’s lines (FR-051)', async () => {
    const quoteId = await acceptedGroupedQuote(CUSTOMER, {
      groups: [{ key: 'a', name: 'Hall A' }],
      items: [
        { productId: SEED_PRODUCT_102_ID, groupKey: 'a', agreedUnitPrice: 12 },
        { productId: SEED_PRODUCT_101_ID, groupKey: null, agreedUnitPrice: 11 },
      ],
    });
    await convertQuoteRequestToCart(h, quoteId);
    await addToBasket(SEED_PRODUCT_103_ID);
    const placed = await place();
    expect(shapeOf(await orderAs(placed.id, CUSTOMER))).toEqual([
      ['Hall A', SEED_PRODUCT_102_ID, 0],
      ['-', SEED_PRODUCT_101_ID, 0],
      ['-', SEED_PRODUCT_103_ID, 1],
    ]);
  });

  it('asks the quote port for the lines once per placement', async () => {
    const quoteId = await acceptedGroupedQuote();
    await convertQuoteRequestToCart(h, quoteId);
    const port = h.container.resolve('quoteRequestReadPort') as QuoteRequestReadPort;
    const listItems = vi.spyOn(port, 'listItems');
    try {
      const placed = await place();
      expect((await storedGroups(placed.id)).length).toBe(2);
      expect(listItems.mock.calls.filter(([id]) => id === quoteId)).toHaveLength(1);
    } finally {
      listItems.mockRestore();
    }
  });

  it('a later change of the quote leaves the order’s groups alone (FR-053)', async () => {
    const quoteId = await acceptedGroupedQuote();
    await convertQuoteRequestToCart(h, quoteId);
    const placed = await place();
    const before = await orderAs(placed.id, CUSTOMER);
    // The quote is completed by now and no route changes it; its rows are changed by hand.
    await sql(`update "quote_request_item_groups" set "name" = 'Renamed', "position" = 9 where "quote_request_id" = ?`, [
      quoteId,
    ]);
    await sql(`update "quote_request_items" set "group_id" = null where "quote_request_id" = ?`, [quoteId]);
    expect(await orderAs(placed.id, CUSTOMER)).toEqual(before);
  });

  describe('a source placement does not believe: placed, without groups (FR-052)', () => {
    const expectUngrouped = async (orderId: string) => {
      const order = await orderAs(orderId, CUSTOMER);
      expect(order.sourceQuoteRequestId ?? null).toBeNull();
      expect(order.itemGroups).toEqual([]);
      expect(order.items.every((item) => item.groupId === null)).toBe(true);
      expect(order.items.map((item) => item.position)).toEqual(order.items.map((_, index) => index));
      expect(await storedGroups(orderId)).toEqual([]);
    };

    it('a grouped quote of another Organization', async () => {
      const foreign = await acceptedGroupedQuote(OTHER_ORG_CUSTOMER);
      const own = await acceptedGroupedQuote();
      await convertQuoteRequestToCart(h, own);
      await forgeBasketSource(foreign);
      await expectUngrouped((await place()).id);
    });

    // Issue #167 — a quote no longer approved does not bind its agreed prices
    // either, so the basket it filled is refused rather than placed ungrouped.
    it('a quote no longer approved — refused at its agreed prices, so nothing to group', async () => {
      const quoteId = await acceptedGroupedQuote();
      await convertQuoteRequestToCart(h, quoteId);
      await sql(`update "quote_requests" set "status" = 'Canceled', "canceled_at" = now() where "id" = ?`, [quoteId]);
      await expect(place()).rejects.toThrow(/checkOutBasket: 410 .*QUOTE_VALIDITY_ENDED/);
    });

    it('a quote already ordered', async () => {
      const quoteId = await acceptedGroupedQuote();
      await convertQuoteRequestToCart(h, quoteId);
      await place();
      // A second basket claiming the same quote, the quote read as approved again.
      await sql(`update "quote_requests" set "status" = 'Approved' where "id" = ?`, [quoteId]);
      await addToBasket(SEED_PRODUCT_101_ID, 3);
      await forgeBasketSource(quoteId);
      await expectUngrouped((await place()).id);
    });

    it('a quote that does not exist', async () => {
      await addToBasket(SEED_PRODUCT_101_ID);
      await forgeBasketSource(randomUUID());
      await expectUngrouped((await place()).id);
    });

    // Issue #167 — with the module off its agreed prices cannot be confirmed,
    // so the basket converted earlier is refused (fail-closed). What FR-083
    // still covers while off is an ordinary basket, which never had groups.
    it.each(['deactivated', 'platform-unavailable'] as const)(
      'quote requests %s — the basket converted earlier is refused at its agreed prices',
      async (axis) => {
        const quoteId = await acceptedGroupedQuote();
        await convertQuoteRequestToCart(h, quoteId);
        await expect(withModuleOff('quote_requests', axis, () => place())).rejects.toThrow(
          /checkOutBasket: 410 .*QUOTE_VALIDITY_ENDED/,
        );
      },
    );
  });

  it('an ordinary basket stores its lines in basket order, ungrouped (I-O3)', async () => {
    await addToBasket(SEED_PRODUCT_102_ID);
    await addToBasket(SEED_PRODUCT_101_ID);
    const order = await orderAs((await place()).id, CUSTOMER);
    expect(order.itemGroups).toEqual([]);
    expect(order.items.map((item) => [item.productId, item.position])).toEqual([
      [SEED_PRODUCT_102_ID, 0],
      [SEED_PRODUCT_101_ID, 1],
    ]);
  });
});
