import { dirname } from 'node:path';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { ModulePlugin } from '../../http/server.js';
import type { LoadedManifestRegistry } from '../_lifecycle/services/manifest-loader.js';
import type { AdminUserService } from '../admin_users/services/admin-user-service.js';
import { I18nService } from './services/i18n-service.js';
import { BundleLoadError } from './services/bundle-loader.js';
import {
  registerI18nAdminRoutes,
  type RequireAdminFactory,
} from './routes.admin.js';
import type { FastifyRequest } from 'fastify';

/**
 * Admin UI i18n module composition root — feature 019.
 *
 * Boot-time responsibilities:
 *
 *   1. Build the `I18nService` (per-language merged-bundle resolver).
 *   2. Run an idempotent reconciler that walks every module with a
 *      declared `manifest.i18n` and installs / refreshes its bundle
 *      rows in `translation_bundles`. This mirrors feature 018's
 *      `reconcileExistingModules` — it lets the i18n subsystem land on
 *      a running platform without requiring an explicit
 *      `module:install` for every translation update.
 *
 * Hard-uninstall integration with the lifecycle orchestrator is
 * documented as a follow-up — soft-uninstall is already a no-op (rows
 * persist, FR-016 unchanged), and the v1 reconciler covers install /
 * upgrade. See specs/019-admin-i18n/research.md §R9 for the trade-off.
 */

export interface I18nModuleDeps {
  orm: MikroORM;
  emFactory: () => EntityManager;
  /**
   * Lifecycle registry — optional. When supplied, the boot-time reconciler
   * walks every module declaring `manifest.i18n` and refreshes its bundle
   * rows. Tests can omit it; the routes still work because they read from
   * `translation_bundles` directly (rows seeded by another path or absent
   * → resolver returns the placeholder per FR-013).
   */
  registry?: LoadedManifestRegistry;
  adminUserService: AdminUserService;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
  log?: { info(msg: string): void; warn(msg: string): void };
}

export interface I18nModuleHandle {
  i18nService: I18nService;
}

export interface I18nModule {
  handle: I18nModuleHandle;
  plugin: ModulePlugin;
}

export function i18nModule(deps: I18nModuleDeps): I18nModule {
  const i18nService = new I18nService({ em: deps.emFactory });
  const log = deps.log ?? { info: () => {}, warn: (msg) => console.warn(msg) };

  const plugin: ModulePlugin = async (app) => {
    if (deps.registry) {
      await reconcileBundles(deps.registry, i18nService, log);
    }
    await registerI18nAdminRoutes(app, {
      i18nService,
      adminUserService: deps.adminUserService,
      requireAdmin: deps.requireAdmin,
      resolveAdminContext: deps.resolveAdminContext,
    });
  };

  return {
    handle: { i18nService },
    plugin,
  };
}

/**
 * Idempotent reconciler — for every module whose manifest declares an
 * `i18n.bundlesDir`, refresh its `translation_bundles` rows from the
 * JSON files on disk. Errors from the loader (malformed JSON, missing
 * EN bundle, etc.) are logged but do NOT abort the boot — a single
 * bad bundle should not take down the platform; the gap surfaces via
 * FR-014's diagnostic surface and the platform keeps serving.
 */
async function reconcileBundles(
  registry: LoadedManifestRegistry,
  i18nService: I18nService,
  log: { info(msg: string): void; warn(msg: string): void },
): Promise<void> {
  let installed = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of registry.modules.values()) {
    const i18n = entry.manifest.i18n;
    if (!i18n) {
      skipped += 1;
      continue;
    }
    const moduleId = entry.manifest.id;
    const modulePath = dirname(entry.filePath);
    try {
      const result = await i18nService.installBundlesForModule(
        moduleId,
        modulePath,
        i18n.bundlesDir,
      );
      if (result.installed.length > 0) {
        installed += 1;
      }
    } catch (err) {
      failed += 1;
      if (err instanceof BundleLoadError) {
        log.warn(
          `[i18n] reconcile: module "${moduleId}" bundle load failed (${err.reason}): ${err.message}`,
        );
      } else {
        log.warn(`[i18n] reconcile: module "${moduleId}" failed: ${(err as Error).message}`);
      }
    }
  }
  log.info(
    `[i18n] reconcile complete — installed=${installed} skipped=${skipped} failed=${failed}`,
  );
}
