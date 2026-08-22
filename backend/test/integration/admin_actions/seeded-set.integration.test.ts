import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { AdminActionsReconciler } from '../../../src/modules/admin_actions/services/admin-actions-reconciler.js';
import { AdminActionsService } from '../../../src/modules/admin_actions/services/admin-actions-service.js';
import { ModuleAction } from '../../../src/modules/admin_actions/entities/module-action.entity.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import type { I18nService } from '../../../src/modules/_i18n/services/i18n-service.js';
import type { PermissionService } from '../../../src/modules/admin_roles/services/permission-service.js';
import type { SupportedAdminLanguage } from '@b2b/contracts';
import { manifest as catalogManifest } from '../../../src/modules/catalog/manifest.js';
import { manifest as importExportManifest } from '../../../src/modules/import_export/manifest.js';
import { manifest as inventoryManifest } from '../../../src/modules/inventory/manifest.js';
import { manifest as quoteRequestsManifest } from '../../../src/modules/quote_requests/manifest.js';
import { manifest as cmsManifest } from '../../../src/modules/cms/manifest.js';
import { manifest as blogManifest } from '../../../src/modules/blog/manifest.js';
import { manifest as megamenuManifest } from '../../../src/modules/megamenu/manifest.js';
import { manifest as salesChannelsManifest } from '../../../src/modules/sales_channels/manifest.js';
import { manifest as settingsManifest } from '../../../src/modules/settings/manifest.js';

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

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
    em = orm.em.fork() as EntityManager;
    await cleanup(em);
    await seed(em);
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

  it('exactly 10 distinct actions across 9 seeded modules', async () => {
    const service = buildService(['*']);
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });
    const visible = result.actions.filter((a) => MODULE_IDS.includes(a.moduleId));
    expect(visible.length).toBe(10);
    const distinctModules = new Set(visible.map((a) => a.moduleId));
    expect(distinctModules.size).toBe(9);
  });

  it('disabling the catalog module hides only its actions', async () => {
    await em.nativeUpdate(ModuleRegistration, { moduleId: 'catalog' }, { state: 'disabled' });
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
