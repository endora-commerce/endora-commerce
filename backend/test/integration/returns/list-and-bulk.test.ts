import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

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
    expect(res.body.split('\r\n')[0]).toBe('rmaNumber,kind,orderId,statusCode,totalRefundAmount,currency,submittedAt');
    expect(Number(res.headers['x-export-row-count'])).toBeGreaterThanOrEqual(1);
  });
});
