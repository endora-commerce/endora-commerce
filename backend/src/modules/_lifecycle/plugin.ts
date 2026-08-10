import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { ModulePlugin } from '../../http/server.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import {
  ModuleLifecycleOrchestrator,
  type OrchestratorDeps,
} from './services/orchestrator.js';
import type {
  ModuleRegistryCache} from './services/registry-cache.js';
import {
  registryCache
} from './services/registry-cache.js';
import { activationDeclarationsFrom } from './services/activation-resolver.js';
import { buildStaticRegistry } from './services/static-registry.js';
import type { LoadedManifestRegistry } from './services/manifest-loader.js';
import {
  registerLifecycleAdminRoutes,
  registerModulePresenceRoutes,
} from './routes.admin.js';
import { registerModulePresenceStorefrontRoutes } from './routes.storefront.js';
import { ModuleRegistration } from './entities/module-registration.entity.js';
import { resumeWorkersFor } from './plugin-helpers.js';
import { findInactiveModules } from './registered-manifests.js';
import type { CommandBus } from '../../commands/index.js';
import { publishStateChanged } from './services/registry-cache.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface LifecycleModuleDeps {
  orm: MikroORM;
  redis: Redis;
  /** Subscriber-mode Redis client; ioredis requires a separate connection for pub/sub. */
  redisSubscriber: Redis;
  emFactory: () => EntityManager;
  auditLog: AuditLogService;
  requireAdmin: RequireAdminFactory;
  /**
   * Either a pre-built registry (production composition root supplies the
   * static one), or a manifest list the module composes itself.
   */
  registry: LoadedManifestRegistry;
  /**
   * Optional Admin UI i18n reconciler — feature 019. When supplied, the
   * orchestrator drives bundle install on module:install and bundle
   * removal on module:uninstall --hard. Soft-uninstall preserves bundles.
   * The reconciler is provided by `_i18n`'s plugin handle.
   */
  i18nReconciler?: OrchestratorDeps['i18nReconciler'];
  /**
   * Optional Admin Command Palette actions reconciler — feature 020.
   * When supplied, the orchestrator drives module_actions UPSERT on
   * module:install and DELETE on module:uninstall --hard. Soft-uninstall
   * leaves rows in place; visibility is gated by the registry-state join.
   */
  adminActionsReconciler?: OrchestratorDeps['adminActionsReconciler'];
  /**
   * Feature 073 — the operator-activation write path. Optional: without it the
   * presence projection still serves, because rendering a correct navigation
   * must not depend on being able to change it.
   */
  commandBus?: CommandBus;
  /**
   * Drops the storefront's `modules:presence` cache entry after a flip, so a
   * toggle is visible on the next storefront request without a rebuild
   * (FR-036). Best-effort by contract — see `StorefrontRevalidator`.
   */
  revalidateStorefront?: (tags: string[]) => Promise<void>;
}

export interface LifecycleModuleHandle {
  orchestrator: ModuleLifecycleOrchestrator;
  registryCache: ModuleRegistryCache;
  registry: LoadedManifestRegistry;
}

export interface LifecycleModule {
  /** Composition handle exposed to other modules and the test harness. */
  handle: LifecycleModuleHandle;
  /** Fastify plugin — registers the read-only admin endpoint (US4). */
  plugin: ModulePlugin;
}

export function lifecycleModule(deps: LifecycleModuleDeps): LifecycleModule {
  const orchestrator = new ModuleLifecycleOrchestrator({
    orm: deps.orm,
    redis: deps.redis,
    em: deps.emFactory,
    auditLog: deps.auditLog,
    registry: deps.registry,
    ...(deps.i18nReconciler ? { i18nReconciler: deps.i18nReconciler } : {}),
    ...(deps.adminActionsReconciler
      ? { adminActionsReconciler: deps.adminActionsReconciler }
      : {}),
  } satisfies OrchestratorDeps);

  // Plugin warms the registry cache on first registration and registers
  // the read-only admin endpoint (US4 / contracts/admin-http.md E-1).
  const plugin: ModulePlugin = async (app) => {
    // Surface modules whose code is on disk but that have no manifest
    // (or no registry entry). They participate in no lifecycle feature
    // — no i18n bundles, no admin actions, no settings registration —
    // and are effectively inactive until a manifest is added.
    for (const inactive of findInactiveModules()) {
      app.log.warn(
        { module: inactive.id, reason: inactive.reason },
        '[lifecycle] module is inactive — add a manifest.ts and register it in registered-manifests.ts',
      );
    }

    // First-boot reconciler: existing modules that don't yet have a row
    // in `module_registrations` get one with state='installed' so the
    // request-time enabled-check returns true. Without this every
    // pre-feature-018 deployment would 503 the moment defineModuleRoutes
    // was wired into a module's routes file.
    await reconcileExistingModules(deps.emFactory, deps.registry);

    await registryCache.start({
      redis: deps.redis,
      redisSubscriber: deps.redisSubscriber,
      em: deps.emFactory,
      // Feature 073 — the operator-activation axis. Declarations come from the
      // loaded manifests, so there is no hand-maintained list: a module that
      // declares no control is governed by the platform axis alone.
      activationDeclarations: activationDeclarationsFrom(
        [...deps.registry.modules.values()].map((entry) => entry.manifest),
      ),
    });

    // Resume any BullMQ workers that registered *before* this plugin warmed
    // the cache. `defineModuleWorker` starts a worker paused when its module
    // reads as disabled at registration time; modules wired earlier in the
    // composition (e.g. `catalog`, which owns the bulk-operation /
    // search-reindex worker) hit that branch because the enabled-set was
    // still empty. The orchestrator only resumes workers on an explicit
    // enable transition, so without this an already-installed module's
    // worker would stay paused for the whole process lifetime and its queue
    // (e.g. `catalog.bulk-operation`) would never drain. Resuming is a no-op
    // for workers that were already running.
    for (const moduleId of registryCache.enabledIds()) {
      await resumeWorkersFor(moduleId);
    }

    await registerLifecycleAdminRoutes(app, {
      orchestrator,
      requireAdmin: deps.requireAdmin,
    });
    // Feature 073 — the presence projections and the activation write. Both
    // reads sit outside `defineModuleRoutes`: `_lifecycle` is non-deactivatable,
    // and gating the surface that tells the frontends what is present on the
    // state it reports would be circular.
    registerModulePresenceRoutes(app, {
      requireAdmin: deps.requireAdmin,
      ...(deps.commandBus
        ? {
            activation: {
              commandBus: deps.commandBus,
              propagation: {
                // The writing process refreshes itself rather than waiting on
                // its own pub/sub round trip, so the very next request it
                // serves already sees the new state.
                refreshLocalState: () => registryCache.refreshFromDb(deps.emFactory),
                publishStateChanged: (payload) => publishStateChanged(deps.redis, payload),
                revalidateStorefront: deps.revalidateStorefront ?? (async () => undefined),
              },
            },
          }
        : {}),
    });
    registerModulePresenceStorefrontRoutes(app);
  };

  return {
    handle: { orchestrator, registryCache, registry: deps.registry },
    plugin,
  };
}

/**
 * First-boot reconciler — idempotent.
 *
 * For every manifest in the registry that has NO row in
 * `module_registrations`, inserts one with `state='installed'`. This
 * lets feature 018 land on a running platform without breaking the
 * gating wrappers (defineModuleRoutes, defineModuleWorker,
 * subscribeForModule) — pre-existing modules continue serving traffic
 * because their auto-created row marks them installed-and-enabled.
 *
 * Modules added AFTER feature 018 ships go through the explicit
 * `module:install <id>` flow.
 */
async function reconcileExistingModules(
  emFactory: () => EntityManager,
  registry: LoadedManifestRegistry,
): Promise<void> {
  const em = emFactory();
  const existing = await em.find(ModuleRegistration, {});
  const existingIds = new Set(existing.map((r) => r.moduleId));
  const now = new Date();
  for (const entry of registry.modules.values()) {
    if (existingIds.has(entry.manifest.id)) continue;
    em.create(ModuleRegistration, {
      moduleId: entry.manifest.id,
      state: 'installed',
      version: entry.manifest.version,
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
  }
  await em.flush();
}

/**
 * Convenience factory for the production composition root: build the
 * lifecycle module from a static list of manifest entries plus the
 * cross-cutting deps. Other call sites (CLI scripts, tests) typically
 * pass a `LoadedManifestRegistry` they already discovered.
 */
export function lifecycleModuleFromStaticEntries(
  deps: Omit<LifecycleModuleDeps, 'registry'>,
  entries: Parameters<typeof buildStaticRegistry>[0],
): LifecycleModule {
  return lifecycleModule({
    ...deps,
    registry: buildStaticRegistry(entries),
  });
}
