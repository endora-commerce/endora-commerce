import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { DictionaryValidator } from '@b2b/contracts';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import {
  SalesChannelsCache,
  type CachedChannel,
} from './services/sales-channels-cache.js';
import {
  attachSalesChannelsCacheInvalidator,
  type SalesChannelsCacheInvalidatorHandle,
} from './services/sales-channels-cache-invalidator.js';
import { DefaultChannelReconciler } from './services/default-channel-reconciler.js';
import { SalesChannelResolverService } from './services/sales-channel-resolver.service.js';
import { SalesChannelMembershipService } from './services/sales-channel-membership.service.js';
import {
  SalesChannelsService,
  type AdminAuditContext,
} from './services/sales-channels.service.js';
import { registerSalesChannelResolverMiddleware } from './middleware/sales-channel-resolver.js';
import { registerSalesChannelsAdminRoutes } from './routes.admin.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Composition root for the sales-channels module — feature 005 / T018.
 *
 * Exposes (through {@link SalesChannelsModuleHandle}):
 *   - `salesChannelsService` — admin-facing CRUD + lifecycle (US2).
 *   - `membershipService` — bidirectional M:N mutations consumed by
 *     every owning module (US3).
 *   - `resolver` — code-to-channel lookup used by the middleware
 *     and by any read path that needs the resolved channel.
 *   - `cache` — exposed for tests that want deterministic teardown.
 *
 * The plugin function registers the resolver Fastify middleware on
 * every `/api/v1/*` request. Admin HTTP routes for channel CRUD
 * (T034) and per-entity membership routes (T049-T058) are registered
 * by US2 / US3 — they are not part of this Phase 2 wire-up.
 *
 * Boot-time guarantees (FR-002, research R-4):
 *   - {@link DefaultChannelReconciler} runs from `composition.ts`
 *     BEFORE the plugin is registered, so by the time HTTP comes up
 *     the resolver can fall back to the system default safely.
 */

export interface SalesChannelsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  redis: Redis;
  auditLogService?: AuditLogService;
  /**
   * When provided, admin CRUD + lifecycle routes mount under
   * `/api/v1/admin/sales-channels/*`. When omitted, only the resolver
   * middleware is registered — useful for tests that don't want the
   * full admin surface.
   */
  requireAdmin?: RequireAdminFactory;
  resolveAdminAuditContext?: (req: FastifyRequest) => AdminAuditContext;
  /**
   * Forwarded to the resolver middleware. Defaults to `false` so admin
   * routes keep working without `X-Sales-Channel` until the admin UI is
   * updated; T046 turns this on for the production contract tests.
   */
  strictAdmin?: boolean;
  dictionaryValidator?: DictionaryValidator;
}

export interface SalesChannelsModuleHandle {
  cache: SalesChannelsCache;
  resolver: SalesChannelResolverService;
  membershipService: SalesChannelMembershipService;
  salesChannelsService: SalesChannelsService;
  /** Released for tests; in production it lives until process exit. */
  cacheInvalidator: SalesChannelsCacheInvalidatorHandle;
}

export interface SalesChannelsModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: SalesChannelsModuleHandle;
}

export function salesChannelsModule(
  options: SalesChannelsModuleOptions,
): SalesChannelsModuleResult {
  const cache = new SalesChannelsCache(options.redis);
  const resolver = new SalesChannelResolverService(options.emFactory, cache);
  const membershipService = new SalesChannelMembershipService(
    options.emFactory,
    options.eventBus,
    options.auditLogService,
  );
  const salesChannelsService = new SalesChannelsService(
    options.emFactory,
    options.eventBus,
    options.auditLogService,
    cache,
    options.dictionaryValidator,
  );
  const cacheInvalidator = attachSalesChannelsCacheInvalidator(
    options.eventBus,
    cache,
  );

  return {
    handle: {
      cache,
      resolver,
      membershipService,
      salesChannelsService,
      cacheInvalidator,
    },
    plugin: async (app) => {
      await registerSalesChannelResolverMiddleware(app, {
        resolver,
        ...(options.strictAdmin !== undefined ? { strictAdmin: options.strictAdmin } : {}),
        // Feature 062 — audit sink for bound-key channel-mismatch refusals.
        ...(options.auditLogService !== undefined
          ? { auditLogService: options.auditLogService }
          : {}),
      });
      if (options.requireAdmin) {
        await registerSalesChannelsAdminRoutes(app, {
          salesChannelsService,
          membershipService,
          requireAdmin: options.requireAdmin,
          ...(options.resolveAdminAuditContext !== undefined
            ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
            : {}),
        });
      }
      // Per-entity membership routes (US3 / T049-T058) mount on owning modules.
    },
  };
}

export type { CachedChannel };
export { DefaultChannelReconciler };
