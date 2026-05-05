// Megamenu module plugin — feature 015 / T018.
//
// Phase 2 ships the in-process services + the cross-module ports;
// admin + storefront route registrations are placeholders and land in
// subsequent user-story phases (Phase 3 — US1, Phase 4 — US2, etc.).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';

import { MegamenuReferenceRegistry } from './services/megamenu-reference-registry.js';
import { MegamenuCache, type MegamenuCacheOptions } from './services/megamenu-cache.js';
import type { TargetValidatorDeps } from './services/target-validator.js';

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface MegamenuModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin?: RequireAdminFactory;
  /**
   * Cross-module ports the target validator delegates to. Each port has
   * a small, explicit shape so individual module wiring stays transparent.
   */
  validatorDeps: TargetValidatorDeps;
  /**
   * When provided, the storefront resolver caches its responses in Redis
   * with a 5-minute TTL. Tests pass a custom `cacheOptions.ttlSeconds=0`
   * to disable caching when they need every read to hit the DB.
   */
  redis?: Redis;
  cacheOptions?: MegamenuCacheOptions;
}

export interface MegamenuModuleHandle {
  referenceRegistry: MegamenuReferenceRegistry;
  /** Storefront read-through cache — `undefined` when no Redis was wired. */
  cache: MegamenuCache | undefined;
}

export function megamenuModule(options: MegamenuModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: MegamenuModuleHandle;
} {
  // Quiet the unused-arg warning until Phase 3 introduces the route
  // registrations. The reference is kept so the dependency graph stays
  // visible to reviewers.
  void options.validatorDeps;

  const cache = options.redis
    ? new MegamenuCache(options.redis, options.cacheOptions ?? {})
    : undefined;

  const referenceRegistry = new MegamenuReferenceRegistry(options.emFactory);

  const handle: MegamenuModuleHandle = {
    referenceRegistry,
    cache,
  };

  const plugin = async (_app: FastifyInstance) => {
    // Admin + storefront routes land in user-story phases. Phase 2 only
    // wires the module's services so subsequent phases can plug in HTTP
    // surfaces incrementally without re-touching the plugin shell.
  };

  return { plugin, handle };
}
