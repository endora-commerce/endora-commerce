import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 033 — POST /api/v1/admin/catalog/products/resolve-ids
 *
 * Feature 163 (T156d, R30.4) — the selection takes the list's `archived` mode
 * (`exclude` | `include` | `only`) beside the legacy `includeArchived`, whose default
 * stays "include"; `draft` and `archived` are no status.
 */

describe('POST /api/v1/admin/catalog/products/resolve-ids', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns { data: { productIds, total } } matching admin list filters', async () => {
    const listRes = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products?status=active&pageSize=500',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as {
      data: Array<{ id: string }>;
      pagination: { total: number };
    };

    const resolveRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/resolve-ids',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { status: 'active', archived: 'exclude' },
    });
    expect(resolveRes.statusCode).toBe(200);
    const resolveBody = resolveRes.json() as {
      data: { productIds: string[]; total: number };
    };
    expect(resolveBody.data.total).toBe(resolveBody.data.productIds.length);
    expect(resolveBody.data.total).toBe(listBody.pagination.total);
    const listIds = new Set(listBody.data.map((p) => p.id));
    for (const id of resolveBody.data.productIds) {
      expect(listIds.has(id)).toBe(true);
    }
  });

  it('returns 400 SELECTION_TOO_LARGE when matches exceed cap', async () => {
    const prev = process.env['CATALOG_MAX_RESOLVE_IDS'];
    process.env['CATALOG_MAX_RESOLVE_IDS'] = '1';
    try {
      const listRes = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/catalog/products?pageSize=1',
        cookies: { b2b_session: 'stub-admin-session' },
      });
      const listBody = listRes.json() as { pagination: { total: number } };
      if (listBody.pagination.total < 2) {
        return;
      }

      const resolveRes = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products/resolve-ids',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { includeArchived: true },
      });
      expect(resolveRes.statusCode).toBe(400);
      const body = resolveRes.json() as { error: { code: string; details?: { total: number } } };
      expect(body.error.code).toBe(ERROR_CODES.SELECTION_TOO_LARGE);
      expect(body.error.details?.total).toBeGreaterThan(1);
    } finally {
      if (prev === undefined) delete process.env['CATALOG_MAX_RESOLVE_IDS'];
      else process.env['CATALOG_MAX_RESOLVE_IDS'] = prev;
    }
  });

  describe('the archived mode (spec 163, R30.4)', () => {
    const admin = { cookies: { b2b_session: 'stub-admin-session' } };
    const run = randomUUID().slice(0, 8);

    async function create(sku: string, status: 'active' | 'inactive'): Promise<string> {
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

    async function resolve(payload: Record<string, unknown>): Promise<string[]> {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products/resolve-ids',
        ...admin,
        payload: { q: `RSLV-${run}`, ...payload },
      });
      expect(res.statusCode).toBe(200);
      return [...(res.json() as { data: { productIds: string[] } }).data.productIds].sort();
    }

    it('selects archived products of both statuses with archived: only', async () => {
      const live = await create(`RSLV-${run}-LIVE`, 'inactive');
      const archivedActive = await create(`RSLV-${run}-ARCH-A`, 'active');
      const archivedInactive = await create(`RSLV-${run}-ARCH-I`, 'inactive');
      for (const id of [archivedActive, archivedInactive]) {
        const res = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/catalog/products/${id}/archive`,
          ...admin,
        });
        expect(res.statusCode).toBe(200);
      }
      expect(await resolve({ archived: 'only' })).toEqual([archivedActive, archivedInactive].sort());
      expect(await resolve({ archived: 'exclude' })).toEqual([live]);
      expect(await resolve({ archived: 'include' })).toEqual([live, archivedActive, archivedInactive].sort());
      // The selection's default stays "include", as before.
      expect(await resolve({})).toEqual([live, archivedActive, archivedInactive].sort());
      expect(await resolve({ includeArchived: false })).toEqual([live]);
      expect(await resolve({ archived: 'only', status: 'active' })).toEqual([archivedActive]);
    });

    it.each(['draft', 'archived'])('refuses status %s with 400 VALIDATION_FAILED', async (status) => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products/resolve-ids',
        ...admin,
        payload: { status },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });
});
