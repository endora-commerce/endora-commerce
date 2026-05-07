import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { I18nService } from '../../../src/modules/_i18n/services/i18n-service.js';
import { TranslationBundle } from '../../../src/modules/_i18n/entities/translation-bundle.entity.js';
import { AdminActionsReconciler } from '../../../src/modules/admin_actions/services/admin-actions-reconciler.js';
import { AdminActionsService } from '../../../src/modules/admin_actions/services/admin-actions-service.js';
import { ModuleAction } from '../../../src/modules/admin_actions/entities/module-action.entity.js';
import type { PermissionService } from '../../../src/modules/admin_roles/services/permission-service.js';
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
 * End-to-end integration test that wires the REAL I18nService into the
 * AdminActionsService and asserts every seeded action's labelKey
 * resolves to an actual translated string in BOTH supported languages
 * — never the raw-key placeholder. Exists specifically to catch the
 * "labelKey carries an unwanted module prefix" failure mode where the
 * resolver looks up `bundles[moduleId][key]` and misses because the
 * key was stored with the module prefixed onto it.
 *
 * The bundle filesystem is the source of truth: each module's
 * `i18n/{lang}.json` is loaded into `translation_bundles` via the real
 * I18nService, then the AdminActionsService translates each manifest's
 * label/description keys.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES_ROOT = resolve(HERE, '../../../src/modules');

interface SeededModule {
  id: string;
  manifest: typeof catalogManifest;
}

const SEEDED: ReadonlyArray<SeededModule> = [
  { id: 'catalog', manifest: catalogManifest },
  { id: 'import_export', manifest: importExportManifest },
  { id: 'inventory', manifest: inventoryManifest },
  { id: 'quote_requests', manifest: quoteRequestsManifest },
  { id: 'cms', manifest: cmsManifest },
  { id: 'blog', manifest: blogManifest },
  { id: 'megamenu', manifest: megamenuManifest },
  { id: 'sales_channels', manifest: salesChannelsManifest },
  { id: 'settings', manifest: settingsManifest },
];

const MODULE_IDS = SEEDED.map((m) => m.id);

describe('admin_actions i18n resolution (integration, real I18nService)', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    em = orm.em.fork() as EntityManager;
    await cleanup(em);
    await seedRegistrations(em);
    await seedActions(em);
    await seedBundles(em);
  }, 60_000);

  afterAll(async () => {
    await cleanup(em);
    await orm.close(true);
  });

  function buildService(): AdminActionsService {
    const i18nService = new I18nService({ em: () => em });
    const permStub: Pick<PermissionService, 'listPermissions'> = {
      listPermissions: async (): Promise<string[]> => ['*'],
    };
    return new AdminActionsService({
      em: () => em,
      i18nService,
      permissionService: permStub as PermissionService,
    });
  }

  for (const language of ['en', 'pl'] as const) {
    it(`every seeded action resolves to a non-placeholder label in ${language}`, async () => {
      const service = buildService();
      const result = await service.listVisibleForOperator({
        language,
        adminUserId: 'admin',
      });
      const visible = result.actions.filter((a) => MODULE_IDS.includes(a.moduleId));
      expect(visible.length).toBe(10);
      for (const action of visible) {
        // The placeholder shape returned by the resolver when a key is
        // missing is `${moduleId}.${key}`. Asserting the label is NOT
        // any string of that shape catches the prefix-mismatch bug
        // exhaustively.
        expect(
          action.label,
          `${action.moduleId}/${action.actionId} label is the raw-key placeholder in ${language}: ${action.label}`,
        ).not.toMatch(/^[a-z_]+\.actions\./);
        expect(action.label.length).toBeGreaterThan(0);
      }
    });

    it(`every seeded action with a descriptionKey resolves to a non-placeholder description in ${language}`, async () => {
      const service = buildService();
      const result = await service.listVisibleForOperator({
        language,
        adminUserId: 'admin',
      });
      const visible = result.actions.filter((a) => MODULE_IDS.includes(a.moduleId));
      for (const action of visible) {
        if (action.description == null) continue;
        expect(
          action.description,
          `${action.moduleId}/${action.actionId} description is the raw-key placeholder in ${language}: ${action.description}`,
        ).not.toMatch(/^[a-z_]+\.actions\./);
        expect(action.description.length).toBeGreaterThan(0);
      }
    });
  }

  it('Polish operators see Polish labels (sample: catalog/new-product)', async () => {
    const service = buildService();
    const result = await service.listVisibleForOperator({
      language: 'pl',
      adminUserId: 'admin',
    });
    const newProduct = result.actions.find(
      (a) => a.moduleId === 'catalog' && a.actionId === 'new-product',
    );
    expect(newProduct?.label).toBe('Nowy produkt');
  });

  it('English operators see English labels (sample: catalog/new-product)', async () => {
    const service = buildService();
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });
    const newProduct = result.actions.find(
      (a) => a.moduleId === 'catalog' && a.actionId === 'new-product',
    );
    expect(newProduct?.label).toBe('New product');
  });
});

async function seedRegistrations(em: EntityManager): Promise<void> {
  const knex = em.getKnex();
  const now = new Date();
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
      .merge({ state: 'installed', last_state_change_at: now });
  }
}

async function seedActions(em: EntityManager): Promise<void> {
  const reconciler = new AdminActionsReconciler({ em: () => em });
  for (const m of SEEDED) {
    await reconciler.installForModule({
      moduleId: m.id,
      actions: m.manifest.actions ?? [],
    });
  }
}

async function seedBundles(em: EntityManager): Promise<void> {
  const i18nService = new I18nService({ em: () => em });
  for (const m of SEEDED) {
    await i18nService.installBundlesForModule(m.id, resolve(MODULES_ROOT, m.id), 'i18n');
  }
}

async function cleanup(em: EntityManager): Promise<void> {
  for (const moduleId of MODULE_IDS) {
    await em.nativeDelete(ModuleAction, { moduleId });
    await em.nativeDelete(TranslationBundle, { moduleId });
  }
}
