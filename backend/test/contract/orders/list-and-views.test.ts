import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AdminRole, AdminUser, Order } from '../../helpers/package-entities.js';

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
      await em.persist(order).flush();
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
        paymentMethodName: string | null;
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
    expect(a?.paymentMethodName).toBe('PM');
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
    const name = `EU unpaid ${randomUUID().slice(0, 8)}`;
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/list-views',
      ...admin,
      payload: {
        name,
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
    expect(view?.name).toBe(name);
    expect(view?.visibleColumns).toEqual(['order', 'status', 'total']);

    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/orders/list-views/${created.id}`, ...admin });
    expect(del.statusCode).toBe(200);
  });
});

/**
 * `specs/147-saved-views/` (FR-003, FR-013 – FR-015, FR-022; contract
 * `saved-list-views-api.md` §2 – §4) — the order list's saved views: trimmed
 * names, one key per owner, caller-relative flags, the gate on all four routes
 * and a fail-closed actor.
 *
 * Every name carries a per-run suffix: several files act as the shared stub
 * admin, and with the duplicate rule a fixed name would collide with another
 * file's leftover row. Lists are judged by membership, never by length.
 */
describe('Order saved views — names, ownership and the gate (spec 147)', () => {
  let h: BackendServerHandle;
  const URL = '/api/v1/admin/orders/list-views';
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const salesRep = { cookies: { b2b_session: 'stub-order-views-sales-rep-session' } };
  const noOrders = { cookies: { b2b_session: 'stub-order-views-no-orders-session' } };
  const polishAdmin = { cookies: { b2b_session: 'stub-order-views-polish-admin-session' } };
  const SALES_REP_ID = '00000000-0000-4000-8000-0000000147a1';
  const NO_ORDERS_ID = '00000000-0000-4000-8000-0000000147a2';
  const POLISH_ADMIN_ID = '00000000-0000-4000-8000-0000000147a3';
  const run = randomUUID().slice(0, 8);
  const sort = { field: 'placedAt', dir: 'desc' } as const;

  interface ViewItem {
    id: string;
    name: string;
    shared: boolean;
    ownerAdminUserId: string;
    ownedByCaller: boolean;
    canModify: boolean;
  }
  interface ErrorBody {
    error: { code: string; message: string };
  }

  async function createView(
    who: { cookies: Record<string, string> },
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: unknown }> {
    const res = await h.app.inject({ method: 'POST', url: URL, ...who, payload: { filters: {}, sort, ...payload } });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function listAs(who: { cookies: Record<string, string> }): Promise<ViewItem[]> {
    const res = await h.app.inject({ method: 'GET', url: URL, ...who });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: ViewItem[] }).data;
  }

  async function ensureAdmin(id: string, email: string, roleId: string): Promise<void> {
    const em = h.em();
    const existing = await em.findOne(AdminUser, { id });
    if (existing) {
      existing.adminRoleId = roleId;
      existing.status = 'active';
    } else {
      em.create(AdminUser, {
        id,
        email,
        passwordHash: 'x'.repeat(60),
        firstName: 'Saved',
        lastName: 'Views',
        adminRoleId: roleId,
        status: 'active',
      });
    }
    await em.flush();
  }

  /**
   * Permissions of every role this file widened, as they were before it did.
   * A role row is shared with every other file in the run (the scope keys on
   * the `sales_representative` code), so `afterAll` puts each one back. A role
   * this file created is left in place: the admins it seeds reference it and
   * `admin_users_admin_role_fk` is `on delete restrict`.
   */
  const widenedRoles = new Map<string, string[]>();

  async function ensureRole(code: string, permissions: string[]): Promise<string> {
    const em = h.em();
    let role = await em.findOne(AdminRole, { code });
    if (!role) {
      role = em.create(AdminRole, { code, name: code, permissions });
    } else {
      if (!widenedRoles.has(code)) widenedRoles.set(code, [...role.permissions]);
      role.permissions = Array.from(new Set([...role.permissions, ...permissions]));
    }
    await em.persist(role).flush();
    return role.id;
  }

  async function restoreWidenedRoles(): Promise<void> {
    const em = h.em();
    for (const [code, permissions] of widenedRoles) {
      const role = await em.findOne(AdminRole, { code });
      if (role) role.permissions = permissions;
    }
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    // The orders scope keys on this exact role code, so the row is shared with
    // every other file in the run: widen it with the one code these cases need.
    const salesRepRoleId = await ensureRole('sales_representative', ['orders:read']);
    const noOrdersRoleId = await ensureRole('order_views_no_orders', ['catalog:read']);
    const polishRoleId = await ensureRole('order_views_reader', ['orders:read']);
    await ensureAdmin(SALES_REP_ID, 'order-views-sales-rep@example.com', salesRepRoleId);
    await ensureAdmin(NO_ORDERS_ID, 'order-views-no-orders@example.com', noOrdersRoleId);
    await ensureAdmin(POLISH_ADMIN_ID, 'order-views-polish@example.com', polishRoleId);
  });

  afterAll(async () => {
    await restoreWidenedRoles();
    await teardownBackendServer(h);
  });

  it('stores a trimmed name and refuses whitespace-only and over-long names', async () => {
    const created = await createView(admin, { name: `  Trimmed ${run}  `, shared: false });
    expect(created.statusCode).toBe(201);
    expect((created.body as { data: ViewItem }).data.name).toBe(`Trimmed ${run}`);

    for (const name of ['   ', 'x'.repeat(161), `bidi\u202E${run}`]) {
      const res = await createView(admin, { name, shared: false });
      expect(res.statusCode).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a body over the bounds with 400', async () => {
    const tooBig = await createView(admin, {
      name: `Big ${run}`,
      shared: false,
      filters: { q: 'x'.repeat(9000) },
    });
    expect(tooBig.statusCode).toBe(400);
    expect((tooBig.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');

    const tooManyColumns = await createView(admin, {
      name: `Cols ${run}`,
      shared: false,
      visibleColumns: Array.from({ length: 65 }, (_, i) => `c${i}`),
    });
    expect(tooManyColumns.statusCode).toBe(400);

    const longSort = await createView(admin, {
      name: `Sort ${run}`,
      shared: false,
      sort: { field: 'f'.repeat(65), dir: 'asc' },
    });
    expect(longSort.statusCode).toBe(400);
  });

  it('refuses a second view whose name differs only by case and spaces — 409 in English', async () => {
    const first = await createView(admin, { name: `EU unpaid ${run}`, shared: false });
    expect(first.statusCode).toBe(201);
    const second = await createView(admin, { name: ` eu UNPAID ${run} `, shared: true });
    expect(second.statusCode).toBe(409);
    const error = (second.body as ErrorBody).error;
    expect(error.code).toBe('ORDER_SAVED_VIEW_NAME_TAKEN');
    expect(error.message).toBe(
      'You already have a saved view with this name on the order list. Choose a different name.',
    );
  });

  it('answers the conflict in Polish for an admin who prefers Polish', async () => {
    const lang = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      ...polishAdmin,
      payload: { preferredLanguage: 'pl' },
    });
    expect(lang.statusCode).toBe(200);
    const first = await createView(polishAdmin, { name: `Nieopłacone ${run}`, shared: false });
    expect(first.statusCode).toBe(201);
    const second = await createView(polishAdmin, { name: `nieopłacone ${run}`, shared: false });
    expect(second.statusCode).toBe(409);
    const error = (second.body as ErrorBody).error;
    expect(error.code).toBe('ORDER_SAVED_VIEW_NAME_TAKEN');
    expect(error.message).toBe('Masz już zapisany widok o tej nazwie na liście zamówień. Wybierz inną nazwę.');
  });

  it('refuses a PATCH renaming to a key the owner already uses', async () => {
    const a = await createView(admin, { name: `Rename A ${run}`, shared: false });
    const b = await createView(admin, { name: `Rename B ${run}`, shared: false });
    const bId = (b.body as { data: ViewItem }).data.id;
    expect(a.statusCode).toBe(201);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${bId}`,
      ...admin,
      payload: { name: ` rename a ${run}` },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrorBody).error.code).toBe('ORDER_SAVED_VIEW_NAME_TAKEN');
  });

  it('flags the owner\'s views and keeps a sales representative off a shared view it does not own', async () => {
    const shared = await createView(admin, { name: `Shared ${run}`, shared: true });
    const priv = await createView(admin, { name: `Private ${run}`, shared: false });
    const sharedId = (shared.body as { data: ViewItem }).data.id;
    const privId = (priv.body as { data: ViewItem }).data.id;

    const own = await listAs(admin);
    const ownShared = own.find((v) => v.id === sharedId);
    expect(ownShared).toMatchObject({ ownedByCaller: true, canModify: true });
    expect(own.find((v) => v.id === privId)).toMatchObject({ ownedByCaller: true, canModify: true });

    const repList = await listAs(salesRep);
    expect(repList.find((v) => v.id === sharedId)).toMatchObject({ ownedByCaller: false, canModify: false });
    expect(repList.some((v) => v.id === privId)).toBe(false);

    const del = await h.app.inject({ method: 'DELETE', url: `${URL}/${sharedId}`, ...salesRep });
    expect(del.statusCode).toBe(403);
    expect((del.json() as ErrorBody).error.code).toBe('FORBIDDEN');
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${sharedId}`,
      ...salesRep,
      payload: { shared: false },
    });
    expect(patch.statusCode).toBe(403);

    const delPrivate = await h.app.inject({ method: 'DELETE', url: `${URL}/${privId}`, ...salesRep });
    expect(delPrivate.statusCode).toBe(404);
    expect((delPrivate.json() as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('lets a non-representative role, a platform admin for saved views, modify a colleague\'s shared view', async () => {
    // Derived from the request's tenant context, as on the product and quote
    // request lists: every role except `sales_representative` reaches all.
    const shared = await createView(admin, { name: `Colleague shared ${run}`, shared: true });
    const sharedId = (shared.body as { data: ViewItem }).data.id;
    expect((await listAs(polishAdmin)).find((v) => v.id === sharedId)).toMatchObject({
      ownedByCaller: false,
      canModify: true,
    });
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${sharedId}`,
      ...polishAdmin,
      payload: { name: `Colleague renamed ${run}` },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { data: ViewItem }).data).toMatchObject({ name: `Colleague renamed ${run}`, canModify: true });
    const del = await h.app.inject({ method: 'DELETE', url: `${URL}/${sharedId}`, ...polishAdmin });
    expect(del.statusCode).toBe(200);
  });

  it('refuses an admin without orders:read on all four routes', async () => {
    const view = await createView(admin, { name: `Gate ${run}`, shared: true });
    const id = (view.body as { data: ViewItem }).data.id;
    const attempts = [
      { method: 'GET' as const, url: URL },
      { method: 'POST' as const, url: URL, payload: { name: `Denied ${run}`, shared: false, filters: {}, sort } },
      { method: 'PATCH' as const, url: `${URL}/${id}`, payload: { shared: false } },
      { method: 'DELETE' as const, url: `${URL}/${id}` },
    ];
    for (const attempt of attempts) {
      const res = await h.app.inject({ ...attempt, ...noOrders });
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(403);
      expect((res.json() as ErrorBody).error.code).toBe('FORBIDDEN');
    }
  });

  it('answers 401 on all four routes when no admin actor resolves, and writes nothing', async () => {
    const view = await createView(admin, { name: `Actorless target ${run}`, shared: true });
    const id = (view.body as { data: ViewItem }).data.id;
    const name = `Actorless ${run}`;
    const attempts = [
      { method: 'GET' as const, url: URL },
      { method: 'POST' as const, url: URL, payload: { name, shared: true, filters: {}, sort } },
      { method: 'PATCH' as const, url: `${URL}/${id}`, payload: { name } },
      { method: 'DELETE' as const, url: `${URL}/${id}` },
    ];
    for (const cookies of [{}, { b2b_session: 'stub-customer-session' }]) {
      for (const attempt of attempts) {
        const res = await h.app.inject({ ...attempt, cookies });
        expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(401);
      }
    }
    const listed = await listAs(admin);
    expect(listed.some((v) => v.name === name)).toBe(false);
    expect(listed.find((v) => v.id === id)?.name).toBe(`Actorless target ${run}`);
  });
});
