import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  BulkOperationService,
  type SearchReindexRunner,
} from '../../../src/modules/catalog/services/bulk-operation.service.js';
import type { CatalogBulkUpdateService } from '../../../src/modules/catalog/services/catalog-bulk-update.service.js';

/**
 * Flipping an attribute's `searchable` flag must enqueue a full Meilisearch
 * reindex as a `search_reindex` bulk operation (the `search:reindex` CLI
 * equivalent) — visible on the "Akcje masowe" page. A save that leaves the
 * flag untouched (or only changes other fields) must NOT enqueue one.
 *
 * The test harness keeps the bulk-operation sweeper off, so a queued op
 * stays `pending` — exactly what we assert via the bulk-operations list.
 */
describe('Attribute searchable flip → search_reindex bulk operation', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createAttribute(key: string, isSearchable: boolean): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key,
        label: { 'en-US': key },
        labelDefault: key,
        valueType: 'string',
        isSearchable,
        isFilterable: false,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function patchAttribute(
    idOrKey: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${idOrKey}`,
      payload: body,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
  }

  async function countReindexOps(): Promise<number> {
    // Counted straight from the DB: the HTTP list is windowed (limit ≤ 100),
    // so on the long-lived shared test database the windowed count saturates
    // once enough newer bulk operations accumulate, turning the `before + 1`
    // assertions flaky. The list endpoint's shape is still asserted below.
    const rows = await h
      .em()
      .getConnection()
      .execute<{ count: string | number }[]>(
        `select count(*) as count from catalog_bulk_operations where type = 'search_reindex'`,
      );
    return Number(rows[0]?.count ?? 0);
  }

  it('enqueues a search_reindex op when isSearchable flips false → true', async () => {
    const before = await countReindexOps();
    const id = await createAttribute('reindex_flip_on', false);

    await patchAttribute(id, { isSearchable: true });

    const after = await countReindexOps();
    expect(after).toBe(before + 1);

    // The newest reindex op is pending (sweeper off) and product-agnostic.
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/bulk-operations?limit=100',
      cookies: adminCookie,
    });
    const op = (list.json() as {
      data: Array<{ type: string; status: string; touchedFields: string[] }>;
    }).data.find((r) => r.type === 'search_reindex');
    expect(op?.status).toBe('pending');
    expect(op?.touchedFields).toEqual([]);
  });

  it('does NOT enqueue when the save leaves isSearchable unchanged', async () => {
    const id = await createAttribute('reindex_no_flip', true);
    const before = await countReindexOps();

    // Same value (true → true): no flip.
    await patchAttribute(id, { isSearchable: true });
    // A label-only change: searchable untouched.
    await patchAttribute(id, { labelDefault: 'Renamed' });

    expect(await countReindexOps()).toBe(before);
  });

  it('enqueues again when isSearchable flips back true → false', async () => {
    const id = await createAttribute('reindex_flip_off', true);
    const before = await countReindexOps();

    await patchAttribute(id, { isSearchable: false });

    expect(await countReindexOps()).toBe(before + 1);
  });

  it('processing a search_reindex op invokes the reindex runner and completes it', async () => {
    let calls = 0;
    const runner: SearchReindexRunner = async () => {
      calls += 1;
      return { documentCount: 42 };
    };
    // The reindex branch never touches the product bulk-update service.
    const svc = new BulkOperationService(
      () => h.em(),
      undefined as unknown as CatalogBulkUpdateService,
      { reindexRunner: runner },
    );

    const op = await svc.create({
      type: 'search_reindex',
      requestedByAdminUserId: '00000000-0000-0000-0000-000000000000',
      payload: { productIds: [], fields: {} },
    });
    expect(op.status).toBe('pending');

    await svc.processPending();

    const after = await svc.get(op.id);
    // processPending drains every pending row (including any queued by the
    // trigger tests above), so the runner may fire more than once — what
    // matters is that it ran and this op completed with the runner's counts.
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(after?.status).toBe('completed');
    expect(after?.total).toBe(42);
    expect(after?.processed).toBe(42);
    expect(after?.succeeded).toBe(42);
    expect(after?.failed).toBe(0);
  });

  it('a search_reindex op fails clearly when no reindex runner is configured', async () => {
    const svc = new BulkOperationService(
      () => h.em(),
      undefined as unknown as CatalogBulkUpdateService,
      {},
    );
    const op = await svc.create({
      type: 'search_reindex',
      requestedByAdminUserId: '00000000-0000-0000-0000-000000000000',
      payload: { productIds: [], fields: {} },
    });
    await svc.processPending();
    const after = await svc.get(op.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/not configured/i);
  });
});
