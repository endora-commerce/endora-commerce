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

  it('lists with search, per-status counts, resolved names, and the new columns', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders?q=QA-LIST', ...admin });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{
        businessId: string;
        organizationName: string | null;
        statusName: Record<string, string>;
        createdAt: string;
        salesChannelId: string;
        salesChannelName: string | null;
        deliveryMethodName: string | null;
        shipToName: string | null;
        billToName: string | null;
      }>;
      pagination: { total: number };
      counts: Record<string, number>;
    };
    expect(body.pagination.total).toBe(3);
    expect(body.counts['new']).toBe(2);
    expect(body.counts['paid']).toBe(1);
    const a = body.data.find((r) => r.businessId === 'QA-LIST-A');
    expect(a?.organizationName).toBeTruthy();
    expect(a?.statusName['en']).toBe('New');
    // Feature: widened list row.
    expect(a?.createdAt).toBeTruthy();
    expect(a?.deliveryMethodName).toBe('DM');
    expect(a?.shipToName).toBe('A');
    expect(a?.billToName).toBe('A');
    expect(a).toHaveProperty('salesChannelName'); // null here (random channel id)
  });

  it('filters by a single status tab', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders?q=QA-LIST&status=new', ...admin });
    const body = res.json() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
  });

  it('filters by multiple statuses (repeated query param)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/orders?q=QA-LIST&status=new&status=paid',
      ...admin,
    });
    const body = res.json() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(3);
  });

  it('filters by total range', async () => {
    const above = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/orders?q=QA-LIST&totalMin=200',
      ...admin,
    });
    expect((above.json() as { pagination: { total: number } }).pagination.total).toBe(0);
    const within = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/orders?q=QA-LIST&totalMin=50&totalMax=150',
      ...admin,
    });
    expect((within.json() as { pagination: { total: number } }).pagination.total).toBe(3);
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

  it('saves, lists, and deletes a list view incl. visible columns', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/list-views',
      ...admin,
      payload: {
        name: 'EU unpaid',
        shared: false,
        filters: { status: ['new'] },
        sort: { field: 'placedAt', dir: 'desc' },
        visibleColumns: ['order', 'status', 'total'],
      },
    });
    expect(create.statusCode).toBe(201);
    const created = (create.json() as { data: { id: string; visibleColumns: string[] | null } }).data;
    expect(created.visibleColumns).toEqual(['order', 'status', 'total']);

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders/list-views', ...admin });
    const view = (list.json() as { data: Array<{ id: string; name: string; visibleColumns: string[] | null }> }).data.find(
      (v) => v.id === created.id,
    );
    expect(view?.name).toBe('EU unpaid');
    expect(view?.visibleColumns).toEqual(['order', 'status', 'total']);

    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/orders/list-views/${created.id}`, ...admin });
    expect(del.statusCode).toBe(200);
  });
});
