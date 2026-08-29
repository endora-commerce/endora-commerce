import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 054 (US2 / T020) — undo endpoint error envelopes.
 *
 * The success + conflict-report + idempotency paths (which need a processed
 * operation with revert state) are covered end-to-end by
 * test/integration/commands/bulk-undo.test.ts. Here we assert the HTTP mapping
 * for the two envelopes reachable without processing: 404 (unknown id) and 409
 * (a non-reversible operation — a freshly queued op is not `completed`).
 */
describe('POST /admin/catalog/bulk-operations/:id/undo — error envelopes', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 404 for an unknown operation id', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/bulk-operations/11111111-2222-4333-8444-555555555555/undo',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('returns 409 for a non-reversible (not-yet-completed) operation', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => {
      const tail = String(i + 1).padStart(12, '0');
      return `44444444-5555-4666-8777-${tail}`;
    });
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: { productIds: ids, fields: { status: 'active' } },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(202);
    const opId = (create.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/bulk-operations/${opId}/undo`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.VERSION_CONFLICT,
    );
  });
});
