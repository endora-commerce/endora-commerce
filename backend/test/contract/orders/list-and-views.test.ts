import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';

/**
 * Feature 038 (US2) — admin orders list (filter/sort/search + counts),
 * bulk status change with mixed eligibility, CSV export, saved views.
 */
describe('Admin orders list, bulk, export, saved views', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const [key, status, biz] of [
      ['a', 'new', 'QA-LIST-A'],
      ['b', 'new', 'QA-LIST-B'],
      ['c', 'paid', 'QA-LIST-C'],
    ] as const) {
      const order = em.create(Order, {
        businessId: biz,
        organizationId: TEST_ORGANIZATION_ID,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: randomUUID(),
        status,
        deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        deliveryMethodId: randomUUID(),
        deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
        paymentMethodId: randomUUID(),
        paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
        subtotal: '100.00',
        taxTotal: '0.00',
        deliveryTotal: '0.00',
        total: '100.00',
        currency: 'PLN',
        placedAt: new Date(),
      });
      await em.persistAndFlush(order);
      ids[key] = order.id;
    }
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists with search, per-status counts, and resolved names', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders?q=QA-LIST', ...admin });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ businessId: string; organizationName: string | null; statusName: Record<string, string> }>;
      pagination: { total: number };
      counts: Record<string, number>;
    };
    expect(body.pagination.total).toBe(3);
    expect(body.counts['new']).toBe(2);
    expect(body.counts['paid']).toBe(1);
    const a = body.data.find((r) => r.businessId === 'QA-LIST-A');
    expect(a?.organizationName).toBeTruthy();
    expect(a?.statusName['en']).toBe('New');
  });

  it('filters by status tab', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders?q=QA-LIST&status=new', ...admin });
    const body = res.json() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
  });

  it('bulk status: moves eligible, reports skipped with reasons', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/bulk/status',
      ...admin,
      payload: {
        orderIds: [ids['a'], ids['b'], ids['c'], '00000000-0000-4000-8000-00000000dead'],
        toStatusCode: 'pending',
      },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as {
      data: { changed: string[]; skipped: Array<{ orderId: string; reason: string }> };
    }).data;
    expect(data.changed).toEqual(expect.arrayContaining([ids['a'], ids['b']]));
    expect(data.changed).not.toContain(ids['c']); // paid -> pending has no edge
    const reasons = Object.fromEntries(data.skipped.map((s) => [s.orderId, s.reason]));
    expect(reasons[ids['c']!]).toBe('invalid_transition');
    expect(reasons['00000000-0000-4000-8000-00000000dead']).toBe('not_found');
  });

  it('exports CSV reflecting the current filters', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders/export?q=QA-LIST', ...admin });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('businessId');
    expect(res.body).toContain('QA-LIST-C');
  });

  it('prints bulk invoices as a single PDF', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/bulk/print-invoices',
      ...admin,
      payload: { orderIds: [ids['a'], ids['b']] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.startsWith('%PDF-')).toBe(true);
  });

  it('saves, lists, and deletes a list view', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/list-views',
      ...admin,
      payload: { name: 'EU unpaid', shared: false, filters: { status: 'new' }, sort: { field: 'placedAt', dir: 'desc' } },
    });
    expect(create.statusCode).toBe(201);
    const viewId = (create.json() as { data: { id: string } }).data.id;

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders/list-views', ...admin });
    const names = (list.json() as { data: Array<{ id: string; name: string }> }).data.map((v) => v.name);
    expect(names).toContain('EU unpaid');

    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/orders/list-views/${viewId}`, ...admin });
    expect(del.statusCode).toBe(200);
  });
});
