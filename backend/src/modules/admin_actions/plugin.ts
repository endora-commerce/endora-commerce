import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type {
  AdminI18nTranslatePort,
  ModuleAction,
  PermissionReadPort,
} from '@endora-commerce/contracts';
import { AdminActionsReconciler } from './services/admin-actions-reconciler.js';
import {
  AdminActionsService,
  type ModulePresenceProbe,
} from './services/admin-actions-service.js';
import {
  registerAdminActionsRoutes,
} from './routes.admin.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * The attach function this module hands its composition root.
 *
 * Typed on `fastify`'s own `FastifyInstance` rather than on the platform's
 * `ModulePlugin`, which `contracts/host-package.md` §1.4g classifies **A**: the
 * host does not publish it, so a packaged module cannot name it. The
 * already-packaged `quote_requests` types its attach function the same way.
 */
type ModuleAttach = (app: FastifyInstance) => Promise<void>;

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

/**
 * One module's manifest, as the palette reconcile reads it: the id the
 * `module_actions` rows are keyed by, and the actions the manifest declares.
 *
 * Stated here rather than imported from `_lifecycle` (feature 075, Phase C),
 * for the reason `_i18n`'s `I18nManifestRegistryView` records. Which modules a
 * deployment ships is a **composition root's** input — `lifecycleManifestRegistry`
 * is a name a root supplies, not a port a module resolves — and `_lifecycle`'s
 * own `LoadedManifestRegistry` additionally carries a dependency graph and each
 * module's install hooks, none of which a palette reconcile has any business
 * seeing. Stating the demand is what keeps the two apart.
 */
export interface AdminActionsReconcileEntry {
  manifest: { id: string; actions?: readonly ModuleAction[] | undefined };
}

/** The slice of the lifecycle registry the palette reconcile walks. */
export interface AdminActionsManifestRegistryView {
  modules: { values(): Iterable<AdminActionsReconcileEntry> };
}

export interface AdminActionsModuleDeps {
  orm: MikroORM;
  emFactory: () => EntityManager;
  /** Lazy accessor — same chicken-and-egg pattern feature 019 uses. */
  registry?:
    | AdminActionsManifestRegistryView
    | (() => AdminActionsManifestRegistryView | undefined);
  i18nService: AdminI18nTranslatePort;
  permissionService: PermissionReadPort;
  redisSubscriber: Redis;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
  log?: { info(msg: string): void; warn(msg: string): void };
  /**
   * Feature 073 / issue #225 — the operator presence axis and its generation,
   * passed straight through to the service. See
   * `AdminActionsServiceDeps.presence` for why it is injected rather than read
   * from the lifecycle singleton, and why the two halves are one value.
   */
  presence: ModulePresenceProbe;
}

export interface AdminActionsModuleHandle {
  service: AdminActionsService;
  /**
   * Lifecycle-orchestrator-shaped reconciler, published as the
   * `adminActionsReconciler` port.
   *
   * It no longer has a consumer in this repository (feature 080, T036a): the
   * lifecycle orchestrator used to resolve it on every module's install, and
   * now collects this module's `lifecycleParticipant` from the manifest
   * registry instead — the one shape that also reaches a `module:*` command,
   * which composes no container to resolve a port from. The port stays
   * published because it is a legitimate seam for a caller that has a
   * container; withdrawing it is a contract decision of its own.
   */
  reconciler: {
    install(args: {
      moduleId: string;
      actions: readonly ModuleAction[];
    }): Promise<{ upserted: number; pruned: number }>;
    remove(moduleId: string): Promise<{ removed: number }>;
  };
}

export interface AdminActionsModule {
  handle: AdminActionsModuleHandle;
  plugin: ModuleAttach;
}

export function adminActionsModule(deps: AdminActionsModuleDeps): AdminActionsModule {
  const log = deps.log ?? { info: () => {}, warn: (m) => console.warn(m) };
  const reconciler = new AdminActionsReconciler({ em: deps.emFactory });
  const service = new AdminActionsService({
    em: deps.emFactory,
    i18nService: deps.i18nService,
    permissionService: deps.permissionService,
    ...(deps.redisSubscriber ? { redisSubscriber: deps.redisSubscriber } : {}),
    ...(deps.presence ? { presence: deps.presence } : {}),
    log,
  });

  const plugin: ModuleAttach = async (app) => {
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
  registry: AdminActionsManifestRegistryView,
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
