import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 046 (US8) — admin list with filters + counts, bulk transition, and
 * saved views.
 */
describe('returns — admin list, bulk, saved views (US8)', () => {
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

  it('lists cases with per-status counts and a kind filter', async () => {
    const a = await createCase();
    await createCase();
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${a}/authorize`, cookies: ADMIN_COOKIE });

    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns?kind=return', cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { rows: Array<{ kind: string }>; total: number; counts: Record<string, number> } }).data;
    expect(data.total).toBeGreaterThanOrEqual(2);
    expect(data.rows.every((r) => r.kind === 'return')).toBe(true);
    expect(data.counts['new']).toBeGreaterThanOrEqual(1);
    expect(data.counts['authorized']).toBeGreaterThanOrEqual(1);
  });

  it('filters by RMA number', async () => {
    const id = await createCase();
    const auth = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${id}/authorize`, cookies: ADMIN_COOKIE });
    const rma = (auth.json() as { data: { rmaNumber: string } }).data.rmaNumber;

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/returns?rmaNumber=${encodeURIComponent(rma)}`,
      cookies: ADMIN_COOKIE,
    });
    const rows = (res.json() as { data: { rows: Array<{ rmaNumber: string }> } }).data.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rmaNumber).toBe(rma);
  });

  it('bulk-transitions permitted cases and skips the rest', async () => {
    const a = await createCase(); // new
    const b = await createCase(); // new
    const c = await createCase();
    // Move c to a terminal status so it cannot go new → authorized.
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${c}/reject`, cookies: ADMIN_COOKIE, payload: { reason: 'x' } });

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/returns/bulk-transition',
      cookies: ADMIN_COOKIE,
      payload: { ids: [a, b, c], to: 'authorized' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { moved: string[]; skipped: Array<{ id: string }> } }).data;
    expect(data.moved.sort()).toEqual([a, b].sort());
    expect(data.skipped.map((s) => s.id)).toContain(c);
  });

  it('saves a shared view and reloads it', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/returns/list-views',
      cookies: ADMIN_COOKIE,
      payload: { name: 'Open returns', shared: true, filters: { kind: 'return' }, sort: { field: 'submittedAt', dir: 'desc' } },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { data: { id: string } }).data.id;

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/list-views', cookies: ADMIN_COOKIE });
    const views = (list.json() as { data: Array<{ id: string; name: string }> }).data;
    expect(views.some((v) => v.id === id && v.name === 'Open returns')).toBe(true);
  });

  it('exports the current view to CSV', async () => {
    await createCase();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/export?kind=return', cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.split('\r\n')[0]).toBe('rmaNumber,kind,orderId,statusCode,totalRefundAmount,currency,submittedAt');
    expect(Number(res.headers['x-export-row-count'])).toBeGreaterThanOrEqual(1);
  });
});
