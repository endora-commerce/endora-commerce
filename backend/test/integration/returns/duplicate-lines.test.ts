import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReturnReason } from '../../helpers/package-entities.js';
import { minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { CUSTOMER_COOKIE, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 155, Phase 12a (T091a) — a request can name one order line more than
 * once, and its per-line total is what is judged against the remaining
 * quantity, for returns and complaints alike (`specs/155-catalog-order-constraints/`,
 * US6 #8, FR-033, SC-006; `contracts/returns-api.md` §3 step 1; threat F7).
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('155 — per-line totals on a case request [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let reasonA = '';
  let reasonB = '';
  const createdReasonIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    const em = h.em();
    const active = await em.find(ReturnReason, { isActive: true }, { orderBy: { weight: 'asc' }, limit: 2 });
    while (active.length < 2) {
      const extra = em.create(ReturnReason, {
        label: { en: `Duplicate-lines reason ${RUN}-${active.length}` },
        appliesTo: 'both',
      });
      await em.persistAndFlush(extra);
      createdReasonIds.push(extra.id);
      active.push(extra);
    }
    [reasonA, reasonB] = [active[0]!.id, active[1]!.id];
  });
  afterAll(async () => {
    if (createdReasonIds.length > 0) {
      await h.em().nativeDelete(ReturnReason, { id: { $in: createdReasonIds } });
    }
    await teardownBackendServer(h);
  });

  async function submit(
    orderId: string,
    kind: 'return' | 'complaint',
    lines: Array<{ orderItemId: string; quantity: number; reasonId?: string; description?: string }>,
  ) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind, lines: lines.map((l) => ({ reasonId: reasonA, ...l })) },
    });
  }

  async function caseCount(orderId: string): Promise<number> {
    const rows = await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as n from return_cases where order_id = ?`, [orderId]);
    return (rows[0] as { n: number }).n;
  }

  async function lineR4(): Promise<{ orderId: string; r: string }> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em(), {
      lines: [{ quantity: 4, name: `R ${RUN}`, returnableAtPurchase: true }],
    });
    return { orderId, r: itemIds[0]! };
  }

  function expectQtyRefusal(res: { statusCode: number; body: string; json: () => unknown }): void {
    expect(res.statusCode, res.body).toBe(422);
    const error = (res.json() as ErrorBody).error;
    // Its own code since issue #625; `details` names the line and the quantities.
    expect(error.code).toBe(ERROR_CODES.RETURN_QUANTITY_EXCEEDS_RETURNABLE);
    expect(error.details).toMatchObject({ requested: expect.any(Number), remaining: expect.any(Number) });
  }

  it('refuses a return listing R × 4 as 3 + 3; no case is created', async () => {
    const { orderId, r } = await lineR4();
    const res = await submit(orderId, 'return', [
      { orderItemId: r, quantity: 3 },
      { orderItemId: r, quantity: 3 },
    ]);
    expectQtyRefusal(res);
    expect(await caseCount(orderId)).toBe(0);
  });

  it('refuses the same 3 + 3 as a complaint; no case is created', async () => {
    const { orderId, r } = await lineR4();
    const res = await submit(orderId, 'complaint', [
      { orderItemId: r, quantity: 3 },
      { orderItemId: r, quantity: 3 },
    ]);
    expectQtyRefusal(res);
    expect(await caseCount(orderId)).toBe(0);
  });

  it('accepts 2 + 2 as two case lines with their own reason, then refuses 1 more (0 left)', async () => {
    const { orderId, r } = await lineR4();
    const res = await submit(orderId, 'return', [
      { orderItemId: r, quantity: 2, reasonId: reasonA, description: 'first' },
      { orderItemId: r, quantity: 2, reasonId: reasonB, description: 'second' },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const items = (
      res.json() as {
        data: { items: Array<{ orderItemId: string; quantity: number; reasonId: string; description: string | null }> };
      }
    ).data.items;
    expect(items).toHaveLength(2);
    expect(
      items
        .map((it) => ({ orderItemId: it.orderItemId, quantity: it.quantity, reasonId: it.reasonId, description: it.description }))
        .sort((a, b) => (a.description ?? '').localeCompare(b.description ?? '')),
    ).toEqual([
      { orderItemId: r, quantity: 2, reasonId: reasonA, description: 'first' },
      { orderItemId: r, quantity: 2, reasonId: reasonB, description: 'second' },
    ]);

    const more = await submit(orderId, 'complaint', [{ orderItemId: r, quantity: 1 }]);
    expectQtyRefusal(more);
    expect(await caseCount(orderId)).toBe(1);
  });

  it('a return naming one non-returnable line twice is refused once for it', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em(), {
      lines: [{ quantity: 4, name: `N ${RUN}`, returnableAtPurchase: false }],
    });
    const n = itemIds[0]!;
    const res = await submit(orderId, 'return', [
      { orderItemId: n, quantity: 1 },
      { orderItemId: n, quantity: 1 },
    ]);
    expect(res.statusCode, res.body).toBe(422);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe(ERROR_CODES.RETURN_LINE_NOT_RETURNABLE);
    expect(error.details).toEqual({
      productName: `N ${RUN}`,
      orderItemIds: [n],
      lines: [{ orderItemId: n, productName: `N ${RUN}` }],
    });
    expect(await caseCount(orderId)).toBe(0);
  });
});
