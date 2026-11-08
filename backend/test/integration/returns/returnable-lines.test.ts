import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order, OrderItem, Product } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { checkOutBasket, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';
import { buyerChannelIds, createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 155, Phase 12a (T091) — only returnable lines can be returned
 * (`specs/155-catalog-order-constraints/`, US6 #1 – #7 and #9; FR-017 – FR-020,
 * FR-022, FR-025; `contracts/returns-api.md` §2–§3; threat S6).
 *
 * The placement stamp itself is Phase 12's (`orders/returnable-at-purchase.test.ts`);
 * here one order is placed through checkout (R returnable, N not) to show the
 * stamp governs after the products' flags change (US6 #6), and the rest are
 * seeded with the stamp each scenario needs.
 */

interface ReturnableLine {
  orderItemId: string;
  productId: string;
  name: string;
  remainingReturnableQty: number;
  returnable: boolean;
  notReturnableReason?: string;
}
interface ReturnableBody {
  data: { eligible: boolean; reason?: string; lines: ReturnableLine[] };
}
interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('155 — returns refuse non-returnable lines; complaints are untouched [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let reasonId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    reasonId = await anyReasonId(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function returnable(orderId: string): Promise<ReturnableBody['data']> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/returnable`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as ReturnableBody).data;
  }

  async function submit(
    orderId: string,
    kind: 'return' | 'complaint',
    lines: Array<{ orderItemId: string; quantity: number }>,
    acceptLanguage = 'en',
  ) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      headers: { 'accept-language': acceptLanguage },
      payload: { orderId, kind, lines: lines.map((l) => ({ ...l, reasonId })) },
    });
  }

  async function caseCount(orderId: string): Promise<number> {
    const rows = await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as n from return_cases where order_id = ?`, [orderId]);
    return (rows[0] as { n: number }).n;
  }

  function byId(lines: ReturnableLine[], orderItemId: string): ReturnableLine {
    const line = lines.find((l) => l.orderItemId === orderItemId);
    expect(line, orderItemId).toBeDefined();
    return line!;
  }

  describe('a mixed order: R stamped returnable, N stamped not', () => {
    let orderId = '';
    let r = '';
    let n = '';
    const nName = `Final sale ${RUN}`;

    beforeAll(async () => {
      const seeded = await seedReturnableOrder(h.em(), {
        lines: [
          { quantity: 2, name: `Returnable ${RUN}`, returnableAtPurchase: true },
          { quantity: 2, name: nName, returnableAtPurchase: false },
        ],
      });
      orderId = seeded.orderId;
      [r, n] = seeded.itemIds as [string, string];
    });

    it('#1 marks R returnable and N not returnable with product_not_returnable; the order stays eligible', async () => {
      const data = await returnable(orderId);
      expect(data.eligible).toBe(true);
      expect(data.reason).toBeUndefined();
      const lineR = byId(data.lines, r);
      expect(lineR.returnable).toBe(true);
      expect(lineR.notReturnableReason).toBeUndefined();
      const lineN = byId(data.lines, n);
      expect(lineN.returnable).toBe(false);
      expect(lineN.notReturnableReason).toBe('product_not_returnable');
    });

    it('#2 refuses a return including N with RETURN_LINE_NOT_RETURNABLE naming N; no case is created [S6]', async () => {
      const res = await submit(orderId, 'return', [
        { orderItemId: r, quantity: 1 },
        { orderItemId: n, quantity: 1 },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      const error = (res.json() as ErrorBody).error;
      expect(error.code).toBe(ERROR_CODES.RETURN_LINE_NOT_RETURNABLE);
      expect(error.message).toBe(`"${nName}" cannot be returned. You can still file a complaint.`);
      expect(error.details).toEqual({
        productName: nName,
        orderItemIds: [n],
        lines: [{ orderItemId: n, productName: nName }],
      });
      expect(await caseCount(orderId)).toBe(0);
    });

    it('#2 answers in Polish with Accept-Language: pl', async () => {
      const res = await submit(orderId, 'return', [{ orderItemId: n, quantity: 1 }], 'pl');
      expect(res.statusCode, res.body).toBe(422);
      const error = (res.json() as ErrorBody).error;
      expect(error.code).toBe(ERROR_CODES.RETURN_LINE_NOT_RETURNABLE);
      expect(error.message).toBe(`Produktu „${nName}” nie można zwrócić. Nadal możesz złożyć reklamację.`);
      expect(await caseCount(orderId)).toBe(0);
    });

    it('#4 accepts a complaint for N', async () => {
      const res = await submit(orderId, 'complaint', [{ orderItemId: n, quantity: 1 }]);
      expect(res.statusCode, res.body).toBe(201);
    });

    /**
     * Owner ruling R1 (round B) — a complaint may name a line that was not
     * returnable at purchase (FR-020), but nothing refunds it by default: its
     * approved refund is stored as 0 for the operator to set, while its default
     * refund stays the amount paid — the cap the operator may approve up to. A
     * returnable line in the same complaint keeps the amount paid as before.
     */
    it('R1 — a complaint stores an approved refund of 0 for N and the amount paid for R', async () => {
      const res = await submit(orderId, 'complaint', [
        { orderItemId: r, quantity: 1 },
        { orderItemId: n, quantity: 1 },
      ]);
      expect(res.statusCode, res.body).toBe(201);
      const caseId = (res.json() as { data: { id: string } }).data.id;

      const rows = (await h
        .em()
        .getConnection()
        .execute(
          `select order_item_id, default_refund_amount::text as d, approved_refund_amount::text as a
             from return_case_items where return_case_id = ?`,
          [caseId],
        )) as Array<{ order_item_id: string; d: string; a: string }>;
      const stored = Object.fromEntries(rows.map((row) => [row.order_item_id, { d: row.d, a: row.a }]));
      expect(stored[r]).toEqual({ d: '10.00', a: '10.00' });
      expect(stored[n]).toEqual({ d: '10.00', a: '0.00' });

      const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${caseId}`, cookies: ADMIN_COOKIE });
      expect(detail.statusCode, detail.body).toBe(200);
      const items = (detail.json() as {
        data: { items: Array<{ orderItemId: string; returnableAtPurchase?: boolean | null; approvedRefundAmount: number }> };
      }).data.items;
      expect(items.find((i) => i.orderItemId === n)).toMatchObject({ returnableAtPurchase: false, approvedRefundAmount: 0 });
      expect(items.find((i) => i.orderItemId === r)).toMatchObject({ returnableAtPurchase: true, approvedRefundAmount: 10 });
    });

    it('accepts a return of R alone', async () => {
      const res = await submit(orderId, 'return', [{ orderItemId: r, quantity: 1 }]);
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  describe('#3 / #9 — every line non-returnable (incl. a fail-closed stamp)', () => {
    let orderId = '';
    let n1 = '';
    let n2 = '';

    beforeAll(async () => {
      const seeded = await seedReturnableOrder(h.em(), {
        lines: [
          { quantity: 1, name: `Final A ${RUN}`, returnableAtPurchase: false },
          // US6 #9: the stamp a record without a flag receives at placement (FR-016a fail-closed).
          { quantity: 1, name: `No flag ${RUN}`, returnableAtPurchase: false },
        ],
      });
      orderId = seeded.orderId;
      [n1, n2] = seeded.itemIds as [string, string];
    });

    it('#3 answers eligible: false with no_returnable_lines, every line not returnable', async () => {
      const data = await returnable(orderId);
      expect(data.eligible).toBe(false);
      expect(data.reason).toBe('no_returnable_lines');
      expect(data.lines.map((l) => l.returnable)).toEqual([false, false]);
    });

    it('#9 refuses a return of the fail-closed line, listing both lines of the request once each', async () => {
      const res = await submit(orderId, 'return', [
        { orderItemId: n2, quantity: 1 },
        { orderItemId: n1, quantity: 1 },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      const error = (res.json() as ErrorBody).error;
      expect(error.code).toBe(ERROR_CODES.RETURN_LINE_NOT_RETURNABLE);
      expect(error.details).toMatchObject({ productName: `No flag ${RUN}`, orderItemIds: [n2, n1] });
      expect(await caseCount(orderId)).toBe(0);
    });

    it('#3 / #9 still accept a complaint (eligible: false does not block it)', async () => {
      const res = await submit(orderId, 'complaint', [
        { orderItemId: n1, quantity: 1 },
        { orderItemId: n2, quantity: 1 },
      ]);
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  it('#7 a pre-feature order (no stamp) has every line returnable', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const data = await returnable(orderId);
    expect(data.eligible).toBe(true);
    expect(data.lines.map((l) => l.returnable)).toEqual([true, true]);
    expect(data.lines.every((l) => l.notReturnableReason === undefined)).toBe(true);
    const res = await submit(orderId, 'return', [{ orderItemId: itemIds[0]!, quantity: 1 }]);
    expect(res.statusCode, res.body).toBe(201);
  });

  it('#5 a case opened before the line became non-returnable continues through its workflow (FR-022)', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const created = await submit(orderId, 'return', [{ orderItemId: itemIds[0]!, quantity: 1 }]);
    expect(created.statusCode, created.body).toBe(201);
    const caseId = (created.json() as { data: { id: string } }).data.id;

    // The line now reads as non-returnable; the open case is not re-evaluated.
    await h.em().nativeUpdate(OrderItem, { id: itemIds[0]! }, { returnableAtPurchase: false });

    const authorized = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${caseId}/authorize`,
      cookies: ADMIN_COOKIE,
    });
    expect(authorized.statusCode, authorized.body).toBe(200);
    expect((authorized.json() as { data: { statusCode: string } }).data.statusCode).toBe('authorized');

    const own = await h.app.inject({ method: 'GET', url: `/api/v1/returns/${caseId}`, cookies: CUSTOMER_COOKIE });
    expect(own.statusCode, own.body).toBe(200);
  });

  it('#6 the stamp recorded at placement governs after the products\' flags change, both ways', async () => {
    const em = h.em();
    const channels = await buyerChannelIds(em);
    const R = await createMinimumProduct(em, {
      sku: `RL-R-${RUN}`,
      nameEn: `Returnable placed ${RUN}`,
      namePl: `Zwrotny ${RUN}`,
      returnable: true,
      channelIds: channels,
    });
    const N = await createMinimumProduct(em, {
      sku: `RL-N-${RUN}`,
      nameEn: `Final placed ${RUN}`,
      namePl: `Bezzwrotny ${RUN}`,
      returnable: false,
      channelIds: channels,
    });
    await em.nativeUpdate(Product, { id: { $in: [R.id, N.id] } }, { manageStock: false });
    await em
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);
    await cartWritePortOf(h).replaceItemsForCustomer(
      {
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: await systemDefaultSalesChannelId(h.em()),
      },
      [
        { productId: R.id, quantity: 1, unitPrice: '10.00', currency: 'PLN' },
        { productId: N.id, quantity: 1, unitPrice: '10.00', currency: 'PLN' },
      ],
    );
    const placed = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
    // A native update bypasses `OrderTransitionService`, so it stamps the
    // completion itself (issue #905): the return window counts from it.
    await em.nativeUpdate(Order, { id: placed.id }, { status: 'completed', completedAt: new Date() });

    // The operator flips both flags after the order was placed.
    await em.nativeUpdate(Product, { id: R.id }, { returnable: false });
    await em.nativeUpdate(Product, { id: N.id }, { returnable: true });

    const data = await returnable(placed.id);
    expect(Object.fromEntries(data.lines.map((l) => [l.productId, l.returnable]))).toEqual({
      [R.id]: true,
      [N.id]: false,
    });
    const nLine = data.lines.find((l) => l.productId === N.id)!;
    const refused = await submit(placed.id, 'return', [{ orderItemId: nLine.orderItemId, quantity: 1 }]);
    expect(refused.statusCode, refused.body).toBe(422);
    expect((refused.json() as ErrorBody).error.code).toBe(ERROR_CODES.RETURN_LINE_NOT_RETURNABLE);
  }, 120_000);
});
