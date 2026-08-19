import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { AdminActionsService } from '../../../src/modules/admin_actions/services/admin-actions-service.js';
import { ModuleAction } from '../../../src/modules/admin_actions/entities/module-action.entity.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import type { I18nService } from '../../../src/modules/_i18n/services/i18n-service.js';
import type { PermissionService } from '../../../src/modules/admin_roles/services/permission-service.js';
import type { SupportedAdminLanguage } from '@b2b/contracts';

/**
 * Integration test for AdminActionsService.listVisibleForOperator
 * (T015, T016, T018 — feature 020 / tasks.md).
 *
 * Drives the service's SQL join (module_actions JOIN
 * module_registrations) plus its permission filter, sort, label-resolution,
 * and per-(language, perm-fingerprint) cache. The PermissionService and
 * I18nService are stubbed so the test can pivot the operator's
 * permissions without spinning up admin_users/admin_roles rows.
 */

const TEST_MODULES = ['fix_av_a', 'fix_av_b', 'fix_av_c'] as const;

/**
 * Issue #102 — every assertion below is scoped to the three fixture modules
 * above, never to the whole `module_actions` table.
 *
 * `module_actions` is not in the harness's `SEEDED_TABLES` and cannot be: it is
 * repopulated at boot by the real reconciler, so a truncate would be undone by
 * the very file that fills it. `test/integration/kernel/production-boot.test.ts`
 * composes the production root, which reconciles one row per declared action
 * and one `module_registrations` row per registered module into the shared test
 * database and leaves both there; `seeded-set` and `i18n-resolution` add and
 * remove their own. Asserting over the whole table therefore passed only on a
 * pristine database and turned this file into a coin flip decided by shard
 * membership.
 *
 * The service is still fully exercised — the join, the permission filter, the
 * weight/label sort and the cache all run over every row in the table; only the
 * expectation is narrowed to the rows this file owns.
 */
const isFixture = (action: { moduleId: string }): boolean =>
  (TEST_MODULES as readonly string[]).includes(action.moduleId);

describe('AdminActionsService.listVisibleForOperator (integration)', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    em = orm.em.fork() as EntityManager;
  }, 60_000);

  beforeEach(async () => {
    em = orm.em.fork() as EntityManager;
    await cleanup(em);
    await seed(em);
  });

  afterEach(async () => {
    await cleanup(em);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  function buildService(
    permissionsByUser: Record<string, string[]>,
    isModuleActivated?: (moduleId: string) => boolean,
  ): AdminActionsService {
    const i18nStub: Pick<I18nService, 'translate'> = {
      translate: async (
        moduleId: string,
        key: string,
        _language: SupportedAdminLanguage,
      ): Promise<string> => {
        // Return a deterministic, language-agnostic string so the test
        // asserts on shape, not on bundle resolution. The full
        // language-fallback path is exercised by feature 019's tests.
        return `${moduleId}:${key}`;
      },
    };
    const permStub: Pick<PermissionService, 'listPermissions'> = {
      listPermissions: async (adminUserId: string): Promise<string[]> =>
        permissionsByUser[adminUserId] ?? [],
    };
    return new AdminActionsService({
      em: () => em,
      i18nService: i18nStub as I18nService,
      permissionService: permStub as PermissionService,
      // `presence`, not `isModuleActivated`. MR !738 renamed this dependency
      // when it replaced the pub/sub invalidation with a pulled presence
      // generation, and this file was not on that branch to be renamed with it.
      //
      // The old name reached the constructor through a **spread**, and a spread
      // bypasses excess-property checking — so `tsc` stayed green while
      // `deps.presence` fell to its permissive default (`isActivated: () => true`)
      // and every module read as activated. The one assertion that the palette
      // filters on the operator axis quietly stopped asserting it, which is the
      // exact state issue #213 existed to leave behind.
      ...(isModuleActivated
        ? { presence: { isActivated: isModuleActivated, version: (): number => 0 } }
        : {}),
    });
  }

  it('platform admin (* permission) sees every action across enabled modules', async () => {
    const service = buildService({ admin: ['*'] });
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });
    // Module C is disabled — its row should not appear.
    expect(result.actions.filter(isFixture).map((a) => a.actionId)).toEqual([
      'a1', // weight 100, label "fix_av_a:a1.label"
      'a2', // weight 200
      'b1', // weight 300
    ]);
  });

  it('operator with single-permission sees only matching actions', async () => {
    const service = buildService({ ops: ['catalog:write'] });
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'ops',
    });
    // Only a1 and b1 require catalog:write; a2 has no perm so visible too.
    expect(result.actions.filter(isFixture).map((a) => a.actionId).sort()).toEqual([
      'a1',
      'a2',
      'b1',
    ]);
  });

  it('operator with no permissions sees only actions that have no requiredPermission', async () => {
    const service = buildService({ guest: [] });
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'guest',
    });
    expect(result.actions.filter(isFixture).map((a) => a.actionId)).toEqual(['a2']);
  });

  it('disabled-module action is hidden from a platform admin', async () => {
    const service = buildService({ admin: ['*'] });
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });
    expect(result.actions.find((a) => a.actionId === 'c1')).toBeUndefined();
  });

  /**
   * The **other** presence axis, which the SQL join above cannot answer: the
   * module is installed, and the operator has switched it off.
   *
   * Written while closing issue #213, which found the permission catalogue
   * reading the platform axis alone. The palette does not share that defect —
   * the join answers platform availability and `isModuleActivated` answers the
   * operator's — but nothing in the tree asserted the second half, so the claim
   * "the palette is fine" rested on reading the code. It rests on this now.
   */
  it('deactivated-module action is hidden even though the platform still offers it', async () => {
    const deactivated = new Set(['fix_av_a']);
    const service = buildService({ admin: ['*'] }, (moduleId) => !deactivated.has(moduleId));
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });

    // `fix_av_a` is `state: 'installed'` in the fixture, so the join keeps its
    // rows and only the operator axis can remove them.
    expect(result.actions.filter(isFixture).map((a) => a.actionId)).toEqual(['b1']);
  });

  it('sorts ascending by weight then by label', async () => {
    const service = buildService({ admin: ['*'] });
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });
    const weights = result.actions.map((a) => a.weight);
    const sortedAsc = [...weights].sort((p, q) => p - q);
    expect(weights).toEqual(sortedAsc);
  });

  it('caches results per (language, permission-fingerprint)', async () => {
    const service = buildService({ admin: ['*'] });
    expect(service.stats.dbHits).toBe(0);
    await service.listVisibleForOperator({ language: 'en', adminUserId: 'admin' });
    expect(service.stats.dbHits).toBe(1);
    await service.listVisibleForOperator({ language: 'en', adminUserId: 'admin' });
    expect(service.stats.dbHits).toBe(1);
    expect(service.stats.cacheHits).toBe(1);
  });

  it('invalidate() clears the cache forcing the next call to re-query', async () => {
    const service = buildService({ admin: ['*'] });
    await service.listVisibleForOperator({ language: 'en', adminUserId: 'admin' });
    expect(service.stats.dbHits).toBe(1);
    service.invalidate();
    await service.listVisibleForOperator({ language: 'en', adminUserId: 'admin' });
    expect(service.stats.dbHits).toBe(2);
  });
});

async function seed(em: EntityManager): Promise<void> {
  const knex = em.getKnex();
  const now = new Date();
  // Two installed modules + one disabled module.
  await knex('module_registrations').insert([
    {
      module_id: 'fix_av_a',
      state: 'installed',
      version: '1.0.0',
      installed_at: now,
      last_state_change_at: now,
    },
    {
      module_id: 'fix_av_b',
      state: 'installed',
      version: '1.0.0',
      installed_at: now,
      last_state_change_at: now,
    },
    {
      module_id: 'fix_av_c',
      state: 'disabled',
      version: '1.0.0',
      installed_at: now,
      last_state_change_at: now,
    },
  ]);
  await knex('module_actions').insert([
    {
      module_id: 'fix_av_a',
      action_id: 'a1',
      label_key: 'a1.label',
      icon: 'Plus',
      target_route: '/a1',
      required_permission: 'catalog:write',
      keywords: JSON.stringify([]),
      weight: 100,
    },
    {
      module_id: 'fix_av_a',
      action_id: 'a2',
      label_key: 'a2.label',
      icon: 'Plus',
      target_route: '/a2',
      required_permission: null, // visible to everyone
      keywords: JSON.stringify([]),
      weight: 200,
    },
    {
      module_id: 'fix_av_b',
      action_id: 'b1',
      label_key: 'b1.label',
      icon: 'Plus',
      target_route: '/b1',
      required_permission: 'catalog:write',
      keywords: JSON.stringify([]),
      weight: 300,
    },
    {
      module_id: 'fix_av_c',
      action_id: 'c1',
      label_key: 'c1.label',
      icon: 'Plus',
      target_route: '/c1',
      required_permission: null,
      keywords: JSON.stringify([]),
      weight: 50, // would be FIRST if module weren't disabled
    },
  ]);
}

async function cleanup(em: EntityManager): Promise<void> {
  for (const moduleId of TEST_MODULES) {
    await em.nativeDelete(ModuleAction, { moduleId });
    await em.nativeDelete(ModuleRegistration, { moduleId });
  }
}
