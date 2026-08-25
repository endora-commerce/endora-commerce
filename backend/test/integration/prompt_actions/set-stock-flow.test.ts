import { randomBytes } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ScriptedLlm, seedPromptActionsSettings } from '../../helpers/prompt-actions.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { StockLevel } from '../../../src/modules/inventory/entities/stock-level.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { DEFAULT_WAREHOUSE_ID } from '../../../src/modules/inventory/entities/warehouse.entity.js';
import { PromptActionRequest } from '../../helpers/package-entities.js';

/**
 * T025 — US1 flagship integration test (quickstart §3 steps 2–3): the full
 * interpret → preview → confirm → execute loop against the real database.
 * The scripted provider mimics the model's behavior: resolve the product by
 * name first, then capture the mutation with the resolved IDs.
 */

const adminCookie = { b2b_session: 'stub-admin-session' };

describe('US1 — set-stock flow end to end (T025)', () => {
  let h: BackendServerHandle;
  const llm = new ScriptedLlm();
  let productId: string;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    h = await setupBackendServer({ seed: 'us1-catalog', promptActionsLlmFetch: llm.fetch });
    await seedPromptActionsSettings(h);
    const em = h.em();
    productId = (await em.findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' })).id;
    // Known starting stock for the assertion of preview's "current" value.
    const existing = await em.findOne(StockLevel, {
      productId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    if (existing) {
      existing.onHand = 80;
    } else {
      em.create(StockLevel, {
        productId,
        warehouseId: DEFAULT_WAREHOUSE_ID,
        variantId: null,
        onHand: 80,
        reserved: 0,
      });
    }
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
  });

  beforeEach(async () => {
    llm.reset();
    await h.em().nativeDelete(PromptActionRequest, {});
  });

  it('resolves the product, previews current stock, confirms, applies 120 and audits with the original prompt', async () => {
    const prompt =
      'Dla produktu Example simple product zwiększ stan magazynowy w magazynie Default na 120 sztuk';

    llm
      // Turn 1: the "model" resolves the product name — runs the REAL resolver.
      .enqueueToolUse({ name: 'catalog.search_products', input: { q: 'Example simple product' } })
      // Turn 2: capture the mutation with resolved IDs.
      .enqueueToolUse({
        name: 'inventory.set_stock_level',
        input: { productId, warehouseId: DEFAULT_WAREHOUSE_ID, quantity: 120 },
      })
      // Turn 3: finish — captured mutations become the plan.
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt },
    });
    expect(submit.statusCode).toBe(201);
    const submitted = submit.json() as {
      data: {
        id: string;
        status: string;
        plan: {
          summary: string;
          operations: Array<{ params: Record<string, unknown>; preview: Record<string, unknown> }>;
        };
      };
    };
    expect(submitted.data.status).toBe('awaiting_confirmation');

    // The real resolver fed real rows back to the "model".
    const toolResults = JSON.stringify(llm.requests.at(-1)!['messages']);
    expect(toolResults).toContain('EXAMPLE-SIMPLE-001');

    // Server-computed preview: resolved entities + current → new value (US1/AC2).
    const op = submitted.data.plan.operations[0]!;
    expect(op.params).toEqual({
      productId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      quantity: 120,
    });
    expect(op.preview['current']).toEqual({ onHand: 80 });
    expect(op.preview['headline']).toContain('Example simple product');
    expect(op.preview['headline']).toContain('Default');
    expect(op.preview['headline']).toContain('120');

    // Nothing changed before confirmation (US1/AC3 half: preview is read-only).
    const em = h.em();
    let level = await em.findOneOrFail(StockLevel, {
      productId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    expect(level.onHand).toBe(80);

    // Confirm → execute.
    const confirm = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${submitted.data.id}/confirm`,
      cookies: adminCookie,
    });
    expect(confirm.statusCode).toBe(200);
    expect((confirm.json() as { data: { status: string } }).data.status).toBe('completed');

    em.clear();
    level = await em.findOneOrFail(StockLevel, {
      productId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    expect(level.onHand).toBe(120);

    // Audit trail (US1/AC4): prompt-attributed summary row + the inventory
    // module's own stock_level.adjust row.
    const summaryAudits = await em.find(AuditLogEntry, {
      action: 'prompt_action.execute',
      objectId: submitted.data.id,
    });
    expect(summaryAudits).toHaveLength(1);
    expect((summaryAudits[0]!.stateAfter as { prompt?: string }).prompt).toBe(prompt);

    const stockAudits = await em.find(AuditLogEntry, { action: 'stock_level.adjust' });
    const mine = stockAudits.filter(
      (a) => (a.stateAfter as { onHand?: number } | undefined)?.onHand === 120,
    );
    expect(mine.length).toBeGreaterThan(0);

    // Double confirm executes exactly once (FR-006).
    const again = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${submitted.data.id}/confirm`,
      cookies: adminCookie,
    });
    expect(again.statusCode).toBe(200);
    const audits2 = await em.find(AuditLogEntry, {
      action: 'prompt_action.execute',
      objectId: submitted.data.id,
    });
    expect(audits2).toHaveLength(1);
  });

  it('cancel before confirmation leaves the stock untouched (US1/AC3)', async () => {
    llm
      .enqueueToolUse({
        name: 'inventory.set_stock_level',
        input: { productId, warehouseId: DEFAULT_WAREHOUSE_ID, quantity: 555 },
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'ustaw stan na 555' },
    });
    const id = (submit.json() as { data: { id: string } }).data.id;

    const cancel = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/cancel`,
      cookies: adminCookie,
    });
    expect(cancel.statusCode).toBe(200);

    const em = h.em();
    const level = await em.findOneOrFail(StockLevel, {
      productId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    expect(level.onHand).not.toBe(555);
  });
});
