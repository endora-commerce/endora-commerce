import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CommandBus, type Command } from '@endora-commerce/platform/commands';
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
 * Issue #241 — a bulk edit writes each product through the same audited Command the
 * single-product edit uses (`product.update`, Principle XIII): one Command Bus entry per
 * product, co-transactional with its write, and the bulk undo still restores them. A write
 * that changes nothing — in bulk or on the single-product PATCH — records no entry and
 * announces no `product.updated.v1`.
 */
describe('bulk edit through the product.update Command (issue #241)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function seedProducts(count: number, label: string): Promise<string[]> {
    const em = h.em();
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const sku = `BAUD-${RUN}-${label}-${i}`;
      const p = em.create(Product, {
        sku,
        slug: sku.toLowerCase(),
        type: 'simple',
        status: 'active',
        name: `Bulk audited ${sku}`,
        description: '',
        visibility: 'public',
        allowedOrganizationIds: [],
        attributeValues: {},
        returnable: true,
      });
      em.persist(p);
      ids.push(p.id);
    }
    await em.flush();
    return ids;
  }

  const updateEntries = (ids: string[]) =>
    h.em().fork().find(AuditLogEntry, { action: 'product.update', objectId: { $in: ids } });

  function capture(bus: EventBus, ids: string[]) {
    const wanted = new Set(ids);
    const seen: Array<{ productId: string; changedFields: string[] }> = [];
    const off = bus.on('product.updated.v1' as never, ((p: { productId: string; changedFields: string[] }) => {
      if (wanted.has(p.productId)) seen.push({ productId: p.productId, changedFields: p.changedFields });
    }) as never);
    return { seen, stop: () => off() };
  }

  function bulk(productIds: string[], fields: Record<string, unknown>) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: { productIds, fields },
      cookies: adminCookie,
    });
  }

  /** The worker's service chain, on a Command Bus that remembers every Command it ran. */
  function chain() {
    const em = (): EntityManager => h.orm.em.fork();
    const events = new EventBus();
    const audit = h.auditLogService;
    const ran: Array<{ action: string; objectId: string }> = [];
    class RecordingBus extends CommandBus {
      override run<T>(command: Command<T>): Promise<T> {
        ran.push({ action: command.action, objectId: command.objectId });
        return super.run(command);
      }
    }
    const commandBus = new RecordingBus(h.orm, audit, events);
    const catalogAdmin = new CatalogAdminService(em, events as CatalogEventBus, audit, undefined, commandBus);
    const bulkUpdate = new CatalogBulkUpdateService(em, catalogAdmin, undefined, audit);
    const bulkOps = new BulkOperationService(em, bulkUpdate, { events: events as CatalogEventBus }, commandBus);
    const run = <T>(fn: () => Promise<T>) => withSystemScope('issue 241 bulk audited test — worker', fn);
    return { events, bulkOps, bulkUpdate, ran, run };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a bulk edit of N products runs N product.update Commands, one entry each', async () => {
    const ids = await seedProducts(3, 'cmd');
    const { bulkUpdate, events, ran, run } = chain();
    const seen = capture(events, ids);
    const result = await run(() => bulkUpdate.bulkUpdate({ productIds: ids, fields: { visibility: 'logged_in_only' } }));
    seen.stop();
    expect(result.summary).toEqual({ succeeded: 3, skipped: 0, failed: 0, total: 3 });
    expect(ran).toEqual(ids.map((objectId) => ({ action: 'product.update', objectId })));
    const entries = await updateEntries(ids);
    expect(entries.map((row) => row.objectId).sort()).toEqual([...ids].sort());
    for (const row of entries) {
      expect((row.stateAfter as { changedFields: string[] }).changedFields).toEqual(['visibility']);
    }
    expect(seen.seen).toEqual(ids.map((productId) => ({ productId, changedFields: ['visibility'] })));
  });

  it('the inline route writes one product.update entry per product, naming the admin', async () => {
    const ids = await seedProducts(2, 'inline');
    const res = await bulk(ids, { status: 'inactive' });
    expect(res.statusCode, res.body).toBe(200);
    const entries = await updateEntries(ids);
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((row) => row.actorAdminUserId)).size).toBe(1);
    expect(entries[0]!.actorAdminUserId).toBeTruthy();
  });

  it('a bulk edit that changes nothing records no entry and announces nothing', async () => {
    const ids = await seedProducts(2, 'noop');
    const seen = capture(h.eventBus, ids);
    const res = await bulk(ids, { status: 'active', visibility: 'public' });
    seen.stop();
    expect(res.statusCode, res.body).toBe(200);
    expect(await updateEntries(ids)).toEqual([]);
    expect(seen.seen).toEqual([]);
  });

  it('a single-product PATCH that changes nothing records no entry and announces nothing', async () => {
    const [id] = await seedProducts(1, 'single-noop');
    const seen = capture(h.eventBus, [id!]);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'active', visibility: 'public', returnable: true },
      cookies: adminCookie,
    });
    seen.stop();
    expect(res.statusCode, res.body).toBe(200);
    expect(await updateEntries([id!])).toEqual([]);
    expect(seen.seen).toEqual([]);
  });

  it('the queued bulk edit audits each product through the Command and its undo restores them', async () => {
    const ids = await seedProducts(60, 'queued');
    const res = await bulk(ids, { status: 'inactive' });
    expect(res.statusCode).toBe(202);
    const opId = (res.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;

    const { bulkOps, ran, run } = chain();
    await run(() => bulkOps.processById(opId));
    const op = await bulkOps.get(opId);
    expect(op?.status).toBe('completed');
    expect(op?.reversible).toBe(true);
    expect(ran.filter((c) => c.action === 'product.update').map((c) => c.objectId)).toEqual(ids);
    const entries = await updateEntries(ids);
    expect(entries).toHaveLength(60);
    expect(new Set(entries.map((row) => row.actorAdminUserId))).toEqual(new Set([op?.requestedByAdminUserId]));

    const undo = await run(() => bulkOps.undo(opId));
    expect(undo.ok).toBe(true);
    if (undo.ok) expect(undo.reverted).toHaveLength(60);
    const after = await h.em().fork().find(Product, { id: { $in: ids } });
    for (const p of after) expect(p.status).toBe('active');
  }, 120_000);
});
