import { randomBytes, randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ScriptedLlm, seedPromptActionsSettings } from '../../helpers/prompt-actions.js';
import { Product } from '../../helpers/package-entities.js';
import { Category } from '../../helpers/package-entities.js';
import { BulkOperation } from '../../helpers/package-entities.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { PromptActionRequest } from '../../helpers/package-entities.js';

/**
 * T041 + T042 — US2 bulk flow (quickstart §3 step 4): preview with match
 * count + sample, additive category assignment on confirm, partial-failure
 * reporting, > 50 delegation to `catalog_bulk_operations`, bulk-limit
 * blocking, and the FR-018 unseen-outcomes surface.
 */

const adminCookie = { b2b_session: 'stub-admin-session' };

describe('US2 — bulk category assignment (T041/T042)', () => {
  let h: BackendServerHandle;
  const llm = new ScriptedLlm();
  let categoryId: string;
  let helmetIds: string[] = [];

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    h = await setupBackendServer({ promptActionsLlmFetch: llm.fetch });
    await seedPromptActionsSettings(h);

    const em = h.em();
    const category = em.create(Category, {
      name: { 'en-US': 'Helmets', 'pl-PL': 'Kaski' },
      slug: 'helmets-043',
    });
    await em.persistAndFlush(category);
    categoryId = category.id;

    helmetIds = [];
    for (let i = 0; i < 12; i += 1) {
      const p = em.create(Product, {
        sku: `HELMET-043-${i.toString().padStart(3, '0')}`,
        slug: `helmet-043-${i}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Helmets pro ${i}`, 'pl-PL': `Kask pro ${i}` },
        description: { 'en-US': 'US2 fixture' },
        visibility: 'public',
      });
      helmetIds.push(p.id);
    }
    // A non-matching product that must never be touched.
    em.create(Product, {
      sku: 'GLOVES-043-001',
      slug: 'gloves-043-1',
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Gloves basic', 'pl-PL': 'Rękawice' },
      description: { 'en-US': 'US2 fixture' },
      visibility: 'public',
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
  });

  beforeEach(async () => {
    llm.reset();
    const em = h.em();
    await em.nativeDelete(PromptActionRequest, {});
    await em.getConnection().execute(`delete from product_categories where category_id = ?`, [
      categoryId,
    ]);
  });

  async function assignedProductIds(): Promise<string[]> {
    const rows = await h
      .em()
      .getConnection()
      .execute<{ product_id: string }[]>(
        `select product_id from product_categories where category_id = ?`,
        [categoryId],
      );
    return rows.map((r) => r.product_id);
  }

  it('previews count + sample, assigns only matching products, reports per-item outcomes (US2/AC1–2)', async () => {
    llm
      .enqueueToolUse({ name: 'catalog.search_products', input: { q: 'Helmets', limit: 20 } })
      .enqueueToolUse({ name: 'catalog.search_categories', input: { q: 'Helmets' } })
      .enqueueToolUse({
        name: 'catalog.assign_products_to_category',
        input: { productIds: helmetIds, categoryId },
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'Przypisz wszystkie produkty Helmets do kategorii Helmets' },
    });
    expect(submit.statusCode).toBe(201);
    const body = submit.json() as {
      data: {
        id: string;
        status: string;
        plan: { operations: Array<{ preview: { affectedCount: number; sample: unknown[] } }> };
      };
    };
    expect(body.data.status).toBe('awaiting_confirmation');
    const preview = body.data.plan.operations[0]!.preview;
    expect(preview.affectedCount).toBe(12);
    expect(preview.sample).toHaveLength(10); // capped sample (≤ 10)

    const confirm = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${body.data.id}/confirm`,
      cookies: adminCookie,
    });
    expect(confirm.statusCode).toBe(200);
    const confirmed = confirm.json() as {
      data: { status: string; result: { operations: Array<{ summary: { total: number; succeeded: number; failed: number } }> } };
    };
    expect(confirmed.data.status).toBe('completed');
    expect(confirmed.data.result.operations[0]!.summary).toMatchObject({
      total: 12,
      succeeded: 12,
      failed: 0,
    });

    const assigned = await assignedProductIds();
    expect(assigned.sort()).toEqual([...helmetIds].sort());
  });

  it('removes only the named category, keeping other memberships (US2 remove)', async () => {
    const em = h.em();
    // A second category that must stay assigned after the removal.
    const other = em.create(Category, {
      name: { 'en-US': 'Gear', 'pl-PL': 'Sprzęt' },
      slug: 'gear-043',
    });
    await em.persistAndFlush(other);
    const ids = [...helmetIds.slice(0, 3)];
    // Pre-assign the 3 products to BOTH categories.
    for (const pid of ids) {
      await em
        .getConnection()
        .execute(`insert into product_categories (product_id, category_id) values (?, ?), (?, ?)`, [
          pid,
          categoryId,
          pid,
          other.id,
        ]);
    }

    llm
      .enqueueToolUse({ name: 'catalog.search_products', input: { q: 'Helmets', limit: 20 } })
      .enqueueToolUse({ name: 'catalog.search_categories', input: { q: 'Helmets' } })
      .enqueueToolUse({
        name: 'catalog.remove_products_from_category',
        input: { productIds: ids, categoryId },
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'Usuń te produkty z kategorii Helmets' },
    });
    expect(submit.statusCode).toBe(201);
    const body = submit.json() as {
      data: {
        id: string;
        status: string;
        plan: { operations: Array<{ preview: { affectedCount: number } }> };
      };
    };
    expect(body.data.status).toBe('awaiting_confirmation');
    expect(body.data.plan.operations[0]!.preview.affectedCount).toBe(3);

    const confirm = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${body.data.id}/confirm`,
      cookies: adminCookie,
    });
    expect(confirm.statusCode).toBe(200);
    expect((confirm.json() as { data: { status: string } }).data.status).toBe('completed');

    // Removed from the target category…
    expect(await assignedProductIds()).toHaveLength(0);
    // …but still assigned to the other category (subtractive, not replace).
    const stillInOther = await h
      .em()
      .getConnection()
      .execute<{ product_id: string }[]>(
        `select product_id from product_categories where category_id = ?`,
        [other.id],
      );
    expect(stillInOther.map((r) => r.product_id).sort()).toEqual([...ids].sort());

    await h.em().getConnection().execute(`delete from product_categories where category_id = ?`, [
      other.id,
    ]);
  });

  it('partial failures keep successes applied and list reasons (US2/AC3)', async () => {
    const ghostId = randomUUID();
    const ids = [...helmetIds.slice(0, 3)];
    llm
      .enqueueToolUse({
        name: 'catalog.assign_products_to_category',
        input: { productIds: ids, categoryId },
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'assign 3 helmets' },
    });
    const id = (submit.json() as { data: { id: string } }).data.id;

    // A product vanishes between preview and confirm (concurrent edit).
    const em = h.em();
    await em.getConnection().execute(`update prompt_action_requests set plan = jsonb_set(plan, '{operations,0,params,productIds}', ?::jsonb) where id = ?`, [
      JSON.stringify([...ids, ghostId]),
      id,
    ]);

    const confirm = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/confirm`,
      cookies: adminCookie,
    });
    expect(confirm.statusCode).toBe(200);
    const confirmed = confirm.json() as {
      data: {
        status: string;
        result: {
          outcome: string;
          operations: Array<{
            summary: { succeeded: number; failed: number; failures: Array<{ id: string }> };
          }>;
        };
      };
    };
    expect(confirmed.data.status).toBe('completed_with_errors');
    const summary = confirmed.data.result.operations[0]!.summary;
    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.failures.map((f) => f.id)).toContain(ghostId);
    // Successes stayed applied (FR-011).
    expect((await assignedProductIds()).sort()).toEqual([...ids].sort());
  });

  it('> 50 products delegate to catalog_bulk_operations and GET folds progress in (US2 delegation)', async () => {
    // 60 ids: pad the helmets with ad-hoc products.
    const em = h.em();
    const extraIds: string[] = [];
    for (let i = 0; i < 48; i += 1) {
      const p = em.create(Product, {
        sku: `HELMET-043-X${i.toString().padStart(3, '0')}`,
        slug: `helmet-043-x${i}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Helmets extra ${i}` },
        description: { 'en-US': 'US2 fixture' },
        visibility: 'public',
      });
      extraIds.push(p.id);
    }
    await em.flush();
    const allIds = [...helmetIds, ...extraIds];
    expect(allIds.length).toBeGreaterThan(50);

    llm
      .enqueueToolUse({
        name: 'catalog.assign_products_to_category',
        input: { productIds: allIds, categoryId },
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'assign all helmets' },
    });
    const id = (submit.json() as { data: { id: string } }).data.id;

    const confirm = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/confirm`,
      cookies: adminCookie,
    });
    expect(confirm.statusCode).toBe(200);
    const confirmed = confirm.json() as {
      data: { status: string; bulkOperationId: string | null };
    };
    expect(confirmed.data.status).toBe('executing');
    expect(confirmed.data.bulkOperationId).toBeTruthy();

    // The durable row exists with the full payload (Principle X producer).
    const op = await em.findOneOrFail(BulkOperation, { id: confirmed.data.bulkOperationId! });
    expect(op.total).toBe(allIds.length);

    // Drive the worker path deterministically (tests have no BullMQ worker).
    //
    // The three specifiers name the package's `dist`, not its `src`, and that is
    // load-bearing rather than stylistic (D-160.6.1): each of these files imports
    // `catalog`'s entity classes, and the ORM in this process registered the ones
    // behind `dist` — `entities-registry.generated.ts` imports the same published
    // array. A source copy would hand `processById` a `BulkOperation` class the
    // ORM has never discovered, while `em.findOneOrFail(BulkOperation, …)` above
    // uses the registered one. `check:singleton-identity` reports the source
    // spelling as a `whole-file-reach`: a dynamic import names no binding, so it
    // takes each file's entire graph.
    const { BulkOperationService } = await import(
      '../../../../packages/modules/catalog/dist/backend/services/bulk-operation.service.js'
    );
    const { CatalogBulkUpdateService } = await import(
      '../../../../packages/modules/catalog/dist/backend/services/catalog-bulk-update.service.js'
    );
    const { CatalogAdminService } = await import(
      '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js'
    );
    const adminService = new CatalogAdminService(h.em, h.eventBus as never, h.auditLogService);
    const updater = new CatalogBulkUpdateService(h.em, adminService, undefined, h.auditLogService);
    const opService = new BulkOperationService(h.em, updater, {});
    await opService.processById(op.id);

    // GET folds the finished bulk run into the request and finalizes it.
    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/prompt-actions/requests/${id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(200);
    const folded = get.json() as {
      data: {
        status: string;
        result: { operations: Array<{ status: string; summary: { total: number; succeeded: number } }> };
      };
    };
    expect(folded.data.status).toBe('completed');
    expect(folded.data.result.operations[0]!.status).toBe('delegated');
    expect(folded.data.result.operations[0]!.summary).toMatchObject({
      total: allIds.length,
      succeeded: allIds.length,
    });
    expect((await assignedProductIds()).length).toBe(allIds.length);

    // The fold-in also wrote the prompt_action.execute audit on completion.
    const audits = await h.em().find(AuditLogEntry, {
      action: 'prompt_action.execute',
      objectId: id,
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('blocks plans whose preview exceeds prompt_actions.bulk_limit (FR-010)', async () => {
    await seedPromptActionsSettings(h, { bulkLimit: 5 });
    llm
      .enqueueToolUse({
        name: 'catalog.assign_products_to_category',
        input: { productIds: helmetIds, categoryId }, // 12 > 5
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'assign all helmets' },
    });
    expect(submit.statusCode).toBe(201);
    const body = submit.json() as { data: { status: string; error: string | null } };
    expect(body.data.status).toBe('unsupported');
    expect(body.data.error).toContain('12');
    expect(body.data.error).toContain('5');
    expect(await assignedProductIds()).toHaveLength(0);

    await seedPromptActionsSettings(h, { bulkLimit: 500 });
  });

  it('finished requests surface via ?unseen=true until acknowledged (FR-018)', async () => {
    llm
      .enqueueToolUse({
        name: 'catalog.assign_products_to_category',
        input: { productIds: helmetIds.slice(0, 2), categoryId },
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'assign two helmets' },
    });
    const id = (submit.json() as { data: { id: string } }).data.id;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/confirm`,
      cookies: adminCookie,
    });

    const unseen = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/prompt-actions/requests?unseen=true&limit=3',
      cookies: adminCookie,
    });
    expect(unseen.statusCode).toBe(200);
    const list = (unseen.json() as { data: Array<{ id: string }> }).data;
    expect(list.map((r) => r.id)).toContain(id);

    const seen = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/seen`,
      cookies: adminCookie,
    });
    expect(seen.statusCode).toBe(204);

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/prompt-actions/requests?unseen=true&limit=3',
      cookies: adminCookie,
    });
    expect((after.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).not.toContain(
      id,
    );
  });
});
