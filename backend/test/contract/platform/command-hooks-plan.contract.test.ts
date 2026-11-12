import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommandHookPlanResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * `specs/176-command-hooks-outbox/` T037 (FR-026, FR-040) — the read-only
 * execution plan: every action a composed module declares hookable, and every
 * registered hook at its position, with its module's live presence.
 *
 * Composed as the `example` deployment, whose `command_hook_fixture` hooks
 * `organization.create` and `organization.register`, so the plan has a
 * population rather than being green over an empty list.
 */

const PLAN = '/api/v1/admin/command-hooks';
const FIXTURE = 'command_hook_fixture';

describe('GET /api/v1/admin/command-hooks (176 T037)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it("lists organizations' six declarations and the fixture's two hooks, in execution order", async () => {
    const res = await h.app.inject({ method: 'GET', url: PLAN, cookies: { b2b_session: 'stub-admin-session' } });
    expect(res.statusCode).toBe(200);
    const body = CommandHookPlanResponseSchema.parse(res.json());
    expect(body.actions.filter((action) => action.owner === 'organizations').map((action) => action.action)).toEqual([
      'organization.admin_patch',
      'organization.convert_to_company',
      'organization.create',
      'organization.register',
      'organization.set_custom_field_values',
      'organization.tax_id.change',
    ]);
    expect(body.items.filter((item) => item.module === FIXTURE)).toEqual([
      { action: 'organization.create', phase: 'beforeCommit', position: 1, module: FIXTURE, id: 'observe-create', moduleEnabled: true },
      // 176 P3 — the fixture's afterCommit handlers, after each action's beforeCommit hooks.
      { action: 'organization.create', phase: 'afterCommit', position: 1, module: FIXTURE, id: 'deliver-create', moduleEnabled: true },
      { action: 'organization.register', phase: 'beforeCommit', position: 1, module: FIXTURE, id: 'observe-register', moduleEnabled: true },
      { action: 'organization.register', phase: 'afterCommit', position: 1, module: FIXTURE, id: 'deliver-register', moduleEnabled: true },
    ]);
  });

  it('reports a switched-off hook module live, without dropping it from the plan', async () => {
    const before = registryCache.enabledIds();
    registryCache.__setEnabledForTesting(before.filter((id) => id !== FIXTURE));
    try {
      const res = await h.app.inject({ method: 'GET', url: PLAN, cookies: { b2b_session: 'stub-admin-session' } });
      const body = CommandHookPlanResponseSchema.parse(res.json());
      const fixture = body.items.filter((item) => item.module === FIXTURE);
      expect(fixture).toHaveLength(4);
      expect(fixture.every((item) => !item.moduleEnabled)).toBe(true);
    } finally {
      registryCache.__setEnabledForTesting([...before]);
    }
  });

  it('requires an admin session', async () => {
    const res = await h.app.inject({ method: 'GET', url: PLAN });
    expect(res.statusCode).toBe(401);
  });
});
