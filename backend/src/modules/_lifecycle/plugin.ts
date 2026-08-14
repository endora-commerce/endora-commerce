import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { ModulePlugin } from '../../http/server.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import {
  ModuleLifecycleOrchestrator,
  type OrchestratorDeps,
} from './services/orchestrator.js';
import type {
  ModuleRegistryCache} from './services/registry-cache.js';
import {
  registryCache
} from './services/registry-cache.js';
import { buildStaticRegistry } from './services/static-registry.js';
import type { LoadedManifestRegistry } from './services/manifest-loader.js';

export interface LifecycleModuleDeps {
  orm: MikroORM;
  redis: Redis;
  /** Subscriber-mode Redis client; ioredis requires a separate connection for pub/sub. */
  redisSubscriber: Redis;
  emFactory: () => EntityManager;
  auditLog: AuditLogService;
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

  // Feature 072 (D-38) — what is left of the boot half: arming the pub/sub
  // subscriber that keeps the loaded presence fresh.
  //
  // The load itself is gone from here, and that is the point. Loading at plugin
  // attach means loading inside `buildServer`, i.e. after `composeApp()` has
  // registered every module and run every boot hook — while eleven of those
  // hooks resolve a gated port. `loadModulePresence()` now runs as a
  // composition step before the first module registers; see
  // `services/presence-load.ts`.
  //
  // Three things went with it:
  //   - the first-boot reconciler, which is the load's first half;
  //   - `registryCache.start`, split into `load()` (fatal, PostgreSQL) and
  //     `watch()` (non-fatal, Redis);
  //   - the resume-everything worker loop. It existed to undo the pauses a cold
  //     cache caused at registration, and it iterated `enabledIds()` — the
  //     platform axis alone — so it resumed the workers of a module the
  //     operator had deactivated (a live Constitution XVII hole). With presence
  //     loaded before composition, `defineModuleWorker` sees the true effective
  //     state at registration and there is nothing to undo.
  const plugin: ModulePlugin = async () => {
    await registryCache.watch({
      redisSubscriber: deps.redisSubscriber,
      em: deps.emFactory,
    });

    // Feature 072 (T125) — the four route registrations moved to
    // `backend.ts`, where they are declared through `ctx.ungatedRoutes` with
    // the reason attached.
  };

  return {
    handle: { orchestrator, registryCache, registry: deps.registry },
    plugin,
  };
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
