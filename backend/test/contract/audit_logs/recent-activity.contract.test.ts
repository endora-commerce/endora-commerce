import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { KnownIconNameSchema } from '@endora-commerce/contracts';
import { RecentActivityCatalog } from '../../../../packages/modules/audit_logs/src/backend/services/recent-activity-catalog.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

/**
 * Feature 024 / T004 — Contract test for
 * `GET /api/v1/admin/audit-log/recent-activity`.
 *
 * Validates: response shape (Zod) + `limit` clamping + ordering + scope
 * (rows outside the eligible set must NOT surface) + privacy (no IP /
 * user-agent / request-id / raw stateBefore/After leaks to the card).
 *
 * **The expected token and module sets are derived here too** (feature 080,
 * T042j / D-163.1), from the same manifests the server derives them from. This
 * file used to import the host's hand-written `RECENT_ACTIVITY_ACTIONS` and
 * hard-code `['catalog', 'inventory', 'price_lists']` — a third and fourth copy
 * of two of the four tables D-163 named, and the reason a contract test could
 * agree with a server that emitted a `module` value neither of them listed.
 */

const CATALOG = new RecentActivityCatalog(REGISTERED_MANIFESTS);
const ELIGIBLE_ACTIONS = CATALOG.actions();

const itemSchema = z.object({
  id: z.string().uuid(),
  actedAt: z.string(),
  action: z.enum(ELIGIBLE_ACTIONS as [string, ...string[]]),
  module: z.enum(CATALOG.moduleIds() as [string, ...string[]]),
  icon: KnownIconNameSchema,
  labelKey: z.string().min(1),
  actorDisplayName: z.string().min(1),
  actorKind: z.enum(['admin', 'system']),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  targetDisplayName: z.string().min(1),
  targetUrl: z.string().nullable(),
  summary: z.record(z.string(), z.unknown()).nullable(),
});

const responseSchema = z.object({
  data: z.array(itemSchema),
  pagination: z.object({
    limit: z.number().int().min(1).max(12),
    fetchedAt: z.string(),
  }),
});

describe('GET /api/v1/admin/audit-log/recent-activity', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Trigger an in-scope audit row via the catalog update path. This
    // exercises the existing `product.update` emission so the test does
    // not depend on US2 gap-fills landing first.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${SEED_PRODUCT_101_ID}`,
      payload: { attributeValues: { internal_sku_notes: 'recent-activity-trigger' } },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    // Seed one out-of-scope row directly to confirm the eligibility filter.
    // 'setting.update' is a real audit token from feature 004 that no module
    // declares as recent-activity-eligible.
    await h.auditLogService.record({
      action: 'setting.update',
      objectType: 'setting',
      objectId: 'out-of-scope-test',
      stateAfter: { value: 'noise' },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns a body that matches the Zod contract', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = responseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
  });

  it('defaults limit to 8 and honors explicit limit values', async () => {
    const def = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const defBody = def.json() as { pagination: { limit: number } };
    expect(defBody.pagination.limit).toBe(8);

    const five = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity?limit=5',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const fiveBody = five.json() as { pagination: { limit: number }; data: unknown[] };
    expect(fiveBody.pagination.limit).toBe(5);
    expect(fiveBody.data.length).toBeLessThanOrEqual(5);
  });

  it('rejects an out-of-range limit with 400', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity?limit=999',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects callers without audit_log:read scope', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity',
      cookies: { b2b_session: 'stub-restricted-admin-session' },
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('filters out audit rows no module declares as dashboard-eligible', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity?limit=12',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = res.json() as { data: Array<{ action: string; targetId: string }> };
    // The seeded `setting.update` row exists in the raw audit log…
    const raw = await h.em().find(AuditLogEntry, { action: 'setting.update' });
    expect(raw.length).toBeGreaterThan(0);
    // …but the curated endpoint must not return it.
    expect(body.data.find((r) => r.targetId === 'out-of-scope-test')).toBeUndefined();
    for (const row of body.data) {
      expect(ELIGIBLE_ACTIONS).toContain(row.action);
    }
  });

  /**
   * The drift D-163 named, asserted where it was invisible.
   *
   * `prompt_action.execute` was in the server allow-list and in the prefix map
   * and absent from the route's `module` enum and from the admin's rendering
   * table. This asserts it at all four derivation points at once, and it is red
   * on the pre-T042j tree for the two it was missing from — the response
   * schema's `module` enum did not carry `prompt_actions`, so a real
   * prompt-assistant row failed `responseSchema` here.
   */
  it('carries prompt_action.execute through every derived table', () => {
    expect(ELIGIBLE_ACTIONS).toContain('prompt_action.execute');
    expect(CATALOG.moduleIds()).toContain('prompt_actions');
    const descriptor = CATALOG.descriptorFor('prompt_action.execute');
    expect(descriptor?.moduleId).toBe('prompt_actions');
    // The admin's fourth table: the icon and the verb key travel on the item,
    // so an action a module declares can never be renderable in one place and
    // unknown in another.
    expect(KnownIconNameSchema.safeParse(descriptor?.icon).success).toBe(true);
    expect(descriptor?.labelKey).toBe('activity.verb.prompt_action.execute');
    expect(itemSchema.shape.module.safeParse('prompt_actions').success).toBe(true);
    expect(itemSchema.shape.action.safeParse('prompt_action.execute').success).toBe(true);
  });

  it('never leaks sensitive request metadata or raw state blobs', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = res.json() as { data: Array<Record<string, unknown>> };
    for (const row of body.data) {
      expect(row).not.toHaveProperty('ipAddress');
      expect(row).not.toHaveProperty('userAgent');
      expect(row).not.toHaveProperty('requestId');
      expect(row).not.toHaveProperty('stateBefore');
      expect(row).not.toHaveProperty('stateAfter');
    }
  });

  it('sorts entries by actedAt DESC with id DESC tiebreak', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity?limit=12',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = res.json() as { data: Array<{ actedAt: string; id: string }> };
    for (let i = 1; i < body.data.length; i += 1) {
      const prev = body.data[i - 1]!;
      const curr = body.data[i]!;
      if (prev.actedAt === curr.actedAt) {
        expect(prev.id >= curr.id).toBe(true);
      } else {
        expect(prev.actedAt >= curr.actedAt).toBe(true);
      }
    }
  });
});
