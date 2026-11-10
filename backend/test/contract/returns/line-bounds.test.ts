import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { LINE_QUANTITY_MAX, REQUEST_LINE_ITEMS_MAX, expectQuantityRefused, expectLineCountRefused } from '../../helpers/line-bounds.js';
import {
  CUSTOMER_COOKIE,
  anyReasonId,
  resetReturnGraph,
  seedReturnableOrder,
} from '../../integration/returns/helpers.js';

/**
 * Issue #351 — `POST /api/v1/returns` bounds a line's quantity at
 * `LINE_QUANTITY_MAX` and the line array at `REQUEST_LINE_ITEMS_MAX`. One past
 * either is `400 VALIDATION_FAILED` naming the field (a quantity past the int
 * column used to answer 500); the bound itself opens a case.
 */
describe('POST /api/v1/returns — line bounds (issue #351)', () => {
  let h: BackendServerHandle;
  let reasonId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    reasonId = await anyReasonId(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const submit = (orderId: string, lines: Array<{ orderItemId: string; quantity: number }>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: lines.map((l) => ({ ...l, reasonId })) },
    });

  it('refuses a quantity one past the bound and opens a case at it', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em(), {
      lines: [{ quantity: LINE_QUANTITY_MAX, returnableAtPurchase: true }],
    });
    const orderItemId = itemIds[0]!;
    expectQuantityRefused(await submit(orderId, [{ orderItemId, quantity: LINE_QUANTITY_MAX + 1 }]), 'lines.0.quantity');
    expectQuantityRefused(await submit(orderId, [{ orderItemId, quantity: 2 ** 31 }]), 'lines.0.quantity');
    const res = await submit(orderId, [{ orderItemId, quantity: LINE_QUANTITY_MAX }]);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(201);
  });

  it('refuses one line past the line bound and opens a case at it', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em(), {
      lines: Array.from({ length: REQUEST_LINE_ITEMS_MAX + 1 }, () => ({ quantity: 1, returnableAtPurchase: true })),
    });
    const lines = itemIds.map((orderItemId) => ({ orderItemId, quantity: 1 }));
    expectLineCountRefused(await submit(orderId, lines), 'lines');
    const res = await submit(orderId, lines.slice(0, REQUEST_LINE_ITEMS_MAX));
    expect(res.statusCode, res.body.slice(0, 500)).toBe(201);
  });
});
