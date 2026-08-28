import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { BulkOperationService } from '../../../../packages/modules/catalog/src/backend/services/bulk-operation.service.js';
import type {
  CatalogBulkUpdateService,
  BulkUpdateResult,
} from '../../../../packages/modules/catalog/src/backend/services/catalog-bulk-update.service.js';

/**
 * Consumer-side contract for the queued bulk-operation path (Constitution
 * Principle X). The producer (`create`) only enqueues; the BullMQ worker
 * invokes `processById`. These tests exercise `processById` directly to prove
 * the invariant holds independently of the queue transport:
 *
 *   - the producer hands the new row's id to `onEnqueued` exactly once;
 *   - `processById` claims the row atomically and runs the handler once;
 *   - a redelivered / duplicate `processById` is a no-op (idempotent), so two
 *     worker instances never double-process a job.
 */
describe('Bulk-operation queue consumer — processById', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const ADMIN_ID = '00000000-0000-0000-0000-000000000000';

  function fakeBulkUpdateService(onCall: () => void): CatalogBulkUpdateService {
    return {
      bulkUpdate: async (req: { productIds: string[] }): Promise<BulkUpdateResult> => {
        onCall();
        const total = req.productIds.length;
        return {
          bulkOperationId: 'n/a',
          summary: { succeeded: total, skipped: 0, failed: 0, total },
          results: req.productIds.map((productId) => ({
            productId,
            status: 'succeeded' as const,
          })),
        };
      },
    } as unknown as CatalogBulkUpdateService;
  }

  it('enqueues once on create and processes a product bulk update exactly once', async () => {
    const enqueued: string[] = [];
    let runs = 0;
    const svc = new BulkOperationService(h.em, fakeBulkUpdateService(() => (runs += 1)), {
      onEnqueued: (operationId) => {
        enqueued.push(operationId);
      },
    });

    const op = await svc.create({
      requestedByAdminUserId: ADMIN_ID,
      payload: { productIds: ['p1', 'p2', 'p3'], fields: { status: 'active' } },
    });

    // Producer enqueued exactly once with the persisted row's id.
    expect(enqueued).toEqual([op.id]);
    expect(op.status).toBe('pending');
    // A log trail is seeded on create so the detail view has a record.
    expect(op.logs?.length).toBeGreaterThanOrEqual(1);

    // Consumer runs the handler once and the row reaches `completed`.
    await svc.processById(op.id);
    expect(runs).toBe(1);
    const after = await svc.get(op.id);
    expect(after?.status).toBe('completed');
    expect(after?.succeeded).toBe(3);
    // The log trail grew with start + completion entries.
    expect(after?.logs?.some((l) => l.message.includes('Rozpoczęto'))).toBe(true);
    expect(after?.logs?.some((l) => l.message.includes('Zakończono'))).toBe(true);

    // Redelivery / a second worker claiming the same job is a no-op.
    await svc.processById(op.id);
    expect(runs).toBe(1);
    const again = await svc.get(op.id);
    expect(again?.status).toBe('completed');
  });

  it('processes a queued search_reindex operation through the reindex runner', async () => {
    let reindexRuns = 0;
    const svc = new BulkOperationService(h.em, fakeBulkUpdateService(() => undefined), {
      reindexRunner: async () => {
        reindexRuns += 1;
        return { documentCount: 42 };
      },
    });

    const op = await svc.create({
      type: 'search_reindex',
      requestedByAdminUserId: ADMIN_ID,
      payload: { productIds: [], fields: {} },
    });

    await svc.processById(op.id);
    expect(reindexRuns).toBe(1);
    const after = await svc.get(op.id);
    expect(after?.status).toBe('completed');
    expect(after?.processed).toBe(42);

    // Idempotent under redelivery.
    await svc.processById(op.id);
    expect(reindexRuns).toBe(1);
  });

  it('findPendingIds returns ids the worker must reconcile at boot', async () => {
    const svc = new BulkOperationService(h.em, fakeBulkUpdateService(() => undefined), {});
    const op = await svc.create({
      requestedByAdminUserId: ADMIN_ID,
      payload: { productIds: ['x1'], fields: { status: 'active' } },
    });

    const pending = await svc.findPendingIds();
    expect(pending).toContain(op.id);

    // Once claimed + processed it drops out of the pending set.
    await svc.processById(op.id);
    const afterPending = await svc.findPendingIds();
    expect(afterPending).not.toContain(op.id);
  });
});
