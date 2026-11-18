import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdminUserReadPort } from '@endora-commerce/contracts';
import { AdminUser, ReturnCase } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { allowOffPlatform, complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';
import { allowGuests, fileGuestCase, type FiledGuestCase } from './guest-fixtures.js';

const VIEWS = '/api/v1/admin/returns/list-views';
const SORT = { field: 'submittedAt', dir: 'desc' } as const;

interface ViewItem {
  id: string;
  name: string;
  shared: boolean;
  ownerAdminUserId: string;
  ownedByCaller: boolean;
  canModify: boolean;
  filters: Record<string, unknown>;
  sort: { field: string; dir: 'asc' | 'desc' } | null;
  visibleColumns: string[] | null;
}

interface ErrorBody {
  error: { code: string; message: string };
}

/**
 * Feature 046 (US8) — admin list with filters + counts, bulk transition, and
 * saved views. The saved views follow the rules every other admin list's
 * follow since #312; `backend/test/integration/saved-list-views/rules-parity.test.ts`
 * holds the service to them, this file the HTTP answers.
 */
describe('returns — admin list, bulk, saved views (US8)', () => {
  let h: BackendServerHandle;
  // Names carry a per-run suffix: the test admin is shared with other files.
  const run = randomUUID().slice(0, 8);

  function createView(body: Record<string, unknown>) {
    return h.app.inject({
      method: 'POST',
      url: VIEWS,
      cookies: ADMIN_COOKIE,
      payload: { shared: false, filters: {}, sort: SORT, ...body },
    });
  }

  /** Insert a row as the schema before #312 allowed it, around the service. */
  async function seedRaw(row: { ownerAdminUserId: string; name: string; shared: boolean }): Promise<string> {
    const id = randomUUID();
    await h.em().execute(
      `insert into return_list_saved_views
         (id, owner_admin_user_id, name, shared, filters, sort, visible_columns, created_at, updated_at)
       values (?, ?, ?, ?, '{}'::jsonb, '{"field":"submittedAt","dir":"desc"}'::jsonb, null, now(), now())`,
      [id, row.ownerAdminUserId, row.name, row.shared],
    );
    return id;
  }

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

  it('saves a shared view and reloads it, flagged for its owner', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: VIEWS,
      cookies: ADMIN_COOKIE,
      payload: { name: `Open returns ${run}`, shared: true, filters: { kind: 'return' }, sort: SORT },
    });
    expect(create.statusCode).toBe(201);
    const created = (create.json() as { data: ViewItem }).data;
    expect(created).toMatchObject({
      name: `Open returns ${run}`,
      shared: true,
      ownerAdminUserId: TEST_ADMIN_ID,
      ownedByCaller: true,
      canModify: true,
      filters: { kind: 'return' },
      sort: SORT,
      visibleColumns: null,
    });

    const list = await h.app.inject({ method: 'GET', url: VIEWS, cookies: ADMIN_COOKIE });
    const views = (list.json() as { data: ViewItem[] }).data;
    expect(views.find((v) => v.id === created.id)).toMatchObject({ ownedByCaller: true, canModify: true });
  });

  // --- #312: the rules of `specs/147-saved-views/` --------------------------

  it('stores a trimmed name and refuses whitespace-only, over-long and control-character names', async () => {
    const created = await createView({ name: `  Trimmed ${run}  ` });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { data: ViewItem }).data.name).toBe(`Trimmed ${run}`);

    for (const name of ['   ', 'x'.repeat(161), `bidi\u202E${run}`]) {
      const res = await createView({ name });
      expect(res.statusCode).toBe(400);
      expect((res.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a body over the size caps with 400', async () => {
    for (const extra of [
      { filters: { q: 'x'.repeat(9000) } },
      { visibleColumns: Array.from({ length: 65 }, (_, i) => `c${i}`) },
      { visibleColumns: ['c'.repeat(65)] },
      { sort: { field: 'f'.repeat(65), dir: 'asc' } },
    ]) {
      const res = await createView({ name: `Caps ${run}`, ...extra });
      expect(res.statusCode).toBe(400);
      expect((res.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a second view whose name differs only by case and spaces — 409, translated', async () => {
    expect((await createView({ name: `EU complaints ${run}` })).statusCode).toBe(201);
    const second = await createView({ name: ` eu COMPLAINTS ${run} `, shared: true });
    expect(second.statusCode).toBe(409);
    const error = (second.json() as ErrorBody).error;
    expect(error.code).toBe('RETURN_SAVED_VIEW_NAME_TAKEN');
    expect(error.message).toBe(
      'You already have a saved view with this name on the return list. Choose a different name.',
    );
  });

  it('refuses a PATCH renaming to a key the owner already uses', async () => {
    expect((await createView({ name: `Rename A ${run}` })).statusCode).toBe(201);
    const b = (await createView({ name: `Rename B ${run}` })).json() as { data: ViewItem };
    const res = await h.app.inject({
      method: 'PATCH',
      url: `${VIEWS}/${b.data.id}`,
      cookies: ADMIN_COOKIE,
      payload: { name: ` rename a ${run}` },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrorBody).error.code).toBe('RETURN_SAVED_VIEW_NAME_TAKEN');
  });

  it('answers 404 for an id that is not a UUID (was 500)', async () => {
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `${VIEWS}/not-a-uuid`,
      cookies: ADMIN_COOKIE,
      payload: { name: 'x' },
    });
    expect(patch.statusCode).toBe(404);
    expect((patch.json() as ErrorBody).error.code).toBe('NOT_FOUND');
    const del = await h.app.inject({ method: 'DELETE', url: `${VIEWS}/not-a-uuid`, cookies: ADMIN_COOKIE });
    expect(del.statusCode).toBe(404);
  });

  it("treats another admin's private view as absent (404, was 403) and lets a platform admin manage a shared one", async () => {
    const colleague = randomUUID();
    const priv = await seedRaw({ ownerAdminUserId: colleague, name: `Theirs private ${run}`, shared: false });
    const shared = await seedRaw({ ownerAdminUserId: colleague, name: `Theirs shared ${run}`, shared: true });

    const listed = (
      (await h.app.inject({ method: 'GET', url: VIEWS, cookies: ADMIN_COOKIE })).json() as { data: ViewItem[] }
    ).data;
    expect(listed.some((v) => v.id === priv)).toBe(false);
    // The stub admin reaches every organization, so it is a platform admin for saved views.
    expect(listed.find((v) => v.id === shared)).toMatchObject({ ownedByCaller: false, canModify: true });

    for (const method of ['PATCH', 'DELETE'] as const) {
      const res = await h.app.inject({
        method,
        url: `${VIEWS}/${priv}`,
        cookies: ADMIN_COOKIE,
        ...(method === 'PATCH' ? { payload: { shared: true } } : {}),
      });
      expect(res.statusCode).toBe(404);
      expect((res.json() as ErrorBody).error.code).toBe('NOT_FOUND');
    }

    const renamed = await h.app.inject({
      method: 'PATCH',
      url: `${VIEWS}/${shared}`,
      cookies: ADMIN_COOKIE,
      payload: { name: `Theirs renamed ${run}` },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as { data: ViewItem }).data).toMatchObject({
      name: `Theirs renamed ${run}`,
      ownerAdminUserId: colleague,
    });
    const del = await h.app.inject({ method: 'DELETE', url: `${VIEWS}/${shared}`, cookies: ADMIN_COOKIE });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ data: { deleted: shared } });
  });

  it('keeps a row saved before the rules as it is, and lets its owner fix or delete it', async () => {
    // Rows written by the old schema: a whitespace-only name, and two names
    // that share one key. Nothing rewrites them; only a rename meets the rules.
    const blank = await seedRaw({ ownerAdminUserId: TEST_ADMIN_ID, name: '   ', shared: false });
    const dupA = await seedRaw({ ownerAdminUserId: TEST_ADMIN_ID, name: `Legacy dup ${run}`, shared: false });
    const dupB = await seedRaw({ ownerAdminUserId: TEST_ADMIN_ID, name: `legacy DUP ${run}`, shared: false });

    const listed = (
      (await h.app.inject({ method: 'GET', url: VIEWS, cookies: ADMIN_COOKIE })).json() as { data: ViewItem[] }
    ).data;
    expect(listed.find((v) => v.id === blank)).toMatchObject({ name: '   ', canModify: true });
    expect(listed.filter((v) => v.id === dupA || v.id === dupB)).toHaveLength(2);

    // A change that leaves the name alone is never refused for it.
    const reshared = await h.app.inject({
      method: 'PATCH',
      url: `${VIEWS}/${dupB}`,
      cookies: ADMIN_COOKIE,
      payload: { shared: true, filters: { kind: 'complaint' } },
    });
    expect(reshared.statusCode).toBe(200);
    expect((reshared.json() as { data: ViewItem }).data.name).toBe(`legacy DUP ${run}`);

    // A rename must meet today's rules: not blank, not the sibling's key.
    const blankAgain = await h.app.inject({
      method: 'PATCH',
      url: `${VIEWS}/${blank}`,
      cookies: ADMIN_COOKIE,
      payload: { name: '  ' },
    });
    expect(blankAgain.statusCode).toBe(400);
    const clash = await h.app.inject({
      method: 'PATCH',
      url: `${VIEWS}/${blank}`,
      cookies: ADMIN_COOKIE,
      payload: { name: `LEGACY dup ${run}` },
    });
    expect(clash.statusCode).toBe(409);
    const fixed = await h.app.inject({
      method: 'PATCH',
      url: `${VIEWS}/${blank}`,
      cookies: ADMIN_COOKIE,
      payload: { name: `Was blank ${run}` },
    });
    expect(fixed.statusCode).toBe(200);
    expect((fixed.json() as { data: ViewItem }).data.name).toBe(`Was blank ${run}`);

    const del = await h.app.inject({ method: 'DELETE', url: `${VIEWS}/${dupA}`, cookies: ADMIN_COOKIE });
    expect(del.statusCode).toBe(200);
  });

  it('requires shared and sort on create', async () => {
    const noShared = await h.app.inject({
      method: 'POST',
      url: VIEWS,
      cookies: ADMIN_COOKIE,
      payload: { name: `No shared ${run}`, filters: {}, sort: SORT },
    });
    expect(noShared.statusCode).toBe(400);
    const noSort = await h.app.inject({
      method: 'POST',
      url: VIEWS,
      cookies: ADMIN_COOKIE,
      payload: { name: `No sort ${run}`, shared: false, filters: {} },
    });
    expect(noSort.statusCode).toBe(400);
  });

  it('exports the current view to CSV', async () => {
    await createCase();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/export?kind=return', cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.split('\r\n')[0]).toBe(
      // 181 (admin-api.md A1) appends `guest`.
      'rmaNumber,reference,kind,orderId,statusCode,totalRefundAmount,currency,submittedAt,authorizedBy,offPlatform,guest',
    );
    expect(Number(res.headers['x-export-row-count'])).toBeGreaterThanOrEqual(1);
  });

  /**
   * `specs/180-off-platform-complaints/` T032 (FR-A41 – FR-A44, D-4, research R-8,
   * R-20): the reference on rows and detail, the authorizer resolved in one batched
   * lookup per page, the derived reference found by `q`, and both in the CSV.
   */
  describe('the authorizer and the reference (180)', () => {
    const referenceOf = (id: string) => `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    type Row = { id: string; reference: string; rmaNumber: string | null; authorizedBy: { adminUserId: string | null; name: string | null } | null };
    const adminUsers = () => h.container.resolve<AdminUserReadPort>('adminUserReadPort');
    const list = async (qs: string): Promise<Row[]> => {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns${qs}`, cookies: ADMIN_COOKIE });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { rows: Row[] } }).data.rows;
    };

    it('carries the reference on rows and detail, and resolves the authorizer in one batched lookup per page', async () => {
      const pending = await createCase();
      const authorized = await createCase();
      await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${authorized}/authorize`, cookies: ADMIN_COOKIE });
      const admin = await adminUsers().findById(TEST_ADMIN_ID);
      const name = `${admin!.firstName} ${admin!.lastName}`.trim();

      const findByIds = vi.spyOn(adminUsers(), 'findByIds');
      try {
        const rows = await list('?pageSize=200');
        expect(findByIds).toHaveBeenCalledTimes(1);
        const byId = new Map(rows.map((r) => [r.id, r]));
        expect(byId.get(pending)).toMatchObject({ reference: referenceOf(pending), authorizedBy: null });
        const row = byId.get(authorized)!;
        expect(row.reference).toBe(row.rmaNumber);
        expect(row.authorizedBy).toEqual({ adminUserId: TEST_ADMIN_ID, name });
      } finally {
        findByIds.mockRestore();
      }

      const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${authorized}`, cookies: ADMIN_COOKIE });
      const data = (detail.json() as { data: { reference: string; authorizedAt: string | null; authorizedBy: unknown } }).data;
      expect(data.authorizedAt).toBeTruthy();
      expect(data.authorizedBy).toEqual({ adminUserId: TEST_ADMIN_ID, name });
      const fresh = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${pending}`, cookies: ADMIN_COOKIE });
      expect((fresh.json() as { data: { reference: string; authorizedBy: unknown } }).data).toMatchObject({
        reference: referenceOf(pending),
        authorizedBy: null,
      });
    });

    it('names a removed administrator as null, and an unknown authorizer with a null id', async () => {
      const former = await createCase();
      const unknown = await createCase();
      await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${former}/authorize`, cookies: ADMIN_COOKIE });
      await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${unknown}/authorize`, cookies: ADMIN_COOKIE });
      const em = h.em().fork();
      await em.nativeUpdate(ReturnCase, { id: former }, { authorizedByAdminUserId: randomUUID() });
      await em.nativeUpdate(ReturnCase, { id: unknown }, { authorizedByAdminUserId: null });

      const byId = new Map((await list('?pageSize=200')).map((r) => [r.id, r]));
      expect(byId.get(former)!.authorizedBy).toMatchObject({ name: null });
      expect(byId.get(former)!.authorizedBy!.adminUserId).not.toBeNull();
      expect(byId.get(unknown)!.authorizedBy).toEqual({ adminUserId: null, name: null });
    });

    it('finds a case by its derived reference, with or without the #', async () => {
      const id = await createCase();
      for (const q of [referenceOf(id), referenceOf(id).slice(1), referenceOf(id).toLowerCase()]) {
        const rows = await list(`?q=${encodeURIComponent(q)}`);
        expect(rows.map((r) => r.id)).toContain(id);
      }
    });

    it('exports the reference and the authorizer, worded in the export language', async () => {
      const authorized = await createCase();
      const unknown = await createCase();
      await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${authorized}/authorize`, cookies: ADMIN_COOKIE });
      await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${unknown}/authorize`, cookies: ADMIN_COOKIE });
      await h.em().fork().nativeUpdate(ReturnCase, { id: unknown }, { authorizedByAdminUserId: null });
      // An administrator is answered in their stored language (D-132).
      const csvOf = async (language: 'en' | 'pl') => {
        const em = h.em().fork();
        const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
        const before = admin.preferredLanguage ?? null;
        admin.preferredLanguage = language;
        await em.flush();
        try {
          const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/export?pageSize=200', cookies: ADMIN_COOKIE });
          expect(res.statusCode).toBe(200);
          return res.body.split('\r\n');
        } finally {
          admin.preferredLanguage = before;
          await em.flush();
        }
      };
      const rmaOf = async (id: string) => (await h.em().fork().findOneOrFail(ReturnCase, { id })).rmaNumber!;
      const lineOf = (lines: string[], rma: string) => lines.find((l) => l.startsWith(`${rma},`))!;

      const en = await csvOf('en');
      expect(lineOf(en, await rmaOf(unknown)).endsWith(',unknown,false,false')).toBe(true);
      expect(lineOf(en, await rmaOf(authorized)).split(',')[1]).toBe(await rmaOf(authorized));
      const pl = await csvOf('pl');
      expect(lineOf(pl, await rmaOf(unknown)).endsWith(',nieznany,false,false')).toBe(true);
    });
  });

  /**
   * `specs/180-off-platform-complaints/` T080 (FR-B34 – FR-B36, D-3, D-8): the list's
   * origin filter, the export's marking, the recognisable rows and the erasure date.
   */
  describe('cases without a platform order (180)', () => {
    type Row = { id: string; offPlatform: boolean; productLabel: string; lineCount: number; purchaseDate: string | null };
    let offPlatformId: string;
    let orderCaseId: string;

    beforeAll(async () => {
      const undo = await allowOffPlatform(h);
      try {
        const reasonId = await complaintReasonId(h.em());
        const lines = [
          { modelName: 'Drill X200', quantity: 1, reasonId, description: 'a' },
          { modelName: 'Charger', quantity: 1, reasonId, description: 'b' },
        ];
        const res = await file(h, noOrderBody(reasonId, { lines }), { headers: { 'x-sales-channel': 'default' } });
        offPlatformId = (res.json() as { data: { id: string } }).data.id;
      } finally {
        await undo();
      }
      // A case against a platform order — imported from an ERP or not — is not off-platform (R5).
      orderCaseId = await createCase();
    });

    const rows = async (qs: string): Promise<Row[]> => {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns${qs}`, cookies: ADMIN_COOKIE });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { rows: Row[] } }).data.rows;
    };

    it('filters by origin', async () => {
      const off = await rows('?origin=off_platform&pageSize=200');
      expect(off.map((r) => r.id)).toContain(offPlatformId);
      expect(off.map((r) => r.id)).not.toContain(orderCaseId);
      expect(off.every((r) => r.offPlatform)).toBe(true);
      const platform = await rows('?origin=platform&pageSize=200');
      expect(platform.map((r) => r.id)).toContain(orderCaseId);
      expect(platform.map((r) => r.id)).not.toContain(offPlatformId);
    });

    it('carries the product label, the line count and the purchase date on every row (D-3)', async () => {
      const all = new Map((await rows('?pageSize=200')).map((r) => [r.id, r]));
      // The first line by the lines' id order (research R-23).
      expect(all.get(offPlatformId)).toMatchObject({ lineCount: 2, purchaseDate: '2026-10-01', offPlatform: true });
      expect(['Drill X200', 'Charger']).toContain(all.get(offPlatformId)!.productLabel);
      expect(all.get(orderCaseId)).toMatchObject({ productLabel: 'Widget', lineCount: 1, purchaseDate: null, offPlatform: false });
    });

    it('marks the export', async () => {
      const csv = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/export?pageSize=200', cookies: ADMIN_COOKIE });
      const [header, ...lines] = csv.body.split('\r\n');
      const columns = header!.split(',');
      expect(columns).toContain('offPlatform');
      const reference = `#${offPlatformId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      const line = lines.find((l) => l.split(',')[columns.indexOf('reference')] === reference)!;
      expect(line.split(',')[columns.indexOf('offPlatform')]).toBe('true');
      expect(line.split(',')[columns.indexOf('orderId')]).toBe('');
    });

    it('carries the erasure date on the detail (D-8)', async () => {
      const at = new Date('2026-11-10T08:00:00Z');
      await h.em().fork().nativeUpdate(ReturnCase, { id: offPlatformId }, { personalDataErasedAt: at });
      const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${offPlatformId}`, cookies: ADMIN_COOKIE });
      expect((detail.json() as { data: { personalDataErasedAt: string } }).data.personalDataErasedAt).toBe(at.toISOString());
    });
  });

  /**
   * `specs/181-guest-complaints/` T046 (FR-061; contracts/admin-api.md A1; research R-10):
   * the widened origin filter, a saved view keeping it, the export's `guest` column, the
   * guest label of the customer column and the exact contact e-mail search.
   */
  describe('cases filed by guests (181)', () => {
    type Row = { id: string; offPlatform: boolean; guest: boolean; customerAccountId: string | null; customerName: string | null };
    let undoGuests: () => Promise<void>;
    let orderCaseId: string;
    let customerOffId: string;
    let guestCase: FiledGuestCase;

    beforeAll(async () => {
      undoGuests = await allowGuests(h);
      const reasonId = await complaintReasonId(h.em());
      const res = await file(h, noOrderBody(reasonId), { headers: { 'x-sales-channel': 'default' } });
      expect(res.statusCode, res.body).toBe(201);
      customerOffId = (res.json() as { data: { id: string } }).data.id;
      guestCase = await fileGuestCase(h, reasonId);
      orderCaseId = await createCase();
    });
    afterAll(async () => {
      await undoGuests();
    });

    const rows = async (qs: string): Promise<Row[]> => {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns?pageSize=200${qs}`, cookies: ADMIN_COOKIE });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { rows: Row[] } }).data.rows;
    };
    const ids = async (qs: string): Promise<string[]> => (await rows(qs)).map((r) => r.id);

    it('filters by each origin', async () => {
      const platform = await ids('&origin=platform');
      expect(platform).toContain(orderCaseId);
      expect(platform).not.toContain(customerOffId);
      expect(platform).not.toContain(guestCase.caseId);

      // `off_platform` keeps 180's meaning: every case bought elsewhere, both kinds.
      const off = await ids('&origin=off_platform');
      expect(off).toEqual(expect.arrayContaining([customerOffId, guestCase.caseId]));
      expect(off).not.toContain(orderCaseId);

      const offCustomer = await ids('&origin=off_platform_customer');
      expect(offCustomer).toContain(customerOffId);
      expect(offCustomer).not.toContain(guestCase.caseId);
      expect(offCustomer).not.toContain(orderCaseId);

      const guests = await rows('&origin=guest');
      expect(guests.map((r) => r.id)).toContain(guestCase.caseId);
      expect(guests.every((r) => r.guest && r.offPlatform && r.customerAccountId === null)).toBe(true);
      expect(guests.map((r) => r.id)).not.toContain(customerOffId);

      const all = await ids('');
      expect(all).toEqual(expect.arrayContaining([orderCaseId, customerOffId, guestCase.caseId]));
    });

    it('marks the guest row and names the guest in the customer column, never a customer’s', async () => {
      const byId = new Map((await rows('')).map((r) => [r.id, r]));
      expect(byId.get(guestCase.caseId)).toMatchObject({ guest: true, customerAccountId: null, customerName: 'Gość Kowalski' });
      expect(byId.get(customerOffId)).toMatchObject({ guest: false, customerName: null });
      expect(byId.get(orderCaseId)).toMatchObject({ guest: false, offPlatform: false });
    });

    it('refuses an origin it does not know', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns?origin=guests', cookies: ADMIN_COOKIE });
      expect(res.statusCode).toBe(400);
    });

    it('keeps the guest origin in a saved view', async () => {
      const created = await createView({ name: `Guest complaints ${run}`, filters: { origin: 'guest' } });
      expect(created.statusCode, created.body).toBe(201);
      const id = (created.json() as { data: ViewItem }).data.id;
      const listed = ((await h.app.inject({ method: 'GET', url: VIEWS, cookies: ADMIN_COOKIE })).json() as { data: ViewItem[] }).data;
      expect(listed.find((v) => v.id === id)?.filters).toEqual({ origin: 'guest' });
    });

    it('exports a guest column', async () => {
      const csv = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/export?pageSize=200', cookies: ADMIN_COOKIE });
      const [header, ...lines] = csv.body.split('\r\n');
      const columns = header!.split(',');
      expect(columns[columns.length - 1]).toBe('guest');
      const cell = (reference: string) =>
        lines.find((l) => l.split(',')[columns.indexOf('reference')] === reference)!.split(',')[columns.indexOf('guest')];
      expect(cell(guestCase.reference)).toBe('true');
      expect(cell(`#${customerOffId.replace(/-/g, '').slice(0, 8).toUpperCase()}`)).toBe('false');
      // The guest's address is not a column of the file.
      expect(csv.body).not.toContain(guestCase.email);
    });

    it('finds a case by its contact e-mail exactly, in any case, and never by a part of it', async () => {
      expect(await ids(`&q=${encodeURIComponent(guestCase.email)}`)).toEqual([guestCase.caseId]);
      expect(await ids(`&q=${encodeURIComponent(`  ${guestCase.email.toUpperCase()}  `)}`)).toEqual([guestCase.caseId]);
      // A customer's case without an order is found by its contact address too (data model §1).
      expect(await ids(`&q=${encodeURIComponent('ewa@example.test')}`)).toContain(customerOffId);
      for (const part of [guestCase.email.slice(0, 12), guestCase.email.split('@')[1]!, `@${guestCase.email.split('@')[1]!}`]) {
        expect(await ids(`&q=${encodeURIComponent(part)}`)).not.toContain(guestCase.caseId);
      }
    });

    it('drops the guest’s name once the personal data is erased', async () => {
      const reasonId = await complaintReasonId(h.em());
      const erased = await fileGuestCase(h, reasonId);
      await h
        .em()
        .getConnection()
        .execute(`update "return_cases" set "personal_data_erased_at" = now(), "contact" = null, "return_address" = null where "id" = ?`, [
          erased.caseId,
        ]);
      const row = (await rows('&origin=guest')).find((r) => r.id === erased.caseId);
      expect(row).toMatchObject({ guest: true, customerName: null });
      expect(await ids(`&q=${encodeURIComponent(erased.email)}`)).toEqual([]);
    });
  });
});
