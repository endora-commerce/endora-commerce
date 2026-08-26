import { randomBytes } from 'crypto';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ScriptedLlm, seedPromptActionsSettings } from '../../helpers/prompt-actions.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { StockLevel } from '../../helpers/package-entities.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { DEFAULT_WAREHOUSE_ID } from '@endora-commerce/mod-inventory/backend';
import { PromptActionRequest } from '../../helpers/package-entities.js';

/**
 * T049 — US3 boundary contract tests (quickstart §3 steps 5–7): ambiguity →
 * clarification round-trip (entity choice + free text, single round only),
 * unsupported intents, permission refusal with audit, provider failure
 * mapping (FR-017) — all with zero data changes.
 */

const adminCookie = { b2b_session: 'stub-admin-session' };
const LIMITED_ADMIN_ID = '00000000-0000-4000-8000-00000000aa53';
const limitedCookie = { b2b_session: 'stub-prompt-limited-admin-session' };

describe('US3 — ambiguity, refusal and failure handling (T049)', () => {
  let h: BackendServerHandle;
  const llm = new ScriptedLlm();
  let productId: string;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    h = await setupBackendServer({ seed: 'us1-catalog', promptActionsLlmFetch: llm.fetch });
    await seedPromptActionsSettings(h);
    const em = h.em();
    productId = (await em.findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' })).id;

    // Operator who MAY use the assistant but holds no catalog:write.
    const limitedRole = em.create(AdminRole, {
      code: 'prompt_limited_043',
      name: 'Prompt user without write',
      permissions: ['prompt_actions:use', 'catalog:read'],
    });
    await em.persistAndFlush(limitedRole);
    em.create(AdminUser, {
      id: LIMITED_ADMIN_ID,
      email: 'prompt-limited-043@example.com',
      passwordHash: 'x',
      firstName: 'Limited',
      lastName: 'Prompter',
      adminRoleId: limitedRole.id,
      status: 'active',
    });
    await em.flush();
    ADMIN_COOKIES['stub-prompt-limited-admin-session'] = { adminUserId: LIMITED_ADMIN_ID };
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
  });

  beforeEach(async () => {
    llm.reset();
    await h.em().nativeDelete(PromptActionRequest, {});
  });

  async function stockUnchanged(): Promise<void> {
    const level = await h.em().findOne(StockLevel, {
      productId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    expect(level?.onHand ?? 0).not.toBe(9999);
  }

  it('ambiguity → needs_clarification with candidates; entity choice resumes to a plan (US3/AC1)', async () => {
    llm
      .enqueueToolUse({
        name: 'request_clarification',
        input: {
          question: 'Which product did you mean?',
          kind: 'entity_choice',
          candidates: [
            { id: productId, label: 'Example simple product' },
            { id: '00000000-0000-4000-8000-00000000ffff', label: 'Example other product' },
          ],
        },
      })
      // After the operator picks, the model captures the mutation.
      .enqueueToolUse({
        name: 'inventory.set_stock_level',
        input: { productId, warehouseId: DEFAULT_WAREHOUSE_ID, quantity: 60 },
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'zwiększ stan produktu Example' },
    });
    expect(submit.statusCode).toBe(201);
    const body = submit.json() as {
      data: { id: string; status: string; clarification: { kind: string; candidates: Array<{ id: string }> } };
    };
    expect(body.data.status).toBe('needs_clarification');
    expect(body.data.clarification.kind).toBe('entity_choice');
    expect(body.data.clarification.candidates).toHaveLength(2);

    const clarify = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${body.data.id}/clarify`,
      cookies: adminCookie,
      payload: { selectedCandidateId: productId },
    });
    expect(clarify.statusCode).toBe(200);
    const clarified = clarify.json() as { data: { status: string } };
    expect(clarified.data.status).toBe('awaiting_confirmation');
    // The chosen candidate was folded into the conversation.
    expect(JSON.stringify(llm.requests.at(-1)!['messages'])).toContain('Example simple product');
  });

  it('free-text clarification answers resume interpretation', async () => {
    llm
      .enqueueToolUse({
        name: 'request_clarification',
        input: { question: 'Which warehouse?', kind: 'free_text' },
      })
      .enqueueToolUse({
        name: 'inventory.set_stock_level',
        input: { productId, warehouseId: DEFAULT_WAREHOUSE_ID, quantity: 61 },
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'ustaw stan' },
    });
    const id = (submit.json() as { data: { id: string } }).data.id;
    const clarify = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/clarify`,
      cookies: adminCookie,
      payload: { text: 'the Default warehouse' },
    });
    expect(clarify.statusCode).toBe(200);
    expect((clarify.json() as { data: { status: string } }).data.status).toBe(
      'awaiting_confirmation',
    );
  });

  it('a second clarification round is coerced to unsupported (single round-trip)', async () => {
    llm
      .enqueueToolUse({
        name: 'request_clarification',
        input: { question: 'Which product?', kind: 'free_text' },
      })
      .enqueueToolUse({
        name: 'request_clarification',
        input: { question: 'Still which product?', kind: 'free_text' },
      });

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'zrób coś' },
    });
    const id = (submit.json() as { data: { id: string } }).data.id;
    const clarify = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/clarify`,
      cookies: adminCookie,
      payload: { text: 'no idea' },
    });
    expect(clarify.statusCode).toBe(200);
    expect((clarify.json() as { data: { status: string } }).data.status).toBe('unsupported');
  });

  it('clarify outside needs_clarification → 409; unknown candidate → 400', async () => {
    llm
      .enqueueToolUse({
        name: 'request_clarification',
        input: {
          question: 'Which?',
          kind: 'entity_choice',
          candidates: [{ id: 'a', label: 'A' }],
        },
      })
      .enqueueDone();

    const submit = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'x' },
    });
    const id = (submit.json() as { data: { id: string } }).data.id;

    const badCandidate = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/clarify`,
      cookies: adminCookie,
      payload: { selectedCandidateId: 'nonexistent' },
    });
    expect(badCandidate.statusCode).toBe(400);

    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/cancel`,
      cookies: adminCookie,
    });
    const wrongState = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/prompt-actions/requests/${id}/clarify`,
      cookies: adminCookie,
      payload: { text: 'late answer' },
    });
    expect(wrongState.statusCode).toBe(409);
  });

  it('unsupported intents change nothing and carry a helpful status (US3/AC2)', async () => {
    llm.enqueueToolUse({
      name: 'report_outcome',
      input: { kind: 'unsupported', message: 'No newsletter capability exists.' },
    });
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'wyślij newsletter do wszystkich klientów' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { data: { status: string; plan: unknown } };
    expect(body.data.status).toBe('unsupported');
    expect(body.data.plan).toBeNull();
    await stockUnchanged();
  });

  it('permission refusal at interpretation is audited and mutates nothing (US3/AC3)', async () => {
    // The limited operator's catalogue excludes mutations; the system prompt
    // lists them as unavailable and the scripted model reports the refusal.
    llm.enqueueToolUse({
      name: 'report_outcome',
      input: { kind: 'permission_denied' },
    });
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: limitedCookie,
      payload: { prompt: 'ustaw stan magazynowy na 9999' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { data: { id: string; status: string } };
    expect(body.data.status).toBe('refused');

    // The mutation tools were NOT in the provider catalogue (FR-007 filter).
    const toolNames = (llm.requests[0]!['tools'] as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).not.toContain('inventory__set_stock_level');
    expect(String(llm.requests[0]!['system'])).toContain('inventory.set_stock_level');

    const audits = await h.em().find(AuditLogEntry, {
      action: 'prompt_action.refused',
      objectId: body.data.id,
    });
    expect(audits).toHaveLength(1);
    await stockUnchanged();
  });

  it('provider outage maps to a failed request, not a 5xx, and changes nothing (FR-017)', async () => {
    llm.enqueueHttpError(529);
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'ustaw stan na 9999' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { data: { status: string; error: string | null } };
    expect(body.data.status).toBe('failed');
    expect(body.data.error).toBeTruthy();
    await stockUnchanged();
  });

  it('a malformed provider response fails safely (FR-014/FR-017)', async () => {
    // Unknown tool name — the interpreter hard-stops.
    llm.enqueueToolUse({ name: 'catalog.drop_everything', input: {} });
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'zrób porządek' },
    });
    expect(r.statusCode).toBe(201);
    expect((r.json() as { data: { status: string } }).data.status).toBe('failed');
    await stockUnchanged();
  });
});
