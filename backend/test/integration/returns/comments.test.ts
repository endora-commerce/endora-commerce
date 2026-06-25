import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 046 (US4) — comment conversation with correct visibility/notify and
 * the terminal-case block.
 */
describe('returns — comments (US4)', () => {
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

  it('hides internal admin comments from the customer but shows visible ones', async () => {
    const id = await createCase();

    const internal = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/comments`,
      cookies: ADMIN_COOKIE,
      payload: { body: 'internal note', isCustomerVisible: false, notifyCustomer: false },
    });
    expect(internal.statusCode).toBe(201);

    const visible = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/comments`,
      cookies: ADMIN_COOKIE,
      payload: { body: 'hello customer', isCustomerVisible: true, notifyCustomer: true },
    });
    expect(visible.statusCode).toBe(201);

    // Admin sees both.
    const adminList = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}/comments`, cookies: ADMIN_COOKIE });
    expect((adminList.json() as { data: unknown[] }).data).toHaveLength(2);

    // Customer detail shows only the visible one.
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/returns/${id}`, cookies: CUSTOMER_COOKIE });
    const comments = (detail.json() as { data: { comments: Array<{ body: string; isCustomerVisible: boolean }> } }).data.comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe('hello customer');
  });

  it('lets the customer reply and the admin see it', async () => {
    const id = await createCase();
    const reply = await h.app.inject({
      method: 'POST',
      url: `/api/v1/returns/${id}/comments`,
      cookies: CUSTOMER_COOKIE,
      payload: { body: 'a customer question' },
    });
    expect(reply.statusCode).toBe(201);
    const dto = (reply.json() as { data: { authorKind: string; isCustomerVisible: boolean } }).data;
    expect(dto.authorKind).toBe('customer');
    expect(dto.isCustomerVisible).toBe(true);

    const adminList = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}/comments`, cookies: ADMIN_COOKIE });
    const bodies = (adminList.json() as { data: Array<{ body: string }> }).data.map((c) => c.body);
    expect(bodies).toContain('a customer question');
  });

  it('blocks commenting once the case is terminal', async () => {
    const id = await createCase();
    // Drive to a terminal status (rejected).
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/reject`,
      cookies: ADMIN_COOKIE,
      payload: { reason: 'not eligible' },
    });

    const adminComment = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/comments`,
      cookies: ADMIN_COOKIE,
      payload: { body: 'too late', isCustomerVisible: true, notifyCustomer: false },
    });
    expect(adminComment.statusCode).toBe(409);

    const customerComment = await h.app.inject({
      method: 'POST',
      url: `/api/v1/returns/${id}/comments`,
      cookies: CUSTOMER_COOKIE,
      payload: { body: 'me too' },
    });
    expect(customerComment.statusCode).toBe(409);
  });
});
