// Megamenu module plugin — feature 015 / T018, expanded by T027 + T029.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';

import { MegamenuReferenceRegistry } from './services/megamenu-reference-registry.js';
import { MegamenuCache, type MegamenuCacheOptions } from './services/megamenu-cache.js';
import { MegamenuService } from './services/megamenu-service.js';
import { MegamenuItemService } from './services/megamenu-item-service.js';
import {
  StorefrontResolver,
  type StorefrontDeps,
} from './services/storefront-resolver.js';
import type { TargetValidatorDeps } from './services/target-validator.js';
import { registerMegamenuAdminRoutes } from './routes.admin.js';
import { registerMegamenuStorefrontRoutes } from './routes.storefront.js';

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface MegamenuModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin?: RequireAdminFactory;
  /** Cross-module ports the target validator delegates to. */
  validatorDeps: TargetValidatorDeps;
  /** Cross-module ports the storefront resolver delegates to. */
  storefrontDeps: StorefrontDeps;
  /**
   * When provided, the storefront resolver caches its responses in Redis
   * with a 5-minute TTL. Tests pass a custom `cacheOptions.ttlSeconds=0`
   * to disable caching when they need every read to hit the DB.
   */
  redis?: Redis;
  cacheOptions?: MegamenuCacheOptions;
}

export interface MegamenuModuleHandle {
  menuService: MegamenuService;
  itemService: MegamenuItemService;
  storefrontResolver: StorefrontResolver;
  referenceRegistry: MegamenuReferenceRegistry;
  /** Storefront read-through cache — `undefined` when no Redis was wired. */
  cache: MegamenuCache | undefined;
}

export function megamenuModule(options: MegamenuModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: MegamenuModuleHandle;
} {
  const cache = options.redis
    ? new MegamenuCache(options.redis, options.cacheOptions ?? {})
    : undefined;

  const referenceRegistry = new MegamenuReferenceRegistry(options.emFactory);
  const menuService = new MegamenuService(options.emFactory, cache);
  const itemService = new MegamenuItemService(
    options.emFactory,
    menuService,
    options.validatorDeps,
    cache,
  );
  const storefrontResolver = new StorefrontResolver(
    options.emFactory,
    options.storefrontDeps,
    cache,
  );

  const handle: MegamenuModuleHandle = {
    menuService,
    itemService,
    storefrontResolver,
    referenceRegistry,
    cache,
  };

  const plugin = async (app: FastifyInstance) => {
    await registerMegamenuAdminRoutes(app, {
      menuService,
      itemService,
      ...(options.requireAdmin ? { requireAdmin: options.requireAdmin } : {}),
    });
    await registerMegamenuStorefrontRoutes(app, { storefrontResolver });
  };

  return { plugin, handle };
}
