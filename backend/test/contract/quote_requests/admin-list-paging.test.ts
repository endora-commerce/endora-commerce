import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuoteRequestListPaginationSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const CUSTOMER = { cookies: { b2b_session: 'stub-customer-session' } };
const LIST = '/api/v1/admin/quote-requests';

interface Row {
  id: string;
  businessId: string;
  status: string;
  amount?: string | null;
  updatedAt: string;
}
interface ListBody {
  data: Row[];
  pagination: { page: number; pageSize: number; total: number; limit: number; hasMore: boolean; nextCursor: null };
}

/**
 * Issue #317 — `GET /api/v1/admin/quote-requests` reads one page on the
 * server: it honours a bounded page size, answers a `pagination` block that is
 * true for the response, and narrows and orders by `status`, `q` and `sort`
 * itself rather than handing the browser every request.
 */
describe('Admin quote request list — server-side page, filters and sort (issue #317)', () => {
  let h: BackendServerHandle;
  /** Three operator-created requests in one organization, worth 1, 1000 and 50. */
  const priced: Array<{ id: string; businessId: string; amount: number }> = [];
  let pendingId: string;
  let pendingBusinessId: string;

  async function list(query: string): Promise<ListBody> {
    const res = await h.app.inject({ method: 'GET', url: `${LIST}?${query}`, ...ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as ListBody;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    for (const price of [1, 1000, 50]) {
      const res = await h.app.inject({
        method: 'POST',
        url: LIST,
        ...ADMIN,
        payload: {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: price }],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const data = (res.json() as { data: { id: string; businessId: string } }).data;
      priced.push({ id: data.id, businessId: data.businessId, amount: price });
    }
    const pending = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      ...CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }] },
    });
    expect(pending.statusCode, pending.body).toBe(201);
    ({ id: pendingId, businessId: pendingBusinessId } = (pending.json() as { data: { id: string; businessId: string } }).data);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('honours the page size and reports the page, its size and the total', async () => {
    const all = await list('assignmentScope=all&pageSize=200');
    const total = all.pagination.total;
    expect(total).toBeGreaterThanOrEqual(4);
    expect(disagreements(deepStrict(adminQuoteRequestListPaginationSchema), all.pagination)).toEqual([]);

    const first = await list('assignmentScope=all&pageSize=2&page=1');
    expect(first.data).toHaveLength(2);
    expect(first.pagination).toEqual({ page: 1, pageSize: 2, total, limit: 2, hasMore: true, nextCursor: null });

    const second = await list('assignmentScope=all&pageSize=2&page=2');
    expect(second.pagination.page).toBe(2);
    expect(second.data.some((r) => first.data.some((f) => f.id === r.id))).toBe(false);
    // The pages are the one ordering, cut: page 2 continues page 1.
    expect(all.data.slice(0, 4).map((r) => r.id)).toEqual([...first.data, ...second.data].map((r) => r.id));

    const past = await list(`assignmentScope=all&pageSize=2&page=${Math.ceil(total / 2) + 1}`);
    expect(past.data).toEqual([]);
    expect(past.pagination.total).toBe(total);
    expect(past.pagination.hasMore).toBe(false);
  });

  it('defaults to a bounded first page and refuses a page size over the bound', async () => {
    const res = await h.app.inject({ method: 'GET', url: LIST, ...ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as ListBody;
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(25);
    expect(body.data.length).toBeLessThanOrEqual(25);

    const refused = await h.app.inject({ method: 'GET', url: `${LIST}?pageSize=201`, ...ADMIN });
    expect(refused.statusCode, refused.body).toBe(400);
  });

  it('narrows by status on the server', async () => {
    const body = await list(`assignmentScope=all&pageSize=200&status=${encodeURIComponent('Created from admin')}`);
    expect(body.data.length).toBeGreaterThan(0);
    expect(new Set(body.data.map((r) => r.status))).toEqual(new Set(['Created from admin']));
    expect(body.data.map((r) => r.id)).toEqual(expect.arrayContaining(priced.map((p) => p.id)));
    expect(body.data.map((r) => r.id)).not.toContain(pendingId);
    expect(body.pagination.total).toBe(body.data.length);
  });

  it('searches the business id on the server', async () => {
    const target = priced[1]!;
    const body = await list(`assignmentScope=all&pageSize=200&q=${encodeURIComponent(target.businessId)}`);
    expect(body.data.map((r) => r.id)).toContain(target.id);
    for (const other of priced.filter((p) => !p.businessId.includes(target.businessId))) {
      expect(body.data.map((r) => r.id)).not.toContain(other.id);
    }
    if (!pendingBusinessId.includes(target.businessId)) expect(body.data.map((r) => r.id)).not.toContain(pendingId);
  });

  it('finds a request by its whole id', async () => {
    const target = priced[2]!;
    const body = await list(`assignmentScope=all&pageSize=200&q=${target.id}`);
    expect(body.data.map((r) => r.id)).toEqual([target.id]);
  });

  it('sorts by the amount on the server, either way', async () => {
    const base = `assignmentScope=all&pageSize=200&organizationId=${TEST_ORGANIZATION_ID}&status=${encodeURIComponent('Created from admin')}`;
    const ours = (rows: Row[]): string[] => rows.map((r) => r.id).filter((id) => priced.some((p) => p.id === id));
    const byAmount = (dir: 1 | -1): string[] =>
      [...priced].sort((a, b) => (a.amount - b.amount) * dir).map((p) => p.id);

    const desc = await list(`${base}&sort=total:desc`);
    expect(ours(desc.data)).toEqual(byAmount(-1));
    const amounts = desc.data.map((r) => Number(r.amount ?? 0));
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));

    const asc = await list(`${base}&sort=total:asc`);
    expect(ours(asc.data)).toEqual(byAmount(1));
  });

  it('sorts by the last change by default, newest first', async () => {
    const body = await list('assignmentScope=all&pageSize=200');
    const times = body.data.map((r) => Date.parse(r.updatedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const oldestFirst = await list('assignmentScope=all&pageSize=200&sort=updatedAt:asc');
    const ascending = oldestFirst.data.map((r) => Date.parse(r.updatedAt));
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
  });
});
