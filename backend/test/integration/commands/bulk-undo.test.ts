import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { CommandBus } from '../../../src/commands/command-bus.js';
import { EventBus } from '../../../src/events/bus.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import {
  CatalogAdminService,
  type CatalogEventBus,
} from '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js';
import { CatalogBulkUpdateService } from '../../../../packages/modules/catalog/dist/backend/services/catalog-bulk-update.service.js';
import { BulkOperationService } from '../../../../packages/modules/catalog/dist/backend/services/bulk-operation.service.js';
import { Product } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * US2 (T021) — bulk-edit undo against a real DB.
 *
 * Drives the real service chain (CommandBus → CatalogBulkUpdate →
 * CatalogAdmin) so revert-state capture + the audited, conflict-aware undo run
 * end-to-end. Covers: full restore, a changed-subset conflict (SC-002), the
 * non-reversible case, and idempotent re-invocation (FR-014).
 */
describe('bulk-edit undo (feature 054, US2) [real DB]', () => {
  let h: BackendServerHandle;
  let orm: MikroORM;
  let bulkOps: BulkOperationService;
  const admin = randomUUID();

  const status = async (id: string): Promise<string> => {
    const p = await orm.em.fork().findOne(Product, { id });
    return p!.status;
  };

  async function runBulk(productIds: string[], fields: Record<string, unknown>): Promise<string> {
    const op = await bulkOps.create({ requestedByAdminUserId: admin, payload: { productIds, fields } });
    await bulkOps.processById(op.id);
    return op.id;
  }

  beforeAll(async () => {
    // Reuses the harness truncate + us1-catalog seed (products 101/102 exist).
    h = await setupBackendServer();
    orm = h.orm;
    const em = (): EntityManager => orm.em.fork();
    const events = new EventBus();
    const audit = new AuditLogService(em);
    const commandBus = new CommandBus(orm, audit, events);
    const catalogAdmin = new CatalogAdminService(em, events as CatalogEventBus, audit);
    const bulkUpdate = new CatalogBulkUpdateService(em, catalogAdmin, undefined, audit);
    bulkOps = new BulkOperationService(em, bulkUpdate, {}, commandBus);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('captures revert state and undoes a status bulk edit, restoring every product + auditing the undo', async () => {
    expect(await status(SEED_PRODUCT_101_ID)).toBe('active');
    const opId = await runBulk([SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID], { status: 'inactive' });

    const op = await orm.em.fork().findOne(
      (await import('../../helpers/package-entities.js')).BulkOperation,
      { id: opId },
    );
    expect(op?.reversible).toBe(true);
    expect(op?.revertState).toHaveLength(2);
    expect(await status(SEED_PRODUCT_101_ID)).toBe('inactive');

    const res = await bulkOps.undo(opId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reverted.sort()).toEqual([SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID].sort());
      expect(res.conflicts).toEqual([]);
      expect(res.undoStatus).toBe('reverted');
    }
    expect(await status(SEED_PRODUCT_101_ID)).toBe('active');
    expect(await status(SEED_PRODUCT_102_ID)).toBe('active');

    const undoAudits = await orm.em
      .fork()
      .find(AuditLogEntry, { action: 'product.bulk_update.undo', objectId: opId });
    expect(undoAudits).toHaveLength(1);
  });

  it('refuses records changed since the operation (SC-002) — partial undo with a conflict report', async () => {
    const opId = await runBulk([SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID], { status: 'inactive' });
    expect(await status(SEED_PRODUCT_101_ID)).toBe('inactive');

    // Simulate a later edit to 101 that no longer matches the operation's
    // after-state (status flipped back but archivedAt left as the op set it).
    await orm.em.fork().nativeUpdate(Product, { id: SEED_PRODUCT_101_ID }, { status: 'active' });

    const res = await bulkOps.undo(opId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reverted).toEqual([SEED_PRODUCT_102_ID]);
      expect(res.conflicts).toEqual([
        { recordId: SEED_PRODUCT_101_ID, reason: 'changed_since_operation' },
      ]);
      expect(res.undoStatus).toBe('partially_reverted');
    }
    // 102 restored; 101 left exactly as the later edit set it (never clobbered).
    expect(await status(SEED_PRODUCT_102_ID)).toBe('active');
  });

  it('does not offer undo for a non-reversible edit (category bridge touched)', async () => {
    const opId = await runBulk([SEED_PRODUCT_102_ID], { categoryIds: [] });
    const op = await orm.em.fork().findOne(
      (await import('../../helpers/package-entities.js')).BulkOperation,
      { id: opId },
    );
    expect(op?.reversible).toBe(false);
    const res = await bulkOps.undo(opId);
    expect(res).toEqual({ ok: false, code: 'NOT_REVERSIBLE' });
  });

  it('is idempotent-safe: a second undo after a full revert is refused as already reverted (FR-014)', async () => {
    const opId = await runBulk([SEED_PRODUCT_102_ID], { status: 'inactive' });
    const first = await bulkOps.undo(opId);
    expect(first.ok).toBe(true);
    const second = await bulkOps.undo(opId);
    expect(second).toEqual({ ok: false, code: 'ALREADY_REVERTED' });
  });
});
