import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  AdminRole,
  AdminUser,
  OrganizationSalesRepAssignment,
  QuoteRequest,
} from '../../helpers/package-entities.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/147-saved-views/` US3 (FR-008 – FR-018, FR-022; contract
 * `saved-list-views-api.md` §2 – §4) — the Quote Request list's saved views
 * over HTTP: trimmed names, one key per owner, caller-relative flags, the
 * `rfqs:handle` gate on all four routes, a fail-closed actor, the static
 * `list-views` segment winning over `quote-requests/:id`, and `sort` and
 * `visibleColumns` round-tripped.
 *
 * "Platform admin (for saved views)" is any role except `sales_representative`
 * (spec *Vocabulary*, owner ruling A; research R-7) — so the handler below, on
 * a custom role, may modify a colleague's shared view, while the sales
 * representative may not.
 *
 * Every name carries a per-run suffix: several files act as the shared stub
 * admin, and with the duplicate rule a fixed name would collide with another
 * file's leftover row. Lists are judged by membership, never by length.
 */
describe('Quote Request saved views — names, ownership and the gate (spec 147)', () => {
  let h: BackendServerHandle;
  const URL = '/api/v1/admin/quote-requests/list-views';
  const LIST_URL = '/api/v1/admin/quote-requests';
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const salesRep = { cookies: { b2b_session: 'stub-rfq-views-sales-rep-session' } };
  const handler = { cookies: { b2b_session: 'stub-rfq-views-handler-session' } };
  const noRfqs = { cookies: { b2b_session: 'stub-rfq-views-no-rfqs-session' } };
  const SALES_REP_ID = '00000000-0000-4000-8000-0000000147c1';
  const HANDLER_ID = '00000000-0000-4000-8000-0000000147c2';
  const NO_RFQS_ID = '00000000-0000-4000-8000-0000000147c3';
  const run = randomUUID().slice(0, 8);

  /** One quote request in each organization, seeded by this file. */
  let ownOrgRfqId: string;
  let otherOrgRfqId: string;

  interface ViewItem {
    id: string;
    name: string;
    shared: boolean;
    ownerAdminUserId: string;
    ownedByCaller: boolean;
    canModify: boolean;
    filters: Record<string, unknown>;
    sort?: { field: string; dir: 'asc' | 'desc' } | null;
    visibleColumns?: string[] | null;
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

  /** Replays a view's captured filters on the list, as the page does, and answers the ids returned. */
  async function replay(who: Who, filters: Record<string, unknown>): Promise<string[]> {
    // The largest page (issue #317): these cases are about the reach, not the paging.
    const params = new URLSearchParams({ pageSize: '200' });
    if (typeof filters['scope'] === 'string') params.set('assignmentScope', filters['scope']);
    if (typeof filters['organizationId'] === 'string') params.set('organizationId', filters['organizationId']);
    const res = await h.app.inject({ method: 'GET', url: `${LIST_URL}?${params.toString()}`, ...who });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
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
        firstName: 'Rfq',
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
    await em.persistAndFlush(role);
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

  async function ensureAssignment(adminUserId: string, organizationId: string): Promise<void> {
    const em = h.em();
    const existing = await em.findOne(OrganizationSalesRepAssignment, { adminUserId, organizationId });
    if (!existing) {
      await em.persistAndFlush(em.create(OrganizationSalesRepAssignment, { adminUserId, organizationId }));
    }
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('test seed: quote request saved views', async () => {
      // The tenant scope keys on this exact role code, so the row is shared
      // with every other file in the run; the merge only makes `rfqs:handle`
      // an assertion of this file rather than an assumption about the seed.
      const salesRepRoleId = await ensureRole('sales_representative', ['rfqs:handle']);
      const handlerRoleId = await ensureRole('rfq_views_handler', ['rfqs:handle']);
      const noRfqsRoleId = await ensureRole('rfq_views_no_rfqs', ['orders:read']);
      await ensureAdmin(SALES_REP_ID, 'rfq-views-sales-rep@example.com', salesRepRoleId);
      await ensureAdmin(HANDLER_ID, 'rfq-views-handler@example.com', handlerRoleId);
      await ensureAdmin(NO_RFQS_ID, 'rfq-views-no-rfqs@example.com', noRfqsRoleId);

      await seedOtherTestOrganization(h.em());
      // The representative reaches the first organization only; the handler
      // is assigned the other one, so `scope: 'mine'` means a different set
      // for each of them.
      await ensureAssignment(SALES_REP_ID, TEST_ORGANIZATION_ID);
      await ensureAssignment(HANDLER_ID, OTHER_TEST_ORGANIZATION_ID);

      const em = h.em();
      const ownOrg = em.create(QuoteRequest, {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: randomUUID(),
      });
      const otherOrg = em.create(QuoteRequest, {
        organizationId: OTHER_TEST_ORGANIZATION_ID,
        customerAccountId: randomUUID(),
      });
      await em.persistAndFlush([ownOrg, otherOrg]);
      ownOrgRfqId = ownOrg.id;
      otherOrgRfqId = otherOrg.id;
    });
  });

  afterAll(async () => {
    // The two assignments are removed so no other file's "unassigned
    // organization" reading changes with this one's presence in the run.
    await withSystemScope('test cleanup: quote request saved views', async () => {
      const em = h.em();
      const rows = await em.find(OrganizationSalesRepAssignment, {
        $or: [
          { adminUserId: SALES_REP_ID, organizationId: TEST_ORGANIZATION_ID },
          { adminUserId: HANDLER_ID, organizationId: OTHER_TEST_ORGANIZATION_ID },
        ],
      });
      if (rows.length > 0) await em.removeAndFlush(rows);
      await restoreWidenedRoles();
    });
    await teardownBackendServer(h);
  });

  it('answers the views envelope on GET list-views, not a quote request 404 (route precedence)', async () => {
    const res = await h.app.inject({ method: 'GET', url: URL, ...admin });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.json() as { data: unknown }).data)).toBe(true);
  });

  it('lets the platform admin save a trimmed view with sort and columns, list it with both flags, and delete it', async () => {
    const created = await createView(admin, {
      name: `  Open EU ${run}  `,
      shared: false,
      filters: { scope: 'all', status: ['New', 'Quoted'], q: 'bolt' },
      sort: { field: 'total', dir: 'desc' },
      visibleColumns: ['businessId', 'organization', 'total'],
    });
    expect(created.statusCode).toBe(201);
    const view = (created.body as { data: ViewItem }).data;
    expect(view.name).toBe(`Open EU ${run}`);
    expect(view.filters).toEqual({ scope: 'all', status: ['New', 'Quoted'], q: 'bolt' });
    expect(view.sort).toEqual({ field: 'total', dir: 'desc' });
    expect(view.visibleColumns).toEqual(['businessId', 'organization', 'total']);

    const listed = (await listAs(admin)).find((v) => v.id === view.id);
    expect(listed).toMatchObject({
      name: `Open EU ${run}`,
      ownedByCaller: true,
      canModify: true,
      sort: { field: 'total', dir: 'desc' },
      visibleColumns: ['businessId', 'organization', 'total'],
    });

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${view.id}`,
      ...admin,
      payload: { sort: { field: 'updatedAt', dir: 'asc' }, visibleColumns: null },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { data: ViewItem }).data).toMatchObject({
      sort: { field: 'updatedAt', dir: 'asc' },
      visibleColumns: null,
    });

    const del = await h.app.inject({ method: 'DELETE', url: `${URL}/${view.id}`, ...admin });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ data: { deleted: view.id } });
    expect((await listAs(admin)).some((v) => v.id === view.id)).toBe(false);
  });

  it('stores a view without sort or columns as null for both', async () => {
    const created = await createView(admin, { name: `Bare ${run}`, shared: false });
    expect(created.statusCode).toBe(201);
    const view = (created.body as { data: ViewItem }).data;
    expect(view.sort).toBeNull();
    expect(view.visibleColumns).toBeNull();
  });

  it('refuses whitespace-only and over-long names with 400', async () => {
    for (const name of ['   ', 'x'.repeat(161), `bidi‮${run}`]) {
      const res = await createView(admin, { name, shared: false });
      expect(res.statusCode).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a second view whose name differs only by case and spaces — 409 in the quote_requests bundle\'s words', async () => {
    const first = await createView(admin, { name: `X ${run}`, shared: false });
    expect(first.statusCode).toBe(201);
    const second = await createView(admin, { name: ` x ${run} `, shared: true });
    expect(second.statusCode).toBe(409);
    const error = (second.body as ErrorBody).error;
    expect(error.code).toBe('RFQ_SAVED_VIEW_NAME_TAKEN');
    expect(error.message).toBe(
      'You already have a saved view with this name on the quote request list. Choose a different name.',
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
    expect((rename.json() as ErrorBody).error.code).toBe('RFQ_SAVED_VIEW_NAME_TAKEN');
  });

  it('keeps a sales representative off the platform admin\'s shared view, while the platform admin may delete the representative\'s', async () => {
    const adminShared = await createdId(admin, { name: `Admin shared ${run}`, shared: true });

    const repList = await listAs(salesRep);
    expect(repList.find((v) => v.id === adminShared)).toMatchObject({ ownedByCaller: false, canModify: false });

    const repDelete = await h.app.inject({ method: 'DELETE', url: `${URL}/${adminShared}`, ...salesRep });
    expect(repDelete.statusCode).toBe(403);
    expect((repDelete.json() as ErrorBody).error.code).toBe('FORBIDDEN');
    const repPatch = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${adminShared}`,
      ...salesRep,
      payload: { shared: false },
    });
    expect(repPatch.statusCode).toBe(403);

    const repShared = await createdId(salesRep, { name: `Rep shared ${run}`, shared: true });
    expect((await listAs(salesRep)).find((v) => v.id === repShared)).toMatchObject({
      ownedByCaller: true,
      canModify: true,
    });
    const adminDelete = await h.app.inject({ method: 'DELETE', url: `${URL}/${repShared}`, ...admin });
    expect(adminDelete.statusCode).toBe(200);
  });

  it('treats another admin\'s private view as absent — 404', async () => {
    const privId = await createdId(handler, { name: `Handler secret ${run}`, shared: false });
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

  it('lets the handler, a platform admin for saved views, modify a colleague\'s shared view', async () => {
    const sharedId = await createdId(admin, { name: `Colleague shared ${run}`, shared: true });
    const seen = (await listAs(handler)).find((v) => v.id === sharedId);
    expect(seen).toMatchObject({ ownedByCaller: false, canModify: true });
    const del = await h.app.inject({ method: 'DELETE', url: `${URL}/${sharedId}`, ...handler });
    expect(del.statusCode).toBe(200);
  });

  it('refuses an admin without rfqs:handle on all four routes, exactly as on the quote request list', async () => {
    const list = await h.app.inject({ method: 'GET', url: LIST_URL, ...noRfqs });
    expect(list.statusCode).toBe(403);
    expect((list.json() as ErrorBody).error.code).toBe('FORBIDDEN');

    const id = await createdId(admin, { name: `Gate ${run}`, shared: true });
    const attempts = [
      { method: 'GET' as const, url: URL },
      { method: 'POST' as const, url: URL, payload: { name: `Denied ${run}`, shared: false, filters: {} } },
      { method: 'PATCH' as const, url: `${URL}/${id}`, payload: { shared: false } },
      { method: 'DELETE' as const, url: `${URL}/${id}` },
    ];
    for (const attempt of attempts) {
      const res = await h.app.inject({ ...attempt, ...noRfqs });
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

  /**
   * FR-016 (US3-4, US3-5). A loaded view only sets the page's state; the list
   * request that follows is the loader's own.
   *
   * **What holds the narrowing in this harness is the tenant guard, not
   * `RfqAdminService.listAll`.** The harness's `rfqAdminContextResolver`
   * answers `isPlatformAdmin: … || true` (`test/helpers/test-server.ts`), so
   * the service's own sales-representative filter is bypassed here. What this
   * case observes is `QuoteRequest` being `@OrgScoped`: the representative's
   * request runs in `allowed-set` mode, and the `org` filter keeps the other
   * organization's rows out whatever `organizationId` the view names. A
   * failure here is therefore a **tenant-guard regression**, not a saved-views
   * bug. The two positive controls are what make the empty answer a
   * measurement rather than a seed that never landed.
   */
  it('replays a shared view naming another organization without widening the representative\'s list (FR-016)', async () => {
    const created = await createView(admin, {
      name: `Other org ${run}`,
      shared: true,
      filters: { scope: 'all', organizationId: OTHER_TEST_ORGANIZATION_ID },
    });
    expect(created.statusCode).toBe(201);
    const viewId = (created.body as { data: ViewItem }).data.id;

    const readBack = (await listAs(salesRep)).find((v) => v.id === viewId);
    expect(readBack).toBeDefined();
    expect(readBack?.filters).toEqual({ scope: 'all', organizationId: OTHER_TEST_ORGANIZATION_ID });

    // Positive control: the platform admin's replay does reach the row.
    expect(await replay(admin, readBack!.filters)).toContain(otherOrgRfqId);
    // Positive control: the representative does reach its own organization.
    expect(await replay(salesRep, { scope: 'all' })).toContain(ownOrgRfqId);

    const repRows = await replay(salesRep, readBack!.filters);
    expect(repRows).not.toContain(otherOrgRfqId);
    expect(repRows).not.toContain(ownOrgRfqId);
  });

  it('resolves a view saved with scope "mine" against whoever loads it, not the saver (US3-3)', async () => {
    const created = await createView(handler, {
      name: `Mine ${run}`,
      shared: true,
      filters: { scope: 'mine' },
    });
    expect(created.statusCode).toBe(201);
    const viewId = (created.body as { data: ViewItem }).data.id;
    const readBack = (await listAs(salesRep)).find((v) => v.id === viewId);
    expect(readBack?.filters).toEqual({ scope: 'mine' });

    // The saver's own replay is its assignment — the other organization.
    const saverRows = await replay(handler, readBack!.filters);
    expect(saverRows).toContain(otherOrgRfqId);
    expect(saverRows).not.toContain(ownOrgRfqId);

    // The representative's replay is the representative's assignment.
    const repRows = await replay(salesRep, readBack!.filters);
    expect(repRows).toContain(ownOrgRfqId);
    expect(repRows).not.toContain(otherOrgRfqId);
  });
});
