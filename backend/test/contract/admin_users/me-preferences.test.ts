import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_PREFERENCES_DEFAULTS,
  ERROR_CODES,
  adminPreferencesResponseSchema,
  type AdminPreferences,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';

/**
 * Feature 164 — `GET`/`PATCH /api/v1/admin/me/preferences` and
 * `POST /api/v1/admin/me/preferences/legacy-import`
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-api.md` §2).
 *
 * Self-service only: every route reads the session's admin and none takes an
 * admin id (FR-011). Strict on write, refused with nothing written (FR-012). No
 * audit entry (FR-020).
 *
 * Admin A is the shared wildcard admin (`stub-admin-session`), whose document
 * other files may also touch — so every case asserting on A's document first
 * writes the state it asserts from. B (with a role) and C (role-less) are this
 * file's own.
 */

const URL = '/api/v1/admin/me/preferences';
const IMPORT_URL = '/api/v1/admin/me/preferences/legacy-import';
const ADMIN_B_ID = '00000000-0000-4000-8000-0000000164a1';
const ADMIN_C_ID = '00000000-0000-4000-8000-0000000164a2';

type Who = { cookies: Record<string, string> };
const adminA: Who = { cookies: { b2b_session: 'stub-admin-session' } };
const adminB: Who = { cookies: { b2b_session: 'stub-admin-preferences-b-session' } };
const adminC: Who = { cookies: { b2b_session: 'stub-admin-preferences-c-session' } };

describe('Admin UI preferences — /api/v1/admin/me/preferences (spec 164)', () => {
  let h: BackendServerHandle;

  async function ensureAdmin(id: string, email: string, roleId: string | null): Promise<void> {
    const em = h.em();
    const existing = await em.findOne(AdminUser, { id });
    if (existing) {
      existing.adminRoleId = roleId;
      existing.status = 'active';
      existing.deletedAt = null;
    } else {
      em.create(AdminUser, {
        id,
        email,
        passwordHash: 'x'.repeat(60),
        firstName: 'Admin',
        lastName: 'Preferences',
        adminRoleId: roleId,
        status: 'active',
      });
    }
    await em.flush();
  }

  async function ensureRole(code: string, permissions: string[]): Promise<string> {
    const em = h.em();
    let role = await em.findOne(AdminRole, { code });
    if (!role) {
      role = em.create(AdminRole, { code, name: code, permissions });
      await em.persist(role).flush();
    }
    return role.id;
  }

  async function read(who: Who): Promise<AdminPreferences> {
    const res = await h.app.inject({ method: 'GET', url: URL, ...who });
    expect(res.statusCode).toBe(200);
    return adminPreferencesResponseSchema.parse(res.json()).data;
  }

  async function patch(who: Who, payload: unknown) {
    return h.app.inject({ method: 'PATCH', url: URL, ...who, payload: payload as object });
  }

  async function patchOk(who: Who, payload: unknown): Promise<AdminPreferences> {
    const res = await patch(who, payload);
    expect(res.statusCode, res.body).toBe(200);
    return adminPreferencesResponseSchema.parse(res.json()).data;
  }

  /** Forget every list `who` holds, so a case starts from an empty map. */
  async function clearLists(who: Who): Promise<void> {
    const current = await read(who);
    const names = Object.keys(current.listPageSizes);
    if (names.length === 0) return;
    await patchOk(who, { listPageSizes: Object.fromEntries(names.map((n) => [n, null])) });
  }

  async function auditCount(): Promise<number> {
    const rows = await h
      .em()
      .execute<Array<{ n: string }>>(`select count(*)::text as n from "audit_log_entries"`);
    return Number(rows[0]!.n);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const roleId = await ensureRole('admin_preferences_reader', ['orders:read']);
    await ensureAdmin(ADMIN_B_ID, 'admin-preferences-b@example.com', roleId);
    await ensureAdmin(ADMIN_C_ID, 'admin-preferences-c@example.com', null);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET answers the whole document, every key present', async () => {
    const data = await read(adminB);
    expect(Object.keys(data).sort()).toEqual(Object.keys(ADMIN_PREFERENCES_DEFAULTS).sort());
  });

  it('PATCH answers the whole document; a further pin is appended, order kept (FR-007, FR-008)', async () => {
    const first = await patchOk(adminB, { sidebarPins: ['/orders', '/quote-requests'] });
    expect(first.sidebarPins).toEqual(['/orders', '/quote-requests']);
    expect(Object.keys(first).sort()).toEqual(Object.keys(ADMIN_PREFERENCES_DEFAULTS).sort());
    const second = await patchOk(adminB, {
      sidebarPins: ['/orders', '/quote-requests', '/customers'],
    });
    expect(second.sidebarPins).toEqual(['/orders', '/quote-requests', '/customers']);
    expect((await read(adminB)).sidebarPins).toEqual(['/orders', '/quote-requests', '/customers']);
  });

  it('keys are independent: writing rail mode leaves the pins untouched', async () => {
    await patchOk(adminB, { sidebarPins: ['/orders'] });
    const after = await patchOk(adminB, { sidebarRailMode: true });
    expect(after.sidebarRailMode).toBe(true);
    expect(after.sidebarPins).toEqual(['/orders']);
  });

  it('page sizes merge per list, and `null` forgets a list', async () => {
    await clearLists(adminB);
    await patchOk(adminB, { listPageSizes: { orders: 50 } });
    const both = await patchOk(adminB, { listPageSizes: { 'catalog-products': 100 } });
    expect(both.listPageSizes).toEqual({ orders: 50, 'catalog-products': 100 });
    const forgotten = await patchOk(adminB, { listPageSizes: { orders: null } });
    expect(forgotten.listPageSizes).toEqual({ 'catalog-products': 100 });
  });

  it('list/board choices merge per list, and `null` forgets a list (`specs/165-task-management/` R-14)', async () => {
    const current = await read(adminB);
    const stored = Object.keys(current.listViewModes);
    if (stored.length > 0) {
      await patchOk(adminB, { listViewModes: Object.fromEntries(stored.map((n) => [n, null])) });
    }
    await patchOk(adminB, { listViewModes: { tasks: 'board' } });
    const both = await patchOk(adminB, { listViewModes: { 'tasks-mine': 'list' } });
    expect(both.listViewModes).toEqual({ tasks: 'board', 'tasks-mine': 'list' });
    // Page sizes are a different map: writing one leaves the other alone.
    const sizes = await patchOk(adminB, { listPageSizes: { orders: 50 } });
    expect(sizes.listViewModes).toEqual({ tasks: 'board', 'tasks-mine': 'list' });
    const forgotten = await patchOk(adminB, { listViewModes: { tasks: null } });
    expect(forgotten.listViewModes).toEqual({ 'tasks-mine': 'list' });
    expect((await read(adminB)).listViewModes).toEqual({ 'tasks-mine': 'list' });
    const refused = await patch(adminB, { listViewModes: { tasks: 'grid' } });
    expect(refused.statusCode).toBe(400);
    await patchOk(adminB, { listViewModes: { 'tasks-mine': null }, listPageSizes: { orders: null } });
  });

  it('legacy-import never overwrites a stored list (FR-022, US3 AS-5)', async () => {
    await clearLists(adminB);
    await patchOk(adminB, { listPageSizes: { orders: 100 } });
    const res = await h.app.inject({
      method: 'POST',
      url: IMPORT_URL,
      ...adminB,
      payload: { listPageSizes: { orders: 10, returns: 50 } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = adminPreferencesResponseSchema.parse(res.json()).data;
    expect(data.listPageSizes).toEqual({ orders: 100, returns: 50 });
  });

  describe('401 without a session — before validation, never 400', () => {
    it.each([
      ['GET', URL, undefined],
      ['PATCH', URL, { sidebarRailMode: true }],
      ['PATCH', URL, { theme: 'dark' }],
      ['POST', IMPORT_URL, { listPageSizes: { orders: 10 } }],
      ['POST', IMPORT_URL, {}],
    ] as const)('%s %s with %j', async (method, url, payload) => {
      const res = await h.app.inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload }),
      });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.UNAUTHORIZED,
      );
    });
  });

  describe('400 VALIDATION_FAILED with nothing written (FR-012)', () => {
    const lists = (n: number): Record<string, number> =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`list-${i}`, 20]));

    async function documentRow(): Promise<string> {
      const rows = await h
        .em()
        .execute<Array<{ preference_key: string; value: unknown }>>(
          `select "preference_key", "value" from "admin_user_preferences" where "admin_user_id" = ? order by "preference_key"`,
          [ADMIN_B_ID],
        );
      return JSON.stringify(rows);
    }

    it.each([
      ['an unknown key', { theme: 'dark' }],
      ['an empty body', {}],
      ['rail mode that is not a boolean', { sidebarRailMode: 'yes' }],
      ['pins that are not an array', { sidebarPins: '/orders' }],
      ['a page size that is not an option', { listPageSizes: { orders: 7 } }],
      ['a duplicate pin', { sidebarPins: ['/orders', '/orders'] }],
      ['201 pins', { sidebarPins: Array.from({ length: 201 }, (_, i) => `/p${i}`) }],
      ['a destination without a leading slash', { sidebarPins: ['orders'] }],
      ['a destination with a query string', { sidebarPins: ['/orders?x=1'] }],
      ['a destination of 256 characters', { sidebarPins: [`/${'a'.repeat(255)}`] }],
      ['33 folded groups', { sidebarCollapsedGroups: Array.from({ length: 33 }, (_, i) => `g${i}`) }],
      ['a group key `Pinned`', { sidebarCollapsedGroups: ['Pinned'] }],
      ['a group key `1x`', { sidebarCollapsedGroups: ['1x'] }],
      ['129 lists', { listPageSizes: lists(129) }],
      ['a list id `Orders`', { listPageSizes: { Orders: 20 } }],
      ['a list id `a--b`', { listPageSizes: { 'a--b': 20 } }],
      ['a list id of 65 characters', { listPageSizes: { ['a'.repeat(65)]: 20 } }],
      ['an admin id', { adminUserId: ADMIN_C_ID, sidebarRailMode: true }],
    ])('PATCH refuses %s', async (_label, payload) => {
      await patchOk(adminB, { sidebarPins: ['/orders'], sidebarRailMode: false });
      const before = await documentRow();
      const res = await patch(adminB, payload);
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: { code: string; details?: unknown } };
      expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(body.error.details).toBeDefined();
      expect(await documentRow()).toBe(before);
    });

    it('PATCH refuses a 129th list after the merge', async () => {
      await clearLists(adminB);
      await patchOk(adminB, { listPageSizes: lists(128) });
      const before = await documentRow();
      const res = await patch(adminB, { listPageSizes: { extra: 20 } });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: { code: string; details?: unknown } };
      expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(body.error.details).toBeDefined();
      expect(await documentRow()).toBe(before);
      await clearLists(adminB);
    });

    it('legacy-import refuses a 129th list after the merge', async () => {
      await clearLists(adminB);
      await patchOk(adminB, { listPageSizes: lists(128) });
      const before = await documentRow();
      const res = await h.app.inject({
        method: 'POST',
        url: IMPORT_URL,
        ...adminB,
        payload: { listPageSizes: { extra: 20 } },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.VALIDATION_FAILED,
      );
      expect(await documentRow()).toBe(before);
      await clearLists(adminB);
    });

    it.each([
      ['an empty map', { listPageSizes: {} }],
      ['a null value', { listPageSizes: { orders: null } }],
      ['an extra key', { listPageSizes: { orders: 10 }, sidebarRailMode: true }],
      ['an empty body', {}],
    ])('legacy-import refuses %s', async (_label, payload) => {
      const before = await documentRow();
      const res = await h.app.inject({ method: 'POST', url: IMPORT_URL, ...adminB, payload });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.VALIDATION_FAILED,
      );
      expect(await documentRow()).toBe(before);
    });
  });

  describe('isolation (FR-011)', () => {
    it("one admin's write never appears in another's document, in either direction", async () => {
      await patchOk(adminA, { sidebarPins: ['/settings'] });
      await patchOk(adminB, { sidebarPins: ['/orders', '/customers'] });
      expect((await read(adminA)).sidebarPins).toEqual(['/settings']);
      expect((await read(adminB)).sidebarPins).toEqual(['/orders', '/customers']);
      await patchOk(adminA, { sidebarPins: ['/settings', '/catalog'] });
      expect((await read(adminB)).sidebarPins).toEqual(['/orders', '/customers']);
    });

    it("no route names another admin's preferences, not even for the wildcard admin", async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/admin-users/${ADMIN_B_ID}/preferences`,
        ...adminA,
      });
      expect(res.statusCode).toBe(404);
    });

    it('a role-less admin reads and writes its own document', async () => {
      const written = await patchOk(adminC, { sidebarPins: ['/dashboard'] });
      expect(written.sidebarPins).toEqual(['/dashboard']);
      expect((await read(adminC)).sidebarPins).toEqual(['/dashboard']);
      expect((await read(adminB)).sidebarPins).not.toContain('/dashboard');
    });
  });

  it('writes no audit entry (FR-020)', async () => {
    const before = await auditCount();
    await patchOk(adminB, { sidebarRailMode: true, sidebarCollapsedGroups: ['sales'] });
    const res = await h.app.inject({
      method: 'POST',
      url: IMPORT_URL,
      ...adminB,
      payload: { listPageSizes: { invoices: 50 } },
    });
    expect(res.statusCode).toBe(200);
    expect(await auditCount()).toBe(before);
  });
});
