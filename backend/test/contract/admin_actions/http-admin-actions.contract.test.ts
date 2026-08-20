import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { GetAdminActionsResponseSchema } from '@b2b/contracts';
import { ModuleAction } from '../../../src/modules/admin_actions/entities/module-action.entity.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';

/**
 * HTTP contract test for GET /api/v1/admin/admin-actions
 * (T017 — feature 020 / tasks.md).
 *
 * Asserts the auth gate, query validation, the wire envelope, and
 * a populated response after seeding fixture rows. The endpoint is
 * the only external surface modules + admin clients consume.
 */

const TEST_MODULE_ID = 'fixture_http_actions';
const adminCookie = { b2b_session: 'stub-admin-session' };

describe('GET /api/v1/admin/admin-actions (contract)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  beforeEach(async () => {
    await cleanup(h);
  });

  afterEach(async () => {
    await cleanup(h);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 401 without an admin session', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=en',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when language is missing', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when language is not in the allowlist', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=xx',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 with seeded rows in the expected envelope', async () => {
    await seed(h);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=en',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown };
    const parsed = GetAdminActionsResponseSchema.parse(body.data);
    expect(parsed.meta.language).toBe('en');
    expect(parsed.meta.total).toBeGreaterThan(0);
    expect(parsed.meta.registryVersion).toBeGreaterThan(0);

    // Pull the rows we seeded out of the (potentially shared) response
    // and assert their shape.
    const ours = parsed.data.filter((a) => a.moduleId === TEST_MODULE_ID);
    expect(ours.length).toBe(2);
    const ids = ours.map((a) => a.actionId).sort();
    expect(ids).toEqual(['fixture-a', 'fixture-b']);

    for (const row of ours) {
      expect(typeof row.label).toBe('string');
      expect(typeof row.targetRoute).toBe('string');
      expect(typeof row.icon).toBe('string');
      expect(Array.isArray(row.keywords)).toBe(true);
      expect(typeof row.weight).toBe('number');
    }
  });

  it('sets a private no-cache Cache-Control header', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=en',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toMatch(/private/);
  });
});

async function seed(h: BackendServerHandle): Promise<void> {
  const knex = h.em().getKnex();
  const now = new Date();
  await knex('module_registrations').insert({
    module_id: TEST_MODULE_ID,
    state: 'installed',
    version: '1.0.0',
    installed_at: now,
    last_state_change_at: now,
  });
  await knex('module_actions').insert([
    {
      module_id: TEST_MODULE_ID,
      action_id: 'fixture-a',
      label_key: 'fixture_http_actions.actions.a.label',
      icon: 'Plus',
      target_route: '/fixture/a',
      required_permission: null,
      keywords: JSON.stringify(['alpha']),
      weight: 100,
    },
    {
      module_id: TEST_MODULE_ID,
      action_id: 'fixture-b',
      label_key: 'fixture_http_actions.actions.b.label',
      icon: 'Settings',
      target_route: '/fixture/b',
      required_permission: null,
      keywords: JSON.stringify(['beta']),
      weight: 200,
    },
  ]);
}

async function cleanup(h: BackendServerHandle): Promise<void> {
  await h.em().nativeDelete(ModuleAction, { moduleId: TEST_MODULE_ID });
  await h.em().nativeDelete(ModuleRegistration, { moduleId: TEST_MODULE_ID });
}
