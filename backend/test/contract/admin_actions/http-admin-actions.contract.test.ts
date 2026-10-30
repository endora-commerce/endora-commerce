import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ModuleAction } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { GetAdminActionsResponseSchema } from '@endora-commerce/contracts';
import { ModuleRegistration } from '@endora-commerce/platform/composition';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * HTTP contract test for GET /api/v1/admin/admin-actions
 * (T017 — feature 020 / tasks.md).
 *
 * Asserts the auth gate, query validation, the wire envelope, and
 * a populated response after seeding fixture rows. The endpoint is
 * the only external surface modules + admin clients consume.
 */

const TEST_MODULE_ID = 'fixture_http_actions';
/** A fixture action under a real module, so its bundle key resolves against shipped bundles. */
const KEYWORDS_MODULE_ID = 'credentials';
const KEYWORDS_ACTION_ID = 'fixture-keywords-560';
const adminCookie = { b2b_session: 'stub-admin-session' };

/**
 * The enabled set this harness seeded, kept so {@link cleanup} can put it back.
 *
 * The fixture module has to join it, and the reason is a property of the
 * harness rather than of the palette: `setupBackendServer` never populates
 * `module_registrations` — it seeds the registry cache directly through
 * `__setEnabledForTesting`, because a real `refreshFromDb` over an empty table
 * would take every gated route down mid-run. Since issue #187 the palette
 * resolves platform availability from that cache instead of joining the table
 * itself, so a fixture registration row alone no longer makes a module present
 * here. Inserting the row as well is deliberate: it is what production holds,
 * and the reconciler's own tests read it.
 */
let seededEnabledIds: string[] | null = null;

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

  /**
   * Issue #560 — the palette's per-language keywords, end to end: the column,
   * the `_i18n` resolver over the bundles the harness installs from disk, and
   * the wire. The row borrows `credentials`' real `keywordsKey` under a fixture
   * action id, so the words asserted are the ones that module ships.
   */
  it('serves the Polish keywords of a keywordsKey to a Polish admin and the English ones to an English admin', async () => {
    await h.em().getKnex()('module_actions').insert({
      module_id: KEYWORDS_MODULE_ID,
      action_id: KEYWORDS_ACTION_ID,
      label_key: 'actions.newCredential.label',
      keywords_key: 'actions.newCredential.keywords',
      icon: 'Plus',
      target_route: '/credentials/new',
      required_permission: null,
      keywords: JSON.stringify(['credential', 'configuration']),
      weight: 100,
    });

    const keywordsIn = async (language: 'en' | 'pl'): Promise<string[]> => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/admin-actions?language=${language}`,
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(200);
      const parsed = GetAdminActionsResponseSchema.parse((res.json() as { data: unknown }).data);
      const row = parsed.data.find(
        (a) => a.moduleId === KEYWORDS_MODULE_ID && a.actionId === KEYWORDS_ACTION_ID,
      );
      expect(row).toBeDefined();
      return row!.keywords;
    };

    const pl = await keywordsIn('pl');
    expect(pl).toEqual(expect.arrayContaining(['credential', 'configuration', 'nowe poświadczenie']));
    const en = await keywordsIn('en');
    expect(en).toEqual(expect.arrayContaining(['credential', 'configuration', 'new credential']));
    expect(en).not.toContain('nowe poświadczenie');
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
  seededEnabledIds = registryCache.enabledIds();
  registryCache.__setEnabledForTesting([...seededEnabledIds, TEST_MODULE_ID]);
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
  if (seededEnabledIds) {
    registryCache.__setEnabledForTesting(seededEnabledIds);
    seededEnabledIds = null;
  }
  await h.em().nativeDelete(ModuleAction, { moduleId: TEST_MODULE_ID });
  await h.em().nativeDelete(ModuleAction, { moduleId: KEYWORDS_MODULE_ID, actionId: KEYWORDS_ACTION_ID });
  await h.em().nativeDelete(ModuleRegistration, { moduleId: TEST_MODULE_ID });
}
