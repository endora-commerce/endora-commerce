import { randomBytes, randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, PromptActionRequestResponseSchema } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ScriptedLlm, seedPromptActionsSettings } from '../../helpers/prompt-actions.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { PromptActionRequest } from '../../../src/modules/prompt_actions/entities/prompt-action-request.entity.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { StockLevel } from '../../../src/modules/inventory/entities/stock-level.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { DEFAULT_WAREHOUSE_ID } from '../../../src/modules/inventory/entities/warehouse.entity.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';

/**
 * T024 — contract tests for the prompt-actions admin endpoints
 * (contracts/prompt-actions-api.md §1–§6): DTO shapes, permission gating,
 * ownership 404, idempotent confirm, lazy plan expiry, cancel semantics,
 * and the one-in-flight guard. Provider HTTP is fully scripted.
 */

const adminCookie = { b2b_session: 'stub-admin-session' };
const restrictedCookie = { b2b_session: 'stub-restricted-admin-session' };
const SECOND_ADMIN_ID = '00000000-0000-4000-8000-00000000aa43';

describe('prompt-actions admin endpoints (T024)', () => {
  let h: BackendServerHandle;
  const llm = new ScriptedLlm();
  let productId: string;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    h = await setupBackendServer({
      seed: 'us1-catalog',
      promptActionsLlmFetch: llm.fetch,
    });
    await seedPromptActionsSettings(h);

    const em = h.em();
    const product = await em.findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    productId = product.id;

    // Second platform admin for the ownership-404 case.
    em.create(AdminUser, {
      id: SECOND_ADMIN_ID,
      email: 'prompt-actions-second-admin@example.com',
      passwordHash: 'x',
      firstName: 'Second',
      lastName: 'Admin',
      adminRoleId:
        (await em.findOneOrFail(AdminUser, { id: '00000000-0000-4000-8000-0000000000b1' }))
          .adminRoleId ?? null,
      status: 'active',
    });
    await em.flush();
    ADMIN_COOKIES['stub-second-admin-session'] = { adminUserId: SECOND_ADMIN_ID };
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
  });

  beforeEach(async () => {
    llm.reset();
    const em = h.em();
    await em.nativeDelete(PromptActionRequest, {});
  });

  function scriptStockPlan(quantity = 120): void {
    llm
      .enqueueToolUse({
        name: 'inventory.set_stock_level',
        input: { productId, warehouseId: DEFAULT_WAREHOUSE_ID, quantity },
      })
      .enqueueDone();
  }

  async function submit(quantity = 120): Promise<{ id: string; body: Record<string, unknown> }> {
    scriptStockPlan(quantity);
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: `Set stock of Bolts to ${quantity}` },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { data: { id: string } };
    return { id: body.data.id, body: body as unknown as Record<string, unknown> };
  }

  it('capability reports ready once configured', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/prompt-actions/capability',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ data: { status: 'ready', bulkLimit: 500 } });
  });

  it('rejects unauthenticated (401) and missing prompt_actions:use (403) on every route', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/admin/prompt-actions/capability'],
      ['POST', '/api/v1/admin/prompt-actions/requests'],
      ['GET', `/api/v1/admin/prompt-actions/requests/${randomUUID()}`],
      ['POST', `/api/v1/admin/prompt-actions/requests/${randomUUID()}/confirm`],
      ['POST', `/api/v1/admin/prompt-actions/requests/${randomUUID()}/cancel`],
    ] as const) {
      const unauth = await h.app.inject({
        method,
        url,
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect([401, 400].includes(unauth.statusCode), `${method} ${url} unauth`).toBe(true);
      const forbidden = await h.app.inject({
        method,
        url,
        cookies: restrictedCookie,
        ...(method === 'POST' ? { payload: { prompt: 'x' } } : {}),
      });
      expect(forbidden.statusCode, `${method} ${url} forbidden`).toBe(403);
    }
  });

  it('submit returns a confirmable plan with server-computed preview (DTO contract)', async () => {
    const { body } = await submit();
    const parsed = PromptActionRequestResponseSchema.parse(body);
    expect(parsed.data.status).toBe('awaiting_confirmation');
    expect(parsed.data.plan!.operations).toHaveLength(1);
    const op = parsed.data.plan!.operations[0]!;
    expect(op.toolId).toBe('inventory.set_stock_level');
    expect(op.requiredPermission).toBe('catalog:write');
    expect(op.preview.affectedCount).toBe(1);
    expect(op.preview.current).toEqual({ onHand: expect.any(Number) });
    expect(op.preview.headline).toContain('Default');
    // expiresAt = interpretation timestamp + 10 min (lazy expiry, research §R5).
    const expiresIn =
      new Date(parsed.data.expiresAt!).getTime() - new Date(parsed.data.createdAt).getTime();
    expect(expiresIn).toBeGreaterThan(9 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(10 * 60_000 + 5_000);
    // The provider saw the visible tool catalogue, not the kitchen sink.
    const toolNames = (llm.requests[0]!['tools'] as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toContain('inventory__set_stock_level');
    expect(toolNames).toContain('request_clarification');
  });

  it('requests are owner-scoped: a different admin gets 404, not 403', async () => {
    const { id } = await submit();
    const r = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/prompt-actions/requests/${id}`,
      cookies: { b2b_session: 'stub-second-admin-session' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('confirm executes once and a repeat confirm is idempotent (FR-006)', async () => {
    const { id } = await submit(120);
    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/confirm`,
      cookies: adminCookie,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = PromptActionRequestResponseSchema.parse(first.json());
    expect(firstBody.data.status).toBe('completed');
    expect(firstBody.data.result!.operations[0]).toMatchObject({ status: 'succeeded' });

    const em = h.em();
    const level = await em.findOneOrFail(StockLevel, {
      productId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    expect(level.onHand).toBe(120);

    const second = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/confirm`,
      cookies: adminCookie,
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { data: { status: string } }).data.status).toBe('completed');

    // Exactly one prompt_action.execute audit row.
    const audits = await em.find(AuditLogEntry, {
      action: 'prompt_action.execute',
      objectId: id,
    });
    expect(audits).toHaveLength(1);
  });

  it('expired plans are rejected lazily at confirm (409 PROMPT_PLAN_EXPIRED)', async () => {
    const { id } = await submit();
    // Rewind the plan's freshness stamp 11 minutes — past the 10-min TTL.
    await h
      .em()
      .nativeUpdate(
        PromptActionRequest,
        { id },
        { updatedAt: new Date(Date.now() - 11 * 60_000) },
      );
    const r = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/confirm`,
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PROMPT_PLAN_EXPIRED,
    );
    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/prompt-actions/requests/${id}`,
      cookies: adminCookie,
    });
    expect((get.json() as { data: { status: string } }).data.status).toBe('expired');
  });

  it('cancel keeps data untouched and blocks later confirm (409 INVALID_STATE)', async () => {
    const em = h.em();
    const before = await em.findOne(StockLevel, {
      productId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    const { id } = await submit(7777);
    const cancel = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/cancel`,
      cookies: adminCookie,
    });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { data: { status: string } }).data.status).toBe('cancelled');

    em.clear();
    const after = await em.findOne(StockLevel, {
      productId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    expect(after?.onHand ?? 0).toBe(before?.onHand ?? 0);

    const confirm = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/confirm`,
      cookies: adminCookie,
    });
    expect(confirm.statusCode).toBe(409);
    expect((confirm.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PROMPT_REQUEST_INVALID_STATE,
    );
  });

  it('one in-flight request per operator (429 PROMPT_REQUEST_IN_FLIGHT)', async () => {
    const em = h.em();
    em.create(PromptActionRequest, {
      adminUserId: '00000000-0000-4000-8000-0000000000b1',
      prompt: 'long running…',
      status: 'executing',
    });
    await em.flush();

    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'another one' },
    });
    expect(r.statusCode).toBe(429);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PROMPT_REQUEST_IN_FLIGHT,
    );
  });

  it('rejects empty prompts (422/400 validation)', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: '   ' },
    });
    expect([400, 422].includes(r.statusCode)).toBe(true);
  });
});
