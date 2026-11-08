import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Issue #905 (PR 1, design D3.1 and D3.4) — the free-return window, and the
 * consumer's withdrawal period after it, count from the moment the order
 * entered `completed` (`orders.completed_at`), read through
 * `OrderReturnContextPort`. Until now they counted from `order.updatedAt`, which
 * any later edit of the order moved forward.
 *
 * `returns` reads no `shipments` fact for the anchor, so switching `shipments`
 * off changes nothing here (design D3.6); the port's own unit test pins that
 * the provider imports nothing from it.
 */
const DAY_MS = 86_400_000;

describe('905 — the return window counts from completed_at [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** A completed order whose completion and last edit are set apart. */
  async function completedOrder(completedAt: Date, updatedAt: Date) {
    const seeded = await seedReturnableOrder(h.em());
    await h
      .em()
      .getConnection()
      .execute(`update "orders" set "completed_at" = ?, "updated_at" = ? where "id" = ?`, [
        completedAt,
        updatedAt,
        seeded.orderId,
      ]);
    return seeded;
  }

  const returnable = async (orderId: string) => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}/returnable`, cookies: CUSTOMER_COOKIE });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { eligible: boolean; reason?: string; freeReturnEligible: boolean } }).data;
  };

  it('is closed for an order completed 20 days ago, however recently it was edited', async () => {
    const now = Date.now();
    const { orderId, itemIds } = await completedOrder(new Date(now - 20 * DAY_MS), new Date(now));

    const data = await returnable(orderId);
    expect(data).toMatchObject({ eligible: true, freeReturnEligible: false });

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect((created.json() as { data: { freeReturnEligible: boolean } }).data.freeReturnEligible).toBe(false);
  });

  it('is open for an order completed 2 days ago, whenever it was last edited', async () => {
    const now = Date.now();
    const { orderId } = await completedOrder(new Date(now - 2 * DAY_MS), new Date(now - 30 * DAY_MS));
    expect(await returnable(orderId)).toMatchObject({ eligible: true, freeReturnEligible: true });
  });

  it('declares returns.time_zone, defaulting to Europe/Warsaw', async () => {
    expect(await h.settings.settingsService.get('returns.time_zone', null, z.string())).toBe('Europe/Warsaw');
  });
});
