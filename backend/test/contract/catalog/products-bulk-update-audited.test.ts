import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PRODUCT_HOOKABLE_ACTIONS } from '@endora-commerce/contracts';
import { CommandBus, type Command } from '@endora-commerce/platform/commands';
import { recordingCommandHooks, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
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
 * Issue #241 — a bulk edit writes each product through an audited Command (Principle XIII):
 * one Command Bus entry per product, co-transactional with its write, and the bulk undo
 * still restores them. A write that changes nothing — in bulk or on the single-product
 * PATCH — records no entry and announces no `product.updated.v1`.
 *
 * `specs/193-admin-form-extensions/` D-300.8 — that Command is `product.bulk_update.item`:
 * the `product.update` write under its own action, which is not hookable. So a module hook
 * on `product.update` runs for a single-product write and never for a bulk edit, inline or
 * queued, nor for its undo.
 */
const ITEM = 'product.bulk_update.item';

describe('bulk edit through the product.bulk_update.item Command (issue #241, D-300.8)', () => {
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

  const updateEntries = (ids: string[]) => h.em().fork().find(AuditLogEntry, { action: ITEM, objectId: { $in: ids } });
  const singleEntries = (ids: string[]) =>
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

  /**
   * The worker's service chain, on a Command Bus that remembers every Command it ran, with a
   * fixture module's recording `beforeCommit` hook on `product.update`.
   */
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
    const hook = recordingCommandHooks();
    const hooks = sealedCommandHookRegistry({
      hookableActions: Object.values(PRODUCT_HOOKABLE_ACTIONS).map((ref) => ({
        moduleId: 'catalog',
        action: ref.action,
        objectType: ref.objectType,
        phases: ref.phases,
      })),
      moduleDependencies: { acme_fixture: ['catalog'] },
      hooks: [{ moduleId: 'acme_fixture', entries: [hook.on(PRODUCT_HOOKABLE_ACTIONS.update)] }],
    });
    const commandBus = new RecordingBus(h.orm, audit, events, { hooks });
    const catalogAdmin = new CatalogAdminService(em, events as CatalogEventBus, audit, undefined, commandBus);
    const bulkUpdate = new CatalogBulkUpdateService(em, catalogAdmin, undefined, audit);
    const bulkOps = new BulkOperationService(em, bulkUpdate, { events: events as CatalogEventBus }, commandBus);
    const run = <T>(fn: () => Promise<T>) => withSystemScope('issue 241 bulk audited test — worker', fn);
    return { events, bulkOps, bulkUpdate, catalogAdmin, ran, run, hook };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a bulk edit of N products runs N product.bulk_update.item Commands, one entry each, and no product.update hook', async () => {
    const ids = await seedProducts(3, 'cmd');
    const { bulkUpdate, events, ran, run, hook } = chain();
    const seen = capture(events, ids);
    const result = await run(() => bulkUpdate.bulkUpdate({ productIds: ids, fields: { visibility: 'logged_in_only' } }));
    seen.stop();
    expect(result.summary).toEqual({ succeeded: 3, skipped: 0, failed: 0, total: 3 });
    expect(ran).toEqual(ids.map((objectId) => ({ action: ITEM, objectId })));
    expect(hook.calls).toEqual([]);
    expect(await singleEntries(ids)).toEqual([]);
    const entries = await updateEntries(ids);
    expect(entries.map((row) => row.objectId).sort()).toEqual([...ids].sort());
    for (const row of entries) {
      expect((row.stateAfter as { changedFields: string[] }).changedFields).toEqual(['visibility']);
    }
    expect(seen.seen).toEqual(ids.map((productId) => ({ productId, changedFields: ['visibility'] })));
  });

  it('the inline route writes one product.bulk_update.item entry per product, naming the admin', async () => {
    const ids = await seedProducts(2, 'inline');
    const res = await bulk(ids, { status: 'inactive' });
    expect(res.statusCode, res.body).toBe(200);
    const entries = await updateEntries(ids);
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((row) => row.actorAdminUserId)).size).toBe(1);
    expect(entries[0]!.actorAdminUserId).toBeTruthy();
    expect(await singleEntries(ids)).toEqual([]);
  });

  it('a single-product write runs product.update, its hook runs once, and its entry has the item entry’s shape', async () => {
    const [single, bulked] = await seedProducts(2, 'shape');
    const { bulkUpdate, catalogAdmin, ran, run, hook } = chain();
    await run(() => catalogAdmin.updateProductAudited(single!, { visibility: 'logged_in_only' }));
    await run(() => bulkUpdate.bulkUpdate({ productIds: [bulked!], fields: { visibility: 'logged_in_only' } }));
    expect(ran).toEqual([
      { action: 'product.update', objectId: single },
      { action: ITEM, objectId: bulked },
    ]);
    expect(hook.calls.map((call) => [call.action, call.objectId])).toEqual([['product.update', single]]);
    const [singleEntry] = await singleEntries([single!]);
    const [itemEntry] = await updateEntries([bulked!]);
    const keys = (state: unknown) => Object.keys((state ?? {}) as object).sort();
    expect(keys(itemEntry!.stateBefore)).toEqual(keys(singleEntry!.stateBefore));
    expect(keys(itemEntry!.stateAfter)).toEqual(keys(singleEntry!.stateAfter));
    expect(itemEntry!.objectType).toBe('product');
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
    expect(await singleEntries([id!])).toEqual([]);
    expect(seen.seen).toEqual([]);
  });

  it('the queued bulk edit audits each product through the item Command, its undo restores them, and no product.update hook runs', async () => {
    const ids = await seedProducts(60, 'queued');
    const res = await bulk(ids, { status: 'inactive' });
    expect(res.statusCode).toBe(202);
    const opId = (res.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;

    const { bulkOps, ran, run, hook } = chain();
    await run(() => bulkOps.processById(opId));
    const op = await bulkOps.get(opId);
    expect(op?.status).toBe('completed');
    expect(op?.reversible).toBe(true);
    expect(ran.filter((c) => c.action === ITEM).map((c) => c.objectId)).toEqual(ids);
    expect(ran.filter((c) => c.action === 'product.update')).toEqual([]);
    const entries = await updateEntries(ids);
    expect(entries).toHaveLength(60);
    expect(new Set(entries.map((row) => row.actorAdminUserId))).toEqual(new Set([op?.requestedByAdminUserId]));

    const undo = await run(() => bulkOps.undo(opId));
    expect(undo.ok).toBe(true);
    if (undo.ok) expect(undo.reverted).toHaveLength(60);
    const after = await h.em().fork().find(Product, { id: { $in: ids } });
    for (const p of after) expect(p.status).toBe('active');
    // Neither the queued edit nor its undo reached a product.update hook.
    expect(ran.filter((c) => c.action === 'product.update')).toEqual([]);
    expect(hook.calls).toEqual([]);
  }, 120_000);
});
