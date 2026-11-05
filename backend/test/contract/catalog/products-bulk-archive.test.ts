import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  CatalogAdminService,
  type CatalogEventBus,
} from '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js';
import { CatalogBulkUpdateService } from '../../../../packages/modules/catalog/dist/backend/services/catalog-bulk-update.service.js';
import { BulkOperationService } from '../../../../packages/modules/catalog/dist/backend/services/bulk-operation.service.js';
import { Product } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, Phase 9b (T156k) — bulk Archive / Restore on the existing bulk-update
 * path (FR-053, FR-082; research R30.3):
 *
 * - `fields.archived: true` archives every selected product through the single-product
 *   `product.archive` Command — one audit entry each, `product.updated.v1`
 *   `['archivedAt']` then `product.archived.v1` per transition; `false` restores;
 * - a product already in the requested state is `succeeded` with `changedFields: []`,
 *   no audit entry and no event (O-6);
 * - `archived` beside any other field is `400 VALIDATION_FAILED`;
 * - above `BULK_ASYNC_THRESHOLD` the request is queued; the undo restores
 *   `archivedAt` as a whole with the per-product conflict report and **announces**
 *   what it reverted: `product.updated.v1` per product, plus `product.archived.v1`
 *   where it re-archives;
 * - a bulk **status** change leaves `archivedAt` alone, and its undo restores the
 *   status only and announces `product.updated.v1` `['status']` per product.
 */
describe('POST /products/bulk-update — fields.archived (spec 163, T156k)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function seedProducts(count: number, label: string, status: 'active' | 'inactive' = 'active'): Promise<string[]> {
    const em = h.em();
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const sku = `BARCH-${RUN}-${label}-${i}`;
      const p = em.create(Product, {
        sku,
        slug: sku.toLowerCase(),
        type: 'simple',
        status,
        name: `Bulk archive ${sku}`,
        description: '',
        visibility: 'public',
        allowedOrganizationIds: [],
        attributeValues: {},
      });
      em.persist(p);
      ids.push(p.id);
    }
    await em.flush();
    return ids;
  }

  async function rows(ids: string[]): Promise<Map<string, { status: string; archivedAt: Date | null }>> {
    const found = await h.em().fork().find(Product, { id: { $in: ids } });
    return new Map(found.map((p) => [p.id, { status: p.status, archivedAt: p.archivedAt ?? null }]));
  }

  function bulk(productIds: string[], fields: Record<string, unknown>) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: { productIds, fields },
      cookies: adminCookie,
    });
  }

  /** Every `product.updated.v1` / `product.archived.v1` on `bus` for `ids`, in dispatch order. */
  function capture(bus: EventBus, ids: string[]) {
    const wanted = new Set(ids);
    const seen: Array<{ name: string; productId: string; changedFields?: string[] }> = [];
    const offs = [
      bus.on('product.updated.v1' as never, ((p: { productId: string; changedFields: string[] }) => {
        if (wanted.has(p.productId)) seen.push({ name: 'product.updated.v1', productId: p.productId, changedFields: p.changedFields });
      }) as never),
      bus.on('product.archived.v1' as never, ((p: { productId: string }) => {
        if (wanted.has(p.productId)) seen.push({ name: 'product.archived.v1', productId: p.productId });
      }) as never),
    ];
    return { seen, stop: () => offs.forEach((off) => off()) };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('inline path', () => {
    it('archives every product through one product.archive entry each, announcing updated then archived', async () => {
      const ids = await seedProducts(3, 'inline');
      const events = capture(h.eventBus, ids);
      const res = await bulk(ids, { archived: true });
      events.stop();
      expect(res.statusCode).toBe(200);
      const results = (res.json() as { data: { results: Array<{ productId: string; status: string; changedFields?: string[] }> } })
        .data.results;
      expect(results).toEqual(
        expect.arrayContaining(ids.map((productId) => expect.objectContaining({ productId, status: 'succeeded', changedFields: ['archivedAt'] }))),
      );
      const stored = await rows(ids);
      for (const id of ids) {
        expect(stored.get(id)?.status).toBe('active');
        expect(stored.get(id)?.archivedAt).not.toBeNull();
      }
      for (const id of ids) {
        const audits = await h.em().fork().find(AuditLogEntry, { action: 'product.archive', objectId: id });
        expect(audits).toHaveLength(1);
        expect(await h.em().fork().find(AuditLogEntry, { action: 'product.update', objectId: id })).toHaveLength(0);
        expect(events.seen.filter((e) => e.productId === id)).toEqual([
          { name: 'product.updated.v1', productId: id, changedFields: ['archivedAt'] },
          { name: 'product.archived.v1', productId: id },
        ]);
      }
    });

    it('an already archived product is succeeded with changedFields [] and no entry, no event (O-6)', async () => {
      const [id] = await seedProducts(1, 'noop');
      expect((await bulk([id!], { archived: true })).statusCode).toBe(200);
      const events = capture(h.eventBus, [id!]);
      const res = await bulk([id!], { archived: true });
      events.stop();
      expect(res.statusCode).toBe(200);
      const [result] = (res.json() as { data: { results: Array<{ status: string; changedFields?: string[] }> } }).data.results;
      expect(result).toMatchObject({ status: 'succeeded', changedFields: [] });
      expect(await h.em().fork().find(AuditLogEntry, { action: 'product.archive', objectId: id! })).toHaveLength(1);
      expect(events.seen).toEqual([]);
    });

    it('archived: false restores, with one product.restore entry and product.updated.v1 only', async () => {
      const ids = await seedProducts(2, 'restore', 'inactive');
      expect((await bulk(ids, { archived: true })).statusCode).toBe(200);
      const events = capture(h.eventBus, ids);
      const res = await bulk(ids, { archived: false });
      events.stop();
      expect(res.statusCode).toBe(200);
      const stored = await rows(ids);
      for (const id of ids) {
        expect(stored.get(id)).toEqual({ status: 'inactive', archivedAt: null });
        expect(await h.em().fork().find(AuditLogEntry, { action: 'product.restore', objectId: id })).toHaveLength(1);
        expect(events.seen.filter((e) => e.productId === id)).toEqual([
          { name: 'product.updated.v1', productId: id, changedFields: ['archivedAt'] },
        ]);
      }
    });

    it.each([
      ['status', { status: 'active' }],
      ['visibility', { visibility: 'public' }],
      ['returnable', { returnable: true }],
    ])('refuses archived beside %s with 400 VALIDATION_FAILED and writes nothing', async (_name, other) => {
      const [id] = await seedProducts(1, `mix-${_name}`);
      const res = await bulk([id!], { archived: true, ...other });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect((await rows([id!])).get(id!)?.archivedAt).toBeNull();
    });

    it('a bulk status change leaves archivedAt alone (FR-010)', async () => {
      const ids = await seedProducts(2, 'status');
      expect((await bulk([ids[0]!], { archived: true })).statusCode).toBe(200);
      const archivedAt = (await rows([ids[0]!])).get(ids[0]!)?.archivedAt;
      expect((await bulk(ids, { status: 'inactive' })).statusCode).toBe(200);
      const stored = await rows(ids);
      expect(stored.get(ids[0]!)?.archivedAt?.getTime()).toBe(archivedAt?.getTime());
      expect(stored.get(ids[1]!)?.archivedAt).toBeNull();
    });
  });

  describe('queued path and undo', () => {
    /** The worker's service chain, on a bus of its own so the emissions can be watched. */
    function chain() {
      const em = (): EntityManager => h.orm.em.fork();
      const events = new EventBus();
      const audit = h.auditLogService;
      const commandBus = new CommandBus(h.orm, audit, events);
      const catalogAdmin = new CatalogAdminService(em, events as CatalogEventBus, audit, undefined, commandBus);
      const bulkUpdate = new CatalogBulkUpdateService(em, catalogAdmin, undefined, audit);
      const bulkOps = new BulkOperationService(em, bulkUpdate, { events: events as CatalogEventBus }, commandBus);
      const run = <T>(fn: () => Promise<T>) => withSystemScope('163 bulk archive test — worker', fn);
      return { events, bulkOps, run };
    }

    it('queues above the threshold, archives through the Command, and the undo restores and announces it', async () => {
      const ids = await seedProducts(60, 'queued');
      const res = await bulk(ids, { archived: true });
      expect(res.statusCode).toBe(202);
      const opId = (res.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;

      const { events, bulkOps, run } = chain();
      await run(() => bulkOps.processById(opId));
      const op = await bulkOps.get(opId);
      expect(op?.status).toBe('completed');
      expect(op?.succeeded).toBe(60);
      expect(op?.reversible).toBe(true);
      expect(op?.touchedFields).toEqual(['archived']);
      const archivedRows = await rows(ids);
      for (const id of ids) expect(archivedRows.get(id)?.archivedAt).not.toBeNull();
      expect(await h.em().fork().count(AuditLogEntry, { action: 'product.archive', objectId: { $in: ids } })).toBe(60);
      // S-W2 — the worker acts for the admin who queued the operation: every entry names them.
      const actors = new Set(
        (await h.em().fork().find(AuditLogEntry, { action: 'product.archive', objectId: { $in: ids } })).map(
          (row) => row.actorAdminUserId,
        ),
      );
      expect(op?.requestedByAdminUserId).toBeTruthy();
      expect([...actors]).toEqual([op?.requestedByAdminUserId]);

      // A later Restore and re-Archive of one product gives it an archived time that
      // is neither the operation's before-state nor its after-state: a conflict,
      // never clobbered. (Put back to its before-state it would count as reverted.)
      const changed = ids[0]!;
      expect((await bulk([changed], { archived: false })).statusCode).toBe(200);
      expect((await bulk([changed], { archived: true })).statusCode).toBe(200);
      const rearchivedAt = (await rows([changed])).get(changed)?.archivedAt;

      const seen = capture(events, ids);
      const undo = await run(() => bulkOps.undo(opId));
      seen.stop();
      expect(undo.ok).toBe(true);
      if (undo.ok) {
        expect(undo.conflicts).toEqual([{ recordId: changed, reason: 'changed_since_operation' }]);
        expect(undo.reverted).toHaveLength(59);
      }
      const after = await rows(ids);
      for (const id of ids.slice(1)) expect(after.get(id)?.archivedAt).toBeNull();
      expect(after.get(changed)?.archivedAt?.getTime()).toBe(rearchivedAt?.getTime());
      for (const id of ids.slice(1)) {
        expect(seen.seen.filter((e) => e.productId === id)).toEqual([
          { name: 'product.updated.v1', productId: id, changedFields: ['archivedAt'] },
        ]);
      }
      expect(seen.seen.filter((e) => e.productId === changed)).toEqual([]);
    }, 120_000);

    it('undoing a bulk Restore re-archives and announces product.archived.v1', async () => {
      const ids = await seedProducts(60, 'requeued');
      const { events, bulkOps, run } = chain();
      // Archive them first, through the queued path too.
      const first = await bulk(ids, { archived: true });
      await run(() => bulkOps.processById((first.json() as { data: { bulkOperationId: string } }).data.bulkOperationId));
      const res = await bulk(ids, { archived: false });
      expect(res.statusCode).toBe(202);
      const opId = (res.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;
      await run(() => bulkOps.processById(opId));
      for (const id of ids) expect((await rows([id])).get(id)?.archivedAt).toBeNull();

      const seen = capture(events, ids);
      const undo = await run(() => bulkOps.undo(opId));
      seen.stop();
      expect(undo.ok).toBe(true);
      const after = await rows(ids);
      for (const id of ids) {
        expect(after.get(id)?.archivedAt).not.toBeNull();
        expect(seen.seen.filter((e) => e.productId === id)).toEqual([
          { name: 'product.updated.v1', productId: id, changedFields: ['archivedAt'] },
          { name: 'product.archived.v1', productId: id },
        ]);
      }
    }, 120_000);

    it('a bulk status undo restores the status only and announces product.updated.v1 [status]', async () => {
      const ids = await seedProducts(60, 'statusq');
      const { events, bulkOps, run } = chain();
      const res = await bulk(ids, { status: 'inactive' });
      expect(res.statusCode).toBe(202);
      const opId = (res.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;
      await run(() => bulkOps.processById(opId));
      const op = await bulkOps.get(opId);
      expect(op?.reversible).toBe(true);

      const seen = capture(events, ids);
      const undo = await run(() => bulkOps.undo(opId));
      seen.stop();
      expect(undo.ok).toBe(true);
      const after = await rows(ids);
      for (const id of ids) {
        expect(after.get(id)).toEqual({ status: 'active', archivedAt: null });
        expect(seen.seen.filter((e) => e.productId === id)).toEqual([
          { name: 'product.updated.v1', productId: id, changedFields: ['status'] },
        ]);
      }
    }, 120_000);
  });
});
