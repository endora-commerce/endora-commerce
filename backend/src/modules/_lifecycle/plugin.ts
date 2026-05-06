import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { ModulePlugin } from '../../http/server.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import {
  ModuleLifecycleOrchestrator,
  type OrchestratorDeps,
} from './services/orchestrator.js';
import {
  registryCache,
  ModuleRegistryCache,
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
  } satisfies OrchestratorDeps);

  // Plugin is intentionally minimal in v1: it warms the registry cache on
  // first registration. The read-only admin endpoint (`GET /api/v1/admin/modules`)
  // lands in US4's routes.admin.ts.
  const plugin: ModulePlugin = async () => {
    await registryCache.start({
      redis: deps.redis,
      redisSubscriber: deps.redisSubscriber,
      em: deps.emFactory,
    });
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
