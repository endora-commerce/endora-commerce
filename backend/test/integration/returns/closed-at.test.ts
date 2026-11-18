import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * `specs/181-guest-complaints/` T008 (research R-9, owner ruling 3): a case
 * *closes* when it enters a terminal status, and `closed_at` records when — in
 * the same flush as the status, for every case. A non-terminal status leaves it
 * unset. Guest data retention and the tracking link's expiry count from it.
 */
describe('returns — closed_at is written on entry into a terminal status', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createCase(): Promise<string> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function transition(id: string, to: string, reason?: string): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/transition`,
      cookies: ADMIN_COOKIE,
      payload: reason ? { to, reason } : { to },
    });
    expect(res.statusCode, `transition to ${to}: ${res.body}`).toBe(200);
  }

  async function closedAt(id: string): Promise<Date | null> {
    const rows = (await h.em().execute('select "closed_at" from "return_cases" where "id" = ?', [id])) as Array<{
      closed_at: Date | string | null;
    }>;
    const value = rows[0]!.closed_at;
    return value === null ? null : new Date(value);
  }

  it('leaves it unset at filing and on every non-terminal status, and sets it on entering Closed', async () => {
    const id = await createCase();
    expect(await closedAt(id)).toBeNull();
    for (const to of ['authorized', 'received', 'resolved']) {
      await transition(id, to);
      expect(await closedAt(id), to).toBeNull();
    }
    const before = Date.now();
    await transition(id, 'closed');
    const stamp = await closedAt(id);
    expect(stamp).toBeInstanceOf(Date);
    expect(stamp!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stamp!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('sets it on entering Rejected', async () => {
    const id = await createCase();
    await transition(id, 'rejected', 'Not covered');
    expect(await closedAt(id)).toBeInstanceOf(Date);
  });

  it('sets it on entering Cancelled', async () => {
    const id = await createCase();
    await transition(id, 'cancelled');
    expect(await closedAt(id)).toBeInstanceOf(Date);
  });
});
