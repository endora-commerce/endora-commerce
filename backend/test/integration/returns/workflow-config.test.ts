import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 046 (US3) — configurable return/complaint workflow.
 */
describe('returns — configurable workflow (US3)', () => {
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
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('exposes the seeded default status graph', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/statuses', cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { statuses: Array<{ code: string; isInitial: boolean; isTerminal: boolean }> } }).data;
    const codes = data.statuses.map((s) => s.code).sort();
    expect(codes).toEqual(['authorized', 'cancelled', 'closed', 'new', 'received', 'rejected', 'resolved']);
    expect(data.statuses.find((s) => s.code === 'new')!.isInitial).toBe(true);
    expect(data.statuses.find((s) => s.code === 'closed')!.isTerminal).toBe(true);
  });

  it('rejects a transition with no configured edge', async () => {
    const id = await createCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/transition`,
      cookies: ADMIN_COOKIE,
      payload: { to: 'resolved' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('walks the full default path new → authorized → received → resolved → closed', async () => {
    const id = await createCase();
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${id}/authorize`, cookies: ADMIN_COOKIE });
    for (const to of ['received', 'resolved', 'closed']) {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/returns/${id}/transition`,
        cookies: ADMIN_COOKIE,
        payload: { to },
      });
      expect(res.statusCode, `transition to ${to}`).toBe(200);
    }
  });

  it('refuses to delete the initial status', async () => {
    const res = await h.app.inject({ method: 'DELETE', url: '/api/v1/admin/returns/statuses/new', cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(409);
  });

  it('lets an admin add a custom status and a transition into it', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/returns/statuses',
      cookies: ADMIN_COOKIE,
      payload: { code: 'inspecting', name: { en: 'Inspecting' }, defaultName: 'Inspecting', weight: 35 },
    });
    expect(create.statusCode).toBe(201);

    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/returns/transitions',
      cookies: ADMIN_COOKIE,
      payload: {
        transitions: [
          { fromStatusCode: 'new', toStatusCode: 'authorized' },
          { fromStatusCode: 'authorized', toStatusCode: 'inspecting' },
          { fromStatusCode: 'inspecting', toStatusCode: 'resolved' },
          { fromStatusCode: 'resolved', toStatusCode: 'closed' },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const data = (put.json() as { data: { transitions: Array<{ fromStatusCode: string; toStatusCode: string }> } }).data;
    expect(
      data.transitions.some((t) => t.fromStatusCode === 'authorized' && t.toStatusCode === 'inspecting'),
    ).toBe(true);
  });
});
