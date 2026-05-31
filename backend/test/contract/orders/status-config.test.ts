import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 038 (US1) — admin status-graph configuration endpoints.
 * Assertions are tolerant of other suites mutating `order_statuses`
 * concurrently (the 9 seeded defaults always exist).
 */
describe('Admin order status configuration', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET /statuses returns the seeded graph with `new` initial and terminals', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders/statuses', ...admin });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as {
      data: {
        statuses: Array<{ code: string; isInitial: boolean; isTerminal: boolean }>;
        transitions: Array<{ fromStatusCode: string; toStatusCode: string }>;
      };
    }).data;
    const codes = data.statuses.map((s) => s.code);
    for (const c of ['new', 'pending', 'paid', 'processing', 'shipment_ready', 'shipment_sent', 'completed', 'on_hold', 'cancelled']) {
      expect(codes).toContain(c);
    }
    expect(data.statuses.find((s) => s.code === 'new')?.isInitial).toBe(true);
    expect(data.statuses.find((s) => s.code === 'completed')?.isTerminal).toBe(true);
    expect(data.transitions).toContainEqual(expect.objectContaining({ fromStatusCode: 'new', toStatusCode: 'pending' }));
  });

  it('refuses to delete the initial status `new` (409)', async () => {
    const res = await h.app.inject({ method: 'DELETE', url: '/api/v1/admin/orders/statuses/new', ...admin });
    expect(res.statusCode).toBe(409);
  });

  it('creates, lists, and deletes a custom status', async () => {
    const code = `qa_hold_${Date.now()}`;
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/statuses',
      ...admin,
      payload: { code, name: { en: 'QA hold' }, weight: 35 },
    });
    expect(create.statusCode).toBe(201);

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders/statuses', ...admin });
    const codes = (list.json() as { data: { statuses: Array<{ code: string }> } }).data.statuses.map((s) => s.code);
    expect(codes).toContain(code);

    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/orders/statuses/${code}`, ...admin });
    expect(del.statusCode).toBe(200);
  });

  it('adds and removes a transition edge', async () => {
    const add = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/orders/transitions',
      ...admin,
      payload: { add: [{ fromStatusCode: 'paid', toStatusCode: 'shipment_ready' }] },
    });
    expect(add.statusCode).toBe(200);
    const after = (add.json() as { data: { transitions: Array<{ fromStatusCode: string; toStatusCode: string }> } }).data;
    expect(after.transitions).toContainEqual(
      expect.objectContaining({ fromStatusCode: 'paid', toStatusCode: 'shipment_ready' }),
    );

    const remove = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/orders/transitions',
      ...admin,
      payload: { remove: [{ fromStatusCode: 'paid', toStatusCode: 'shipment_ready' }] },
    });
    expect(remove.statusCode).toBe(200);
  });

  it('rejects an edge from a terminal status (422)', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/orders/transitions',
      ...admin,
      payload: { add: [{ fromStatusCode: 'completed', toStatusCode: 'new' }] },
    });
    expect(res.statusCode).toBe(422);
  });
});
