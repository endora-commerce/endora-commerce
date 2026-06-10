import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DictionaryValidator } from '@b2b/contracts';
import type Redis from 'ioredis';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { SettingsAdminService, type AdminAuditContext } from './services/settings-admin.service.js';
import { SettingsCache } from './services/settings-cache.js';
import { SettingsService } from './services/settings.service.js';
import {
  attachSettingsCacheInvalidator,
  type SettingsCacheInvalidatorHandle,
} from './services/settings-cache-invalidator.js';
import { registerSettingsAdminRoutes } from './routes.admin.js';
import { registerSettingsStorefrontRoutes } from './routes.storefront.js';
import { ShopInfoResolver } from './services/shop-info-resolver.js';

/**
 * Composition root for the settings module — feature 004.
 *
 * Exposes:
 *   - `handle.adminService` — used by HTTP routes (US2); also reachable for
 *     tests that need to seed values without going through HTTP.
 *   - `handle.settingsService` — the universal getter (US3) other modules
 *     consume. Wired with a shared `SettingsCache` (Redis + per-process LRU)
 *     when a `redis` instance is provided; falls back to no-cache otherwise.
 *
 * Boot-time manifest reconciliation runs from `composition.ts` directly
 * (T024); this plugin does not touch it.
 */

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface SettingsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  auditLogService?: AuditLogService;
  requireAdmin?: RequireAdminFactory;
  resolveAdminAuditContext?: (req: FastifyRequest) => AdminAuditContext;
  /** Feature 017 no-op for now; reserved for future typed dictionary-code settings. */
  dictionaryValidator?: DictionaryValidator;
  /** When omitted, the universal getter runs without a cache. */
  redis?: Redis;
}

export interface SettingsModuleHandle {
  adminService: SettingsAdminService;
  settingsService: SettingsService;
  shopInfoResolver: ShopInfoResolver;
  /** Released for tests; in production it lives until process exit. */
  cacheInvalidator?: SettingsCacheInvalidatorHandle;
}

export interface SettingsModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: SettingsModuleHandle;
}

export function settingsModule(
  options: SettingsModuleOptions,
): SettingsModuleResult {
  const adminService = new SettingsAdminService(
    options.emFactory,
    options.eventBus,
    options.auditLogService,
  );

  const cache = options.redis ? new SettingsCache(options.redis) : undefined;
  const settingsService = new SettingsService(options.emFactory, cache);
  const shopInfoResolver = new ShopInfoResolver(options.emFactory, settingsService);
  const cacheInvalidator = cache
    ? attachSettingsCacheInvalidator(options.eventBus, cache)
    : undefined;

  const noOpRequireAdmin: RequireAdminFactory =
    () => async (_req, _reply) => {
      /* permissive default — production wiring overrides */
    };

  return {
    handle: {
      adminService,
      settingsService,
      shopInfoResolver,
      ...(cacheInvalidator !== undefined ? { cacheInvalidator } : {}),
    },
    plugin: async (app) => {
      const requireAdminFn = options.requireAdmin ?? noOpRequireAdmin;
      await registerSettingsAdminRoutes(app, {
        adminService,
        requireAdmin: requireAdminFn,
        ...(options.resolveAdminAuditContext !== undefined
          ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
          : {}),
      });
      await registerSettingsStorefrontRoutes(app, { shopInfoResolver });
    },
  };
}
