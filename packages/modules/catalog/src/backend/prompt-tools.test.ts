import { describe, expect, it, vi } from 'vitest';
import type { PromptActionTool, ToolContext } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { catalogPromptMutationTools, type CatalogPromptToolsDeps } from './prompt-tools.js';

/**
 * Feature 163, owner decision P-1 = A (2026-10-26) — the assistant can archive and
 * restore products. `catalog.set_product_status` only switches a product on or off
 * and never archives (FR-019), so without these tools an operator asking the
 * assistant to archive got an `inactive` product that was still listed.
 *
 * Both tools run the same audited Commands as the admin routes
 * (`product.archive` / `product.restore`, through `CatalogAdminService` with the
 * Command Bus), so the audit entry's actor is the one the bus derives from the
 * confirming admin's request — asserted end to end in the `[PG]`
 * `backend/test/integration/prompt_actions/archive-restore-flow.test.ts`.
 */

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff';

const toolCtx: ToolContext = {
  adminUserId: 'admin-1',
  requestId: 'prompt-request-1',
  auditCtx: {},
} as ToolContext;

interface Row {
  id: string;
  sku: string;
  name: Record<string, string>;
  archivedAt: Date | null;
}

function harness(initial: Row[], options: { bus?: boolean } = {}) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const actions: Array<{ action: string; objectId: string | undefined; audited: boolean }> = [];
  const em = {
    find: vi.fn(async (_entity: unknown, where: { id: { $in: string[] } }) =>
      // One row per matching id, as `id in (…)` answers: a repeated id is one row.
      [...new Set(where.id.$in)].flatMap((id) => (rows.has(id) ? [rows.get(id)!] : [])),
    ),
    findOne: vi.fn(async (_entity: unknown, where: { id: string }) => rows.get(where.id) ?? null),
    persist: vi.fn(),
    flush: vi.fn(async () => undefined),
  };
  const commandBus = {
    run: vi.fn(async (command: Parameters<CommandBus['run']>[0]) => {
      const outcome = await command.run({
        em: em as never,
        actor: { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, kind: 'admin' } as never,
      });
      actions.push({ action: command.action, objectId: command.objectId, audited: outcome.skipAudit !== true });
      return outcome.result;
    }),
  } as unknown as CommandBus;
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const deps = {
    emFactory: () => em as never,
    events: events as never,
    ...(options.bus === false ? {} : { commandBus }),
  } as CatalogPromptToolsDeps;
  const tools = catalogPromptMutationTools(deps);
  const tool = (id: string): PromptActionTool => {
    const found = tools.find((t) => t.id === id);
    if (!found) throw new Error(`tool ${id} not contributed`);
    return found;
  };
  return { rows, actions, tools, tool, commandBus, events };
}

const product = (id: string, archivedAt: Date | null = null): Row => ({
  id,
  sku: `SKU-${id.slice(-2)}`,
  name: { en: `Product ${id.slice(-2)}` },
  archivedAt,
});

describe('163 P-1 — assistant tools to archive and restore products', () => {
  it('contributes catalog.archive_product and catalog.restore_product as confirmable catalog:write mutations', () => {
    const { tool } = harness([]);
    for (const id of ['catalog.archive_product', 'catalog.restore_product']) {
      const t = tool(id);
      expect(t.moduleId).toBe('catalog');
      expect(t.kind).toBe('mutation');
      expect(t.requiredPermission).toBe('catalog:write');
      expect(typeof t.preview).toBe('function');
      expect(t.paramsSchema.safeParse({ productIds: [A] }).success).toBe(true);
      expect(t.paramsSchema.safeParse({ productIds: [] }).success).toBe(false);
    }
  });

  it('tells the model that set_product_status does not archive, and where archiving is', () => {
    const { tool } = harness([]);
    const status = tool('catalog.set_product_status').description;
    expect(status).toMatch(/does not archive/);
    expect(status).toContain('catalog.archive_product');
    const archive = tool('catalog.archive_product').description;
    expect(archive).toContain('catalog.restore_product');
    expect(archive).toMatch(/plan the operator must confirm/);
  });

  it('archive runs the audited product.archive Command once per product, through the bus', async () => {
    const h = harness([product(A), product(B)]);
    const result = (await h.tool('catalog.archive_product').execute({ productIds: [A, B] }, toolCtx)) as {
      summary: { total: number; succeeded: number; failed: number };
    };
    expect(h.actions).toEqual([
      { action: 'product.archive', objectId: A, audited: true },
      { action: 'product.archive', objectId: B, audited: true },
    ]);
    expect(h.rows.get(A)?.archivedAt).toBeInstanceOf(Date);
    expect(h.rows.get(B)?.archivedAt).toBeInstanceOf(Date);
    expect(result.summary).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
    expect(h.events.emit).toHaveBeenCalledWith('product.archived.v1', expect.objectContaining({ productId: A }));
  });

  it('restore runs product.restore and clears archivedAt; an already-restored product is a succeeded no-op', async () => {
    const h = harness([product(A, new Date('2026-10-01T00:00:00Z')), product(B)]);
    const result = (await h.tool('catalog.restore_product').execute({ productIds: [A, B] }, toolCtx)) as {
      summary: { total: number; succeeded: number; failed: number };
    };
    expect(h.actions).toEqual([
      { action: 'product.restore', objectId: A, audited: true },
      { action: 'product.restore', objectId: B, audited: false },
    ]);
    expect(h.rows.get(A)?.archivedAt).toBeNull();
    expect(result.summary).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
  });

  it('a product that disappeared between preview and confirm is a per-item failure, not an abort', async () => {
    const h = harness([product(A)]);
    const result = (await h.tool('catalog.archive_product').execute({ productIds: [UNKNOWN, A] }, toolCtx)) as {
      summary: { total: number; succeeded: number; failed: number; failures: Array<{ id: string }> };
    };
    expect(result.summary).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(result.summary.failures.map((f) => f.id)).toEqual([UNKNOWN]);
    expect(h.rows.get(A)?.archivedAt).toBeInstanceOf(Date);
  });

  it('a disabled module is not a per-item failure: it fails the whole run closed', async () => {
    const h = harness([product(A), product(B)]);
    vi.mocked(h.commandBus.run).mockRejectedValueOnce(new ModuleDisabledError('catalog'));
    await expect(
      h.tool('catalog.archive_product').execute({ productIds: [A, B] }, toolCtx),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(h.rows.get(B)?.archivedAt).toBeNull();
  });

  it('the preview counts the products and says only Restore brings them back; an unknown id is refused', async () => {
    const h = harness([product(A), product(B)]);
    const preview = await h.tool('catalog.archive_product').preview!({ productIds: [A, B] }, toolCtx);
    expect(preview).toMatchObject({ affectedCount: 2 });
    expect((preview as { headline: string }).headline).toMatch(/Archive 2 product\(s\)/);
    expect((preview as { headline: string }).headline).toMatch(/only Restore/i);
    await expect(
      h.tool('catalog.restore_product').preview!({ productIds: [A, UNKNOWN] }, toolCtx),
    ).rejects.toMatchObject({ statusCode: 404 });
    // A preview writes nothing.
    expect(h.commandBus.run).not.toHaveBeenCalled();
  });

  it('contributes neither tool without a Command Bus — an archive the audit log cannot see must not exist', () => {
    const { tools } = harness([], { bus: false });
    const ids = tools.map((t) => t.id);
    expect(ids).not.toContain('catalog.archive_product');
    expect(ids).not.toContain('catalog.restore_product');
    expect(ids).toContain('catalog.set_product_status');
  });

  it('S-2: a per-item failure names an HttpError\'s message, never another error\'s', async () => {
    const h = harness([product(A), product(B)]);
    vi.mocked(h.commandBus.run)
      .mockRejectedValueOnce(new Error('connection to db-internal:5432 refused for user catalog_rw'))
      .mockRejectedValueOnce(new HttpError(409, 'VERSION_CONFLICT', 'Product is locked.'));
    const result = (await h.tool('catalog.archive_product').execute({ productIds: [A, B] }, toolCtx)) as {
      summary: { failures: Array<{ id: string; reason: string }> };
    };
    expect(result.summary.failures).toEqual([
      { id: A, reason: 'failed' },
      { id: B, reason: 'Product is locked.' },
    ]);
  });
});

describe('163 checkpoint F (S-1) — product id lists the assistant sends are bounded and deduplicated', () => {
  const PRODUCT_ID_TOOLS = [
    'catalog.assign_products_to_category',
    'catalog.remove_products_from_category',
    'catalog.set_product_status',
    'catalog.set_products_visibility',
    'catalog.archive_product',
    'catalog.restore_product',
  ];

  it('every product mutation tool refuses more ids than the bulk route accepts (10 000)', () => {
    const { tool } = harness([]);
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`);
    const extra = { categoryId: A, status: 'active', visibility: 'public' };
    for (const id of PRODUCT_ID_TOOLS) {
      const schema = tool(id).paramsSchema;
      expect(schema.safeParse({ ...extra, productIds: ids(10_000) }).success, id).toBe(true);
      expect(schema.safeParse({ ...extra, productIds: ids(10_001) }).success, id).toBe(false);
    }
  });

  it('a repeated id counts once in the preview instead of answering 404', async () => {
    const h = harness([product(A), product(B)]);
    const preview = await h.tool('catalog.archive_product').preview!({ productIds: [A, B, A] }, toolCtx);
    expect(preview).toMatchObject({ affectedCount: 2 });
    expect((preview as { headline: string }).headline).toMatch(/Archive 2 product\(s\)/);
    const status = await h.tool('catalog.set_product_status').preview!({ productIds: [A, A], status: 'inactive' }, toolCtx);
    expect(status).toMatchObject({ affectedCount: 1 });
  });

  it('a repeated id is written once', async () => {
    const h = harness([product(A), product(B)]);
    const result = (await h.tool('catalog.archive_product').execute({ productIds: [A, A, B] }, toolCtx)) as {
      summary: { total: number; succeeded: number };
    };
    expect(h.actions.map((a) => a.objectId)).toEqual([A, B]);
    expect(result.summary).toMatchObject({ total: 2, succeeded: 2 });
  });
});
