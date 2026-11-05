import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, Phase 9a (T156d) — the admin product list filters archived products by
 * `archivedAt`, independently of the status (FR-113, research R30.4):
 *
 * - by default no archived product of any status is listed, while a non-archived
 *   `inactive` one is listed with no filter and under `status=inactive`;
 * - `archived=only` lists archived products of both statuses; `archived=include` and
 *   the legacy `includeArchived=1` list both kinds, and `archived` wins over it;
 * - `status=draft`, `status=archived` and an unknown status answer `400
 *   VALIDATION_FAILED` with `details.field = 'status'`, and so does an unknown mode;
 * - `counts` is `{ all, active, inactive, archived }`: the first three over
 *   non-archived, non-deleted rows, `archived` over archived, non-deleted rows.
 *
 * Every row this file asserts on is its own, found by a per-run SKU through `q`; the
 * counts are compared as deltas so rows other files write cannot disturb them.
 */
describe('GET /api/v1/admin/catalog/products — archived (spec 163, T156d)', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const run = randomUUID().slice(0, 8);

  interface Counts {
    all: number;
    active: number;
    inactive: number;
    archived: number;
  }
  interface ListBody {
    data: Array<{ id: string; status: string; archivedAt: string | null }>;
    counts: Counts;
  }

  async function create(suffix: string, status: 'active' | 'inactive'): Promise<string> {
    const sku = `LISTARCH-${run}-${suffix}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      ...admin,
      payload: {
        sku,
        type: 'simple',
        name: sku,
        description: 'desc',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status,
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function archive(id: string): Promise<void> {
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/admin/catalog/products/${id}/archive`, ...admin });
    expect(res.statusCode).toBe(200);
  }

  async function list(query: string): Promise<ListBody> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products?pageSize=500&q=LISTARCH-${run}${query ? `&${query}` : ''}`,
      ...admin,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as ListBody;
  }

  const ids = (body: ListBody): string[] => body.data.map((p) => p.id).sort();

  let liveActive: string;
  let liveInactive: string;
  let archivedActive: string;
  let archivedInactive: string;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('counts { all, active, inactive, archived } move by exactly this file\'s rows', async () => {
    const before = (await list('')).counts;
    expect(Object.keys(before).sort()).toEqual(['active', 'all', 'archived', 'inactive']);

    liveActive = await create('LA', 'active');
    liveInactive = await create('LI', 'inactive');
    archivedActive = await create('AA', 'active');
    archivedInactive = await create('AI', 'inactive');
    await archive(archivedActive);
    await archive(archivedInactive);

    const after = (await list('')).counts;
    expect(after.all - before.all).toBe(2);
    expect(after.active - before.active).toBe(1);
    expect(after.inactive - before.inactive).toBe(1);
    expect(after.archived - before.archived).toBe(2);
    expect(after.all).toBe(after.active + after.inactive);
  });

  it('lists no archived product by default, and a non-archived inactive one', async () => {
    expect(ids(await list(''))).toEqual([liveActive, liveInactive].sort());
    expect(ids(await list('archived=exclude'))).toEqual([liveActive, liveInactive].sort());
  });

  it('status=inactive lists the non-archived inactive product only', async () => {
    expect(ids(await list('status=inactive'))).toEqual([liveInactive]);
  });

  it('archived=only lists archived products of both statuses', async () => {
    expect(ids(await list('archived=only'))).toEqual([archivedActive, archivedInactive].sort());
    expect(ids(await list('archived=only&status=active'))).toEqual([archivedActive]);
  });

  it('archived=include and the legacy includeArchived=1 list both kinds', async () => {
    const all = [liveActive, liveInactive, archivedActive, archivedInactive].sort();
    expect(ids(await list('archived=include'))).toEqual(all);
    expect(ids(await list('includeArchived=1'))).toEqual(all);
    expect(ids(await list('includeArchived=true&status=inactive'))).toEqual([liveInactive, archivedInactive].sort());
    // `archived` wins when both are sent.
    expect(ids(await list('includeArchived=1&archived=only'))).toEqual([archivedActive, archivedInactive].sort());
  });

  it.each(['draft', 'archived', 'deleted'])('status=%s answers 400 VALIDATION_FAILED on the status field', async (status) => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products?status=${status}`,
      ...admin,
    });
    expect(res.statusCode).toBe(400);
    const error = (res.json() as { error: { code: string; details?: { field?: string } } }).error;
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details?.field).toBe('status');
  });

  it('an unknown archived mode answers 400 VALIDATION_FAILED on the archived field', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products?archived=all',
      ...admin,
    });
    expect(res.statusCode).toBe(400);
    const error = (res.json() as { error: { code: string; details?: { field?: string } } }).error;
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details?.field).toBe('archived');
  });
});
