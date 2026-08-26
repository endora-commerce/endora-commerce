import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { AdminActionsService } from '../../../src/modules/admin_actions/services/admin-actions-service.js';
import { ModuleAction } from '../../../src/modules/admin_actions/entities/module-action.entity.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { ModuleRegistryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { ModuleEffectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import type { I18nService } from '../../../src/modules/_i18n/services/i18n-service.js';
import type { PermissionService } from '../../../src/modules/admin_roles/services/permission-service.js';
import type { SupportedAdminLanguage } from '@endora-commerce/contracts';

/**
 * Integration test for AdminActionsService.listVisibleForOperator
 * (T015, T016, T018 — feature 020 / tasks.md).
 *
 * Drives the service's row filter — both presence axes — plus its permission
 * filter, sort, label-resolution, and per-(language, perm-fingerprint) cache.
 * The PermissionService and I18nService are stubbed so the test can pivot the
 * operator's permissions without spinning up admin_users/admin_roles rows.
 *
 * **The registration rows below still decide platform availability; what
 * changed is the road they take** (issue #187). The service joined
 * `module_registrations` itself until feature 080's ledger sweep, so a seeded
 * row was read straight off the table. It reads the kernel's combiner now, so
 * this file builds a real `ModuleRegistryCache` over the same seeded rows and
 * hands the service the probe both composition roots contribute. The fixture is
 * unchanged and so is every expectation: what a passing run now also proves is
 * that the palette and the route gates answer *one* presence, which is the
 * whole point of the cut.
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
 * The service is still fully exercised — the presence filter, the permission
 * filter, the weight/label sort and the cache all run over every row in the
 * table; only the expectation is narrowed to the rows this file owns.
 */
const isFixture = (action: { moduleId: string }): boolean =>
  (TEST_MODULES as readonly string[]).includes(action.moduleId);

describe('AdminActionsService.listVisibleForOperator (integration)', () => {
  let orm: MikroORM;
  let em: EntityManager;
  /**
   * The kernel's own presence, over the rows {@link seed} just wrote.
   *
   * A private cache rather than the `registryCache` singleton: this file runs
   * in the shared suite fork, and seeding the process-wide one would hand every
   * other file in the shard a presence built from three fixture modules.
   */
  let presenceState: ModuleEffectiveState;

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
    em = orm.em.fork() as EntityManager;
  }, 60_000);

  beforeEach(async () => {
    em = orm.em.fork() as EntityManager;
    await cleanup(em);
    await seed(em);
    const cache = new ModuleRegistryCache();
    await cache.refreshFromDb(() => em);
    presenceState = new ModuleEffectiveState(cache);
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
      // Exactly what `composition.ts` and `test-server.ts` contribute as
      // `modulePresenceProbe`, with the operator axis overridable so a case can
      // pivot it without writing a `settings` row.
      //
      // It is passed unconditionally, and the reason is a defect this file
      // already carried once: the override used to arrive through a **spread**
      // under the pre-!738 name `isModuleActivated`, and a spread bypasses
      // excess-property checking — so `tsc` stayed green while `deps.presence`
      // fell to its permissive default and every module read as activated. The
      // one assertion that the palette filters on the operator axis quietly
      // stopped asserting it, which is the exact state issue #213 existed to
      // leave behind. A required parameter cannot do that.
      presence: {
        isPlatformAvailable: (moduleId): boolean =>
          presenceState.presence(moduleId)?.platformAvailable ?? false,
        isActivated: (moduleId): boolean =>
          isModuleActivated
            ? isModuleActivated(moduleId)
            : (presenceState.presence(moduleId)?.operatorActivated ?? true),
        version: (): number => presenceState.presenceVersion(),
      },
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
   * The **other** presence axis: the module is installed, and the operator has
   * switched it off.
   *
   * Written while closing issue #213, which found the permission catalogue
   * reading the platform axis alone. The palette does not share that defect,
   * but nothing in the tree asserted the second half, so the claim "the palette
   * is fine" rested on reading the code. It rests on this now — and since issue
   * #187 both axes come off the same combiner, so what this case pins is that
   * the conjunction is still applied and not that one source overrode another.
   */
  it('deactivated-module action is hidden even though the platform still offers it', async () => {
    const deactivated = new Set(['fix_av_a']);
    const service = buildService({ admin: ['*'] }, (moduleId) => !deactivated.has(moduleId));
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });

    // `fix_av_a` is `state: 'installed'` in the fixture, so its platform axis
    // is available and only the operator axis can remove its rows.
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
