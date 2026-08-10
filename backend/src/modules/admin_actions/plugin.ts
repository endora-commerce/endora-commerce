import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { ModulePlugin } from '../../http/server.js';
import type { LoadedManifestRegistry } from '../_lifecycle/services/manifest-loader.js';
import type { I18nService } from '../_i18n/services/i18n-service.js';
import type { PermissionService } from '../admin_roles/services/permission-service.js';
import { AdminActionsReconciler } from './services/admin-actions-reconciler.js';
import { AdminActionsService } from './services/admin-actions-service.js';
import {
  registerAdminActionsRoutes,
} from './routes.admin.js';
import type { FastifyRequest } from 'fastify';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin Actions module composition root — feature 020.
 *
 * Boot-time responsibilities:
 *
 *   1. Build the `AdminActionsService` (visibility + cache + pubsub).
 *   2. Build the `AdminActionsReconciler` (UPSERT + prune at install,
 *      DELETE at hard-uninstall).
 *   3. Run an idempotent reconcile pass — for every module whose
 *      manifest declares `actions`, refresh the `module_actions` rows
 *      from the manifest. Mirrors feature 019's i18n boot reconciler so
 *      the registry catches up after a redeploy without requiring a
 *      module:install of every module.
 *   4. Register the admin HTTP route.
 */

export interface AdminActionsModuleDeps {
  orm: MikroORM;
  emFactory: () => EntityManager;
  /** Lazy accessor — same chicken-and-egg pattern feature 019 uses. */
  registry?: LoadedManifestRegistry | (() => LoadedManifestRegistry | undefined);
  i18nService: I18nService;
  permissionService: PermissionService;
  redisSubscriber?: Redis;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
  log?: { info(msg: string): void; warn(msg: string): void };
  /**
   * Feature 073 — the operator presence axis, passed straight through to the
   * service. See `AdminActionsServiceDeps.isModuleActivated` for why it is
   * injected rather than read from the lifecycle singleton.
   */
  isModuleActivated?: (moduleId: string) => boolean;
}

export interface AdminActionsModuleHandle {
  service: AdminActionsService;
  /**
   * Lifecycle-orchestrator-shaped reconciler. Wired into feature 018's
   * `OrchestratorDeps.adminActionsReconciler`.
   */
  reconciler: {
    install(args: {
      moduleId: string;
      actions: readonly import('@b2b/contracts').ModuleAction[];
    }): Promise<{ upserted: number; pruned: number }>;
    remove(moduleId: string): Promise<{ removed: number }>;
  };
}

export interface AdminActionsModule {
  handle: AdminActionsModuleHandle;
  plugin: ModulePlugin;
}

export function adminActionsModule(deps: AdminActionsModuleDeps): AdminActionsModule {
  const log = deps.log ?? { info: () => {}, warn: (m) => console.warn(m) };
  const reconciler = new AdminActionsReconciler({ em: deps.emFactory });
  const service = new AdminActionsService({
    em: deps.emFactory,
    i18nService: deps.i18nService,
    permissionService: deps.permissionService,
    ...(deps.redisSubscriber ? { redisSubscriber: deps.redisSubscriber } : {}),
    ...(deps.isModuleActivated ? { isModuleActivated: deps.isModuleActivated } : {}),
    log,
  });

  const plugin: ModulePlugin = async (app) => {
    const registry =
      typeof deps.registry === 'function' ? deps.registry() : deps.registry;
    if (registry) {
      await reconcileActions(registry, reconciler, log);
    }
    await registerAdminActionsRoutes(app, {
      adminActionsService: service,
      requireAdmin: deps.requireAdmin,
      resolveAdminContext: deps.resolveAdminContext,
    });
  };

  return {
    handle: {
      service,
      reconciler: {
        install: async ({ moduleId, actions }) =>
          reconciler.installForModule({ moduleId, actions }),
        remove: async (moduleId) => reconciler.removeForModule({ moduleId }),
      },
    },
    plugin,
  };
}

/**
 * Idempotent reconciler — for every manifest with declared actions,
 * UPSERT them and prune any rows the manifest no longer declares.
 * Errors on a single module are logged but do NOT abort boot.
 */
async function reconcileActions(
  registry: LoadedManifestRegistry,
  reconciler: AdminActionsReconciler,
  log: { info(msg: string): void; warn(msg: string): void },
): Promise<void> {
  let installed = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of registry.modules.values()) {
    const actions = entry.manifest.actions;
    if (!actions || actions.length === 0) {
      skipped += 1;
      // Even when no actions are declared, prune any rows that may
      // remain from a previous version that did declare them. This is
      // the cheapest way to keep the table aligned with the current
      // manifest set.
      try {
        await reconciler.installForModule({ moduleId: entry.manifest.id, actions: [] });
      } catch (err) {
        // Pruning a non-existent row is a no-op; failure here means a
        // larger DB problem worth surfacing.
        log.warn(
          `[admin_actions] prune for "${entry.manifest.id}" failed: ${(err as Error).message}`,
        );
      }
      continue;
    }
    try {
      await reconciler.installForModule({
        moduleId: entry.manifest.id,
        actions,
      });
      installed += 1;
    } catch (err) {
      failed += 1;
      log.warn(
        `[admin_actions] reconcile: module "${entry.manifest.id}" failed: ${(err as Error).message}`,
      );
    }
  }
  log.info(
    `[admin_actions] reconcile complete — installed=${installed} skipped=${skipped} failed=${failed}`,
  );
}
