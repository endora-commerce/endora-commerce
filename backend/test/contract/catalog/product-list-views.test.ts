import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';

/**
 * `specs/147-saved-views/` US2 (FR-008 – FR-015, FR-022; contract
 * `saved-list-views-api.md` §2 – §4) — the product list's saved views over
 * HTTP: trimmed names, one key per owner, caller-relative flags, the
 * `catalog:read` gate on all four routes, a fail-closed actor, and the static
 * `list-views` segment winning over `products/:id`.
 *
 * "Platform admin (for saved views)" is any role except `sales_representative`
 * (spec *Vocabulary*, owner ruling A; research R-7) — so the catalogue reader
 * below, on a custom role, may modify a colleague's shared view, while the
 * sales representative may not.
 *
 * Every name carries a per-run suffix: several files act as the shared stub
 * admin, and with the duplicate rule a fixed name would collide with another
 * file's leftover row. Lists are judged by membership, never by length.
 */
describe('Product saved views — names, ownership and the gate (spec 147)', () => {
  let h: BackendServerHandle;
  const URL = '/api/v1/admin/catalog/products/list-views';
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const catalogReader = { cookies: { b2b_session: 'stub-product-views-catalog-reader-session' } };
  const salesRep = { cookies: { b2b_session: 'stub-product-views-sales-rep-session' } };
  const noCatalog = { cookies: { b2b_session: 'stub-product-views-no-catalog-session' } };
  const CATALOG_READER_ID = '00000000-0000-4000-8000-0000000147b1';
  const SALES_REP_ID = '00000000-0000-4000-8000-0000000147b2';
  const NO_CATALOG_ID = '00000000-0000-4000-8000-0000000147b3';
  const run = randomUUID().slice(0, 8);

  interface ViewItem {
    id: string;
    name: string;
    shared: boolean;
    ownerAdminUserId: string;
    ownedByCaller: boolean;
    canModify: boolean;
    filters: Record<string, unknown>;
  }
  interface ErrorBody {
    error: { code: string; message: string };
  }
  type Who = { cookies: Record<string, string> };

  async function createView(who: Who, payload: Record<string, unknown>): Promise<{ statusCode: number; body: unknown }> {
    const res = await h.app.inject({ method: 'POST', url: URL, ...who, payload: { filters: {}, ...payload } });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function createdId(who: Who, payload: Record<string, unknown>): Promise<string> {
    const res = await createView(who, payload);
    expect(res.statusCode).toBe(201);
    return (res.body as { data: ViewItem }).data.id;
  }

  async function listAs(who: Who): Promise<ViewItem[]> {
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
        firstName: 'Product',
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
    // The tenant scope keys on this exact role code, so the row is shared with
    // every other file in the run. The seeded list already holds
    // `catalog:read`; the merge only makes that an assertion of this file
    // rather than an assumption about the seed.
    const salesRepRoleId = await ensureRole('sales_representative', ['catalog:read']);
    const readerRoleId = await ensureRole('product_views_catalog_reader', ['catalog:read']);
    const noCatalogRoleId = await ensureRole('product_views_no_catalog', ['orders:read']);
    await ensureAdmin(CATALOG_READER_ID, 'product-views-catalog-reader@example.com', readerRoleId);
    await ensureAdmin(SALES_REP_ID, 'product-views-sales-rep@example.com', salesRepRoleId);
    await ensureAdmin(NO_CATALOG_ID, 'product-views-no-catalog@example.com', noCatalogRoleId);
  });

  afterAll(async () => {
    await restoreWidenedRoles();
    await teardownBackendServer(h);
  });

  it('answers the views envelope on GET list-views, not a product 404 (route precedence)', async () => {
    const res = await h.app.inject({ method: 'GET', url: URL, ...admin });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.json() as { data: unknown }).data)).toBe(true);
  });

  it('lets the platform admin save a trimmed view, list it with both flags, and delete it', async () => {
    const created = await createView(admin, {
      name: `  In stock ${run}  `,
      shared: false,
      filters: { status: 'active', type: 'simple', q: 'bolt' },
    });
    expect(created.statusCode).toBe(201);
    const view = (created.body as { data: ViewItem }).data;
    expect(view.name).toBe(`In stock ${run}`);
    expect(view.filters).toEqual({ status: 'active', type: 'simple', q: 'bolt' });

    const listed = (await listAs(admin)).find((v) => v.id === view.id);
    expect(listed).toMatchObject({ name: `In stock ${run}`, ownedByCaller: true, canModify: true });

    const del = await h.app.inject({ method: 'DELETE', url: `${URL}/${view.id}`, ...admin });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ data: { deleted: view.id } });
    expect((await listAs(admin)).some((v) => v.id === view.id)).toBe(false);
  });

  it('does not store or echo a sort or visible columns sent in the body', async () => {
    const created = await createView(admin, {
      name: `No sort ${run}`,
      shared: false,
      sort: { field: 'name', dir: 'asc' },
      visibleColumns: ['sku', 'name'],
    });
    expect(created.statusCode).toBe(201);
    const view = (created.body as { data: Record<string, unknown> }).data;
    expect(view).not.toHaveProperty('sort');
    expect(view).not.toHaveProperty('visibleColumns');
    const listed = (await listAs(admin)).find((v) => v.id === view['id']) as Record<string, unknown> | undefined;
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('sort');
    expect(listed).not.toHaveProperty('visibleColumns');
  });

  it('lets an admin holding only catalog:read save, list and delete its own private and shared views', async () => {
    const privId = await createdId(catalogReader, { name: `Reader private ${run}`, shared: false });
    const sharedId = await createdId(catalogReader, { name: `Reader shared ${run}`, shared: true });

    const own = await listAs(catalogReader);
    expect(own.find((v) => v.id === privId)).toMatchObject({ shared: false, ownedByCaller: true, canModify: true });
    expect(own.find((v) => v.id === sharedId)).toMatchObject({ shared: true, ownedByCaller: true, canModify: true });

    for (const id of [privId, sharedId]) {
      const del = await h.app.inject({ method: 'DELETE', url: `${URL}/${id}`, ...catalogReader });
      expect(del.statusCode).toBe(200);
    }
    const after = (await listAs(catalogReader)).map((v) => v.id);
    expect(after).not.toContain(privId);
    expect(after).not.toContain(sharedId);
  });

  it('refuses whitespace-only and over-long names with 400', async () => {
    for (const name of ['   ', 'x'.repeat(161), `bidi‮${run}`]) {
      const res = await createView(admin, { name, shared: false });
      expect(res.statusCode).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a second view whose name differs only by case and spaces — 409 in the catalog bundle\'s words', async () => {
    const first = await createView(admin, { name: `X ${run}`, shared: false });
    expect(first.statusCode).toBe(201);
    const second = await createView(admin, { name: ` x ${run} `, shared: true });
    expect(second.statusCode).toBe(409);
    const error = (second.body as ErrorBody).error;
    expect(error.code).toBe('PRODUCT_SAVED_VIEW_NAME_TAKEN');
    expect(error.message).toBe(
      'You already have a saved view with this name on the product list. Choose a different name.',
    );

    // A rename onto a taken key is refused the same way.
    const otherId = await createdId(admin, { name: `Y ${run}`, shared: false });
    const rename = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${otherId}`,
      ...admin,
      payload: { name: ` X ${run}` },
    });
    expect(rename.statusCode).toBe(409);
    expect((rename.json() as ErrorBody).error.code).toBe('PRODUCT_SAVED_VIEW_NAME_TAKEN');
  });

  it('keeps a sales representative off a shared view it does not own, while a platform admin may delete it', async () => {
    const sharedId = await createdId(catalogReader, { name: `Rep target ${run}`, shared: true });

    const repList = await listAs(salesRep);
    expect(repList.find((v) => v.id === sharedId)).toMatchObject({ ownedByCaller: false, canModify: false });

    const repDelete = await h.app.inject({ method: 'DELETE', url: `${URL}/${sharedId}`, ...salesRep });
    expect(repDelete.statusCode).toBe(403);
    expect((repDelete.json() as ErrorBody).error.code).toBe('FORBIDDEN');
    const repPatch = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${sharedId}`,
      ...salesRep,
      payload: { shared: false },
    });
    expect(repPatch.statusCode).toBe(403);

    const adminDelete = await h.app.inject({ method: 'DELETE', url: `${URL}/${sharedId}`, ...admin });
    expect(adminDelete.statusCode).toBe(200);
  });

  it('treats another admin\'s private view as absent — 404', async () => {
    const privId = await createdId(catalogReader, { name: `Reader secret ${run}`, shared: false });
    expect((await listAs(salesRep)).some((v) => v.id === privId)).toBe(false);
    const del = await h.app.inject({ method: 'DELETE', url: `${URL}/${privId}`, ...salesRep });
    expect(del.statusCode).toBe(404);
    expect((del.json() as ErrorBody).error.code).toBe('NOT_FOUND');
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${privId}`,
      ...admin,
      payload: { shared: true },
    });
    expect(patch.statusCode).toBe(404);
  });

  it('lets the catalogue reader, a platform admin for saved views, modify a colleague\'s shared view', async () => {
    const sharedId = await createdId(admin, { name: `Colleague shared ${run}`, shared: true });
    const seen = (await listAs(catalogReader)).find((v) => v.id === sharedId);
    expect(seen).toMatchObject({ ownedByCaller: false, canModify: true });
    const del = await h.app.inject({ method: 'DELETE', url: `${URL}/${sharedId}`, ...catalogReader });
    expect(del.statusCode).toBe(200);
  });

  it('refuses an admin without catalog:read on all four routes', async () => {
    const id = await createdId(admin, { name: `Gate ${run}`, shared: true });
    const attempts = [
      { method: 'GET' as const, url: URL },
      { method: 'POST' as const, url: URL, payload: { name: `Denied ${run}`, shared: false, filters: {} } },
      { method: 'PATCH' as const, url: `${URL}/${id}`, payload: { shared: false } },
      { method: 'DELETE' as const, url: `${URL}/${id}` },
    ];
    for (const attempt of attempts) {
      const res = await h.app.inject({ ...attempt, ...noCatalog });
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(403);
      expect((res.json() as ErrorBody).error.code).toBe('FORBIDDEN');
    }
  });

  it('answers 401 on all four routes when no admin actor resolves, and writes nothing', async () => {
    const id = await createdId(admin, { name: `Actorless target ${run}`, shared: true });
    const name = `Actorless ${run}`;
    const attempts = [
      { method: 'GET' as const, url: URL },
      { method: 'POST' as const, url: URL, payload: { name, shared: true, filters: {} } },
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
