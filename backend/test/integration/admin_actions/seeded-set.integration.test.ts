import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModuleAction } from '../../helpers/package-entities.js';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { AdminActionsReconciler } from '../../../../packages/modules/admin_actions/src/backend/services/admin-actions-reconciler.js';
import { AdminActionsService } from '../../../../packages/modules/admin_actions/src/backend/services/admin-actions-service.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { ModuleRegistryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { ModuleEffectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import type { I18nService } from '@endora-commerce/mod-i18n/backend';
import type { PermissionService } from '../../../../packages/modules/admin_roles/src/backend/services/permission-service.js';
import type { SupportedAdminLanguage } from '@endora-commerce/contracts';
import { manifest as catalogManifest } from '../../../../packages/modules/catalog/src/manifest.js';
import { manifest as importExportManifest } from '../../../../packages/modules/import_export/src/manifest.js';
import { manifest as inventoryManifest } from '../../../../packages/modules/inventory/src/manifest.js';
import { manifest as quoteRequestsManifest } from '../../../../packages/modules/quote_requests/src/manifest.js';
import { manifest as cmsManifest } from '../../../../packages/modules/cms/src/manifest.js';
import { manifest as blogManifest } from '../../../../packages/modules/blog/src/manifest.js';
import { manifest as megamenuManifest } from '@endora-commerce/mod-megamenu';
import { manifest as salesChannelsManifest } from '../../../../packages/modules/sales_channels/src/manifest.js';
import { manifest as settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';

/**
 * End-to-end integration test for the v1 seed action set
 * (T037 — feature 020 / tasks.md).
 *
 * For each seeded module: stamp module_registrations as 'installed',
 * run the reconciler with the manifest's actions, then call
 * AdminActionsService.listVisibleForOperator as a *-permission admin
 * and assert the union of declared (moduleId, actionId) pairs comes
 * back. Also verifies the disable path: flipping any one module to
 * 'disabled' removes that module's actions only.
 *
 * **The disable path now goes the way a running platform goes it** (issue
 * #187). The service used to join `module_registrations` per rebuild, so a
 * `nativeUpdate` on that table was visible to the very next read. It resolves
 * presence through the kernel's combiner now, and the combiner is refreshed by
 * `registryCache.refreshFromDb` — which is exactly what the lifecycle
 * orchestrator triggers after it writes the state. So the flip below is
 * followed by that refresh, and a passing run proves the palette follows the
 * platform's own presence rather than reading the table behind its back.
 */

const SEEDED_MANIFESTS = [
  catalogManifest,
  importExportManifest,
  inventoryManifest,
  quoteRequestsManifest,
  cmsManifest,
  blogManifest,
  megamenuManifest,
  salesChannelsManifest,
  settingsManifest,
] as const;

const MODULE_IDS = SEEDED_MANIFESTS.map((m) => m.id);

describe('seeded action set (integration, v1)', () => {
  let orm: MikroORM;
  let em: EntityManager;
  /**
   * A private registry cache over the rows {@link seed} writes, and the
   * combiner on top of it — the pair both composition roots build this module's
   * probe from. Private rather than the `registryCache` singleton: the suite
   * shares one fork, and seeding the process-wide one would hand every other
   * file a presence built from nine fixture registrations.
   */
  let cache: ModuleRegistryCache;
  let presenceState: ModuleEffectiveState;

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
    em = orm.em.fork() as EntityManager;
    await cleanup(em);
    await seed(em);
    cache = new ModuleRegistryCache();
    await cache.refreshFromDb(() => em);
    presenceState = new ModuleEffectiveState(cache);
  }, 60_000);

  afterAll(async () => {
    await cleanup(em);
    await orm.close(true);
  });

  function buildService(perms: string[]): AdminActionsService {
    const i18nStub: Pick<I18nService, 'translate'> = {
      translate: async (
        moduleId: string,
        key: string,
        _language: SupportedAdminLanguage,
      ): Promise<string> => `${moduleId}:${key}`,
    };
    const permStub: Pick<PermissionService, 'listPermissions'> = {
      listPermissions: async (): Promise<string[]> => perms,
    };
    return new AdminActionsService({
      em: () => em,
      i18nService: i18nStub as I18nService,
      permissionService: permStub as PermissionService,
      // Exactly what `composition.ts` and `test-server.ts` contribute as
      // `modulePresenceProbe`.
      presence: {
        isPlatformAvailable: (moduleId): boolean =>
          presenceState.presence(moduleId)?.platformAvailable ?? false,
        isActivated: (moduleId): boolean =>
          presenceState.presence(moduleId)?.operatorActivated ?? true,
        version: (): number => presenceState.presenceVersion(),
      },
    });
  }

  it('every (moduleId, actionId) pair from the seeded manifests is visible to a * admin', async () => {
    const service = buildService(['*']);
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });

    const expected: string[] = [];
    for (const m of SEEDED_MANIFESTS) {
      for (const a of m.actions ?? []) {
        expected.push(`${m.id}:${a.id}`);
      }
    }
    const visible = result.actions
      .filter((a) => MODULE_IDS.includes(a.moduleId))
      .map((a) => `${a.moduleId}:${a.actionId}`);

    expect(visible.sort()).toEqual(expected.sort());
  });

  it('every seeded module contributes, and contributes exactly what it declares', async () => {
    // This case read `toBe(10)` and `toBe(9)` — two counts of a derived fact
    // written into the file. The manifests moved past the first the day
    // `catalog` gained three palette entries and `sales_channels` a second one
    // (feature 091's batches 15 and 16); it is 14 today, and the literal was
    // answering "how many were there when this was written". Both numbers come
    // off `SEEDED_MANIFESTS` now, which is where the actions themselves come
    // from.
    //
    // What survives is the half the counts were carrying and the case above
    // does not: **no seeded module is absent**. The pair sweep compares two
    // lists and is silent about which modules those pairs belong to, so a
    // module whose actions all disappeared from the palette while another
    // module's grew would need the set below to say so.
    const service = buildService(['*']);
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });
    const declared = SEEDED_MANIFESTS.flatMap((m) => m.actions ?? []);
    const visible = result.actions.filter((a) => MODULE_IDS.includes(a.moduleId));
    expect(visible.length).toBe(declared.length);
    const distinctModules = new Set(visible.map((a) => a.moduleId));
    expect([...distinctModules].sort()).toEqual([...MODULE_IDS].sort());
  });

  it('disabling the catalog module hides only its actions', async () => {
    await em.nativeUpdate(ModuleRegistration, { moduleId: 'catalog' }, { state: 'disabled' });
    // The refresh the orchestrator runs after every state write. Without it the
    // combiner still holds the pre-flip presence, which is the correct answer
    // for that instant and the reason `presenceVersion` exists.
    await cache.refreshFromDb(() => em);
    try {
      const service = buildService(['*']);
      const result = await service.listVisibleForOperator({
        language: 'en',
        adminUserId: 'admin',
      });
      const visible = result.actions.filter((a) => MODULE_IDS.includes(a.moduleId));
      expect(visible.find((a) => a.moduleId === 'catalog')).toBeUndefined();
      expect(visible.find((a) => a.moduleId === 'import_export')).toBeDefined();
      expect(visible.find((a) => a.moduleId === 'cms')).toBeDefined();
    } finally {
      await em.nativeUpdate(
        ModuleRegistration,
        { moduleId: 'catalog' },
        { state: 'installed' },
      );
      await cache.refreshFromDb(() => em);
    }
  });

  it('an operator with no permissions sees no seeded action at all', async () => {
    const service = buildService([]);
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'guest',
    });
    const visible = result.actions.filter((a) => MODULE_IDS.includes(a.moduleId));
    // This used to assert that `settings:open-settings` survives, on the
    // grounds that it was the one seeded action without a `requiredPermission`.
    // That absence was the defect (issue #232), not a property: `/settings` is
    // `requireAdmin('settings:read')`, so the row this test protected was a
    // guaranteed 403 for every role that reached it. With the code declared,
    // an operator holding nothing is offered nothing — which is what Principle
    // XVI item 2 asks for.
    expect(visible.map((a) => `${a.moduleId}:${a.actionId}`)).toEqual([]);
  });
});

async function seed(em: EntityManager): Promise<void> {
  const knex = em.getKnex();
  const now = new Date();
  // Stamp registrations for every seeded module so the visibility
  // join treats them as installed.
  for (const moduleId of MODULE_IDS) {
    await knex('module_registrations')
      .insert({
        module_id: moduleId,
        state: 'installed',
        version: '1.0.0',
        installed_at: now,
        last_state_change_at: now,
      })
      .onConflict('module_id')
      .merge({
        state: 'installed',
        version: '1.0.0',
        last_state_change_at: now,
      });
  }
  // Reconcile actions from each manifest.
  const reconciler = new AdminActionsReconciler({ em: () => em });
  for (const m of SEEDED_MANIFESTS) {
    await reconciler.installForModule({
      moduleId: m.id,
      actions: m.actions ?? [],
    });
  }
}

async function cleanup(em: EntityManager): Promise<void> {
  for (const moduleId of MODULE_IDS) {
    await em.nativeDelete(ModuleAction, { moduleId });
    // Don't delete module_registrations rows we might not own — just
    // delete our own seeded actions and leave the registry intact.
  }
}
