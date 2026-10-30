import { randomBytes } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ScriptedLlm, seedPromptActionsSettings } from '../../helpers/prompt-actions.js';
import { Product } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * Feature 163, owner decision P-1 = A (2026-10-26) — the assistant archives and
 * restores products through the audited Archive / Restore Commands (FR-019),
 * with the confirming admin as the audit entry's actor, and only after the
 * operator confirms the plan.
 *
 *  - `catalog.search_products` finds an archived product and says so — without
 *    it `catalog.restore_product` could never be resolved;
 *  - archive writes `archivedAt` and one `product.archive` entry per product,
 *    actor = the admin; the status is untouched;
 *  - restore clears it with one `product.restore` entry; status untouched;
 *  - nothing happens before confirm.
 */

const adminCookie = { b2b_session: 'stub-admin-session' };

describe('163 P-1 — assistant Archive / Restore [integration]', () => {
  let h: BackendServerHandle;
  const llm = new ScriptedLlm();
  const RUN = Date.now().toString(36);
  let activeId: string;
  let inactiveId: string;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    h = await setupBackendServer({ promptActionsLlmFetch: llm.fetch });
    await seedPromptActionsSettings(h);
    const em = h.em();
    const make = (suffix: string, status: 'active' | 'inactive') =>
      em.create(Product, {
        sku: `ARCH-P1-${suffix}-${RUN}`,
        slug: `arch-p1-${suffix.toLowerCase()}-${RUN}`,
        type: 'simple',
        status,
        name: `Archivable ${suffix} ${RUN}`,
        description: 'P-1 fixture',
        visibility: 'public',
      });
    activeId = make('A', 'active').id;
    inactiveId = make('I', 'inactive').id;
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
  });

  // No wipe of prompt_action_requests (issue #166): every assertion reads the
  // request this file created, by id.
  beforeEach(() => {
    llm.reset();
  });

  const submit = async (prompt: string) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; status: string; plan: { operations: Array<{ preview: { affectedCount: number; headline: string } }> } } }).data;
  };

  const confirm = async (id: string) => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/confirm`,
      cookies: adminCookie,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { status: string } }).data;
  };

  const row = async (id: string) => {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(Product, { id }, { filters: false });
  };

  it('archives on confirm only, through product.archive with the admin as actor, leaving the status alone', async () => {
    llm
      .enqueueToolUse({ name: 'catalog.archive_product', input: { productIds: [activeId, inactiveId] } })
      .enqueueDone();
    const planned = await submit(`Archive Archivable A ${RUN} and Archivable I ${RUN}`);
    expect(planned.status).toBe('awaiting_confirmation');
    expect(planned.plan.operations[0]!.preview.affectedCount).toBe(2);
    expect(planned.plan.operations[0]!.preview.headline).toMatch(/only Restore/);
    // Inert until confirmed.
    expect((await row(activeId)).archivedAt ?? null).toBeNull();

    expect((await confirm(planned.id)).status).toBe('completed');
    const active = await row(activeId);
    const inactive = await row(inactiveId);
    expect(active.archivedAt).toBeInstanceOf(Date);
    expect(inactive.archivedAt).toBeInstanceOf(Date);
    expect(active.status).toBe('active');
    expect(inactive.status).toBe('inactive');

    const audits = await h.em().find(AuditLogEntry, {
      action: 'product.archive',
      objectId: { $in: [activeId, inactiveId] },
    });
    expect(audits).toHaveLength(2);
    for (const audit of audits) expect(audit.actorAdminUserId).toBe(TEST_ADMIN_ID);
  });

  it('search reports the archived product, and restore clears archivedAt through product.restore', async () => {
    // The resolver itself, read off the registry the interpreter uses.
    const registry = h.container.resolve('promptActionToolRegistry') as {
      get(id: string): { execute(params: unknown, ctx: unknown): Promise<unknown> } | undefined;
    };
    const found = (await registry
      .get('catalog.search_products')!
      .execute({ q: `Archivable A ${RUN}` }, { adminUserId: TEST_ADMIN_ID, requestId: 'r', auditCtx: {} })) as Array<{
      id: string;
      archived: boolean;
    }>;
    expect(found.find((p) => p.id === activeId)?.archived).toBe(true);

    llm.reset();
    llm.enqueueToolUse({ name: 'catalog.restore_product', input: { productIds: [inactiveId] } }).enqueueDone();
    const planned = await submit(`Restore Archivable I ${RUN}`);
    expect((await confirm(planned.id)).status).toBe('completed');
    const inactive = await row(inactiveId);
    expect(inactive.archivedAt ?? null).toBeNull();
    // Restore never switches a product on.
    expect(inactive.status).toBe('inactive');
    const audits = await h.em().find(AuditLogEntry, { action: 'product.restore', objectId: inactiveId });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorAdminUserId).toBe(TEST_ADMIN_ID);
  });
});
