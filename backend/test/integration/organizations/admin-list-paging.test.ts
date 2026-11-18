import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOrganizationListResponseSchema } from '@endora-commerce/contracts';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1473 (UX audit SALES-08) — the admin Organizations list pages.
 *
 * Before this the route answered one `limit`-sized slice and a
 * `pagination.hasMore` that was always `false`, so the 51st Organization could
 * be reached only by searching for it. The list screen mounts the kit's
 * `PaginationFooter` now, which needs a page number and a total: `page` and
 * `pageSize` select an offset page, and `meta` carries `{ page, pageSize,
 * total }` in the shape the Customers list already answers with.
 *
 * Every query here is narrowed by `q` to this file's own rows, so the rows
 * other files leave in the shared database do not move the counts.
 */
describe('GET /api/v1/admin/organizations — offset paging (#1473)', () => {
  let h: BackendServerHandle;
  const tag = `Paging1473x${Date.now().toString(36)}`;
  const ids: string[] = [];
  const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (let i = 0; i < 5; i += 1) {
      const org = em.create(Organization, {
        name: `${tag} ${i}`,
        taxId: `PL1473${Math.floor(Math.random() * 9_999_999_999)
          .toString()
          .padStart(10, '0')}`,
        status: 'active',
        vatStatus: 'vat_payer',
        isPersonal: false,
        registeredAddress: { street: '-', city: '-', postalCode: '00-001', country: 'PL' },
      });
      em.persist(org);
      ids.push(org.id);
    }
    // One flush: the five rows can share a `createdAt`, which is exactly the
    // case a page boundary must still split without a duplicate or a gap.
    await em.flush();
  });

  afterAll(async () => teardownBackendServer(h));

  async function list(query: string): Promise<{
    ids: string[];
    meta: { page: number; pageSize: number; total: number };
    hasMore: boolean;
    body: unknown;
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations?q=${encodeURIComponent(tag)}&${query}`,
      ...ADMIN,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string }>;
      meta: { page: number; pageSize: number; total: number };
      pagination: { hasMore: boolean };
    };
    return { ids: body.data.map((o) => o.id), meta: body.meta, hasMore: body.pagination.hasMore, body };
  }

  it('answers one page and the total across all pages', async () => {
    const first = await list('page=1&pageSize=2');
    expect(first.ids).toHaveLength(2);
    expect(first.meta).toEqual({ page: 1, pageSize: 2, total: 5 });
    expect(first.hasMore).toBe(true);
    expect(adminOrganizationListResponseSchema.safeParse(first.body).success).toBe(true);
  });

  it('walks every row exactly once across the pages, in a stable order', async () => {
    const pages = await Promise.all([1, 2, 3].map((page) => list(`page=${page}&pageSize=2`)));
    const seen = pages.flatMap((p) => p.ids);
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(pages.map((p) => p.ids.length)).toEqual([2, 2, 1]);
    expect(pages[2]!.hasMore).toBe(false);
    expect(pages[2]!.meta).toEqual({ page: 3, pageSize: 2, total: 5 });
  });

  it('answers an empty page past the end, still with the total', async () => {
    const past = await list('page=9&pageSize=2');
    expect(past.ids).toEqual([]);
    expect(past.meta.total).toBe(5);
    expect(past.hasMore).toBe(false);
  });

  it('keeps `limit` as the page size for a caller that names no page (the pickers)', async () => {
    const legacy = await list('limit=3');
    expect(legacy.ids).toHaveLength(3);
    expect(legacy.meta).toEqual({ page: 1, pageSize: 3, total: 5 });
    expect(legacy.hasMore).toBe(true);
  });

  it('refuses a page size above the list maximum', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations?q=${encodeURIComponent(tag)}&pageSize=201`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(400);
  });
});
