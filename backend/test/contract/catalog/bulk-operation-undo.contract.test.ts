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
 * for the envelopes: 404 (unknown id) and the three 409 refusals, each with its
 * own code (issue #501) — an operation row is set to the state under test.
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

  // Issue #501, item 3 (ruling A) — each refusal carries its own catalog code, so the
  // admin can say why: an operation still in flight used to answer `VERSION_CONFLICT`.
  async function queueOperation(seed: string): Promise<string> {
    const ids = Array.from({ length: 51 }, (_, i) => {
      const tail = String(i + 1).padStart(12, '0');
      return `${seed}-5555-4666-8777-${tail}`;
    });
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: { productIds: ids, fields: { status: 'active' } },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(202);
    return (create.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;
  }

  async function setRow(
    opId: string,
    row: { status: string; reversible: boolean; revertState: unknown; undoStatus: string },
  ): Promise<void> {
    await h
      .em()
      .getConnection()
      .execute(
        'update catalog_bulk_operations set status = ?, reversible = ?, revert_state = ?, undo_status = ? where id = ?',
        [row.status, row.reversible, JSON.stringify(row.revertState), row.undoStatus, opId],
      );
  }

  async function undo(opId: string): Promise<{ statusCode: number; code: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/bulk-operations/${opId}/undo`,
      cookies: adminCookie,
    });
    return { statusCode: res.statusCode, code: (res.json() as { error: { code: string } }).error.code };
  }

  it('returns 409 BULK_OPERATION_RUNNING for a queued operation', async () => {
    const opId = await queueOperation('44444444');
    expect(await undo(opId)).toEqual({ statusCode: 409, code: ERROR_CODES.BULK_OPERATION_RUNNING });
  });

  it('returns 409 BULK_OPERATION_RUNNING for a running operation', async () => {
    const opId = await queueOperation('44444445');
    await setRow(opId, { status: 'running', reversible: false, revertState: null, undoStatus: 'none' });
    expect(await undo(opId)).toEqual({ statusCode: 409, code: ERROR_CODES.BULK_OPERATION_RUNNING });
  });

  it('returns 409 BULK_OPERATION_NOT_REVERSIBLE for a completed operation with nothing to revert', async () => {
    const opId = await queueOperation('44444446');
    await setRow(opId, { status: 'completed', reversible: false, revertState: null, undoStatus: 'none' });
    expect(await undo(opId)).toEqual({ statusCode: 409, code: ERROR_CODES.BULK_OPERATION_NOT_REVERSIBLE });
  });

  it('returns 409 BULK_OPERATION_ALREADY_REVERTED for an operation already undone', async () => {
    const opId = await queueOperation('44444447');
    await setRow(opId, {
      status: 'completed',
      reversible: true,
      revertState: [{ recordId: '44444447-5555-4666-8777-000000000001', before: { status: 'inactive' }, after: { status: 'active' } }],
      undoStatus: 'reverted',
    });
    expect(await undo(opId)).toEqual({ statusCode: 409, code: ERROR_CODES.BULK_OPERATION_ALREADY_REVERTED });
  });
});
