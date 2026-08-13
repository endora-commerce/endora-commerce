import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit/audit-log-service.js';
import { SalesChannelsCache } from './sales-channels-cache.js';
import { SalesChannelResolverService } from './sales-channel-resolver.service.js';
import { SalesChannelMembershipService } from './sales-channel-membership.service.js';
import {
  attachSalesChannelsCacheInvalidator,
  type SalesChannelsCacheInvalidatorHandle,
} from './sales-channels-cache-invalidator.js';
import { registerSalesChannelResolverMiddleware } from './sales-channel-resolver.middleware.js';

/**
 * The sales-channel resolution machinery, composed as kernel infrastructure
 * rather than as part of the `sales_channels` module (feature 072, T110).
 *
 * The split follows what the code already was after T019 moved these files
 * into `kernel/`: resolving which channel a request belongs to is something
 * every channel-scoped read depends on (Principle XII), and it has to keep
 * working whether or not an operator wants the channel *administration*
 * screens. Gating the middleware behind the module would mean switching
 * `sales_channels` off leaves every storefront request with no resolved
 * channel — not a smaller platform, a broken one.
 *
 * So the module keeps what is genuinely its own — the admin CRUD service, its
 * routes, its migrations and its settings — and this function composes the
 * rest for a composition root.
 */
export interface SalesChannelsKernelOptions {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly redis: Redis;
  readonly auditLogService?: AuditLogService;
  /**
   * Forwarded to the resolver middleware. Defaults to `false` so admin routes
   * keep working without `X-Sales-Channel`.
   */
  readonly strictAdmin?: boolean;
}

export interface SalesChannelsKernel {
  readonly cache: SalesChannelsCache;
  readonly resolver: SalesChannelResolverService;
  readonly membershipService: SalesChannelMembershipService;
  /** Released for tests; in production it lives until process exit. */
  readonly cacheInvalidator: SalesChannelsCacheInvalidatorHandle;
  /** The resolver middleware, mounted by the root and never module-gated. */
  readonly plugin: (app: FastifyInstance) => Promise<void>;
}

export function composeSalesChannelsKernel(
  options: SalesChannelsKernelOptions,
): SalesChannelsKernel {
  const cache = new SalesChannelsCache(options.redis);
  const resolver = new SalesChannelResolverService(options.emFactory, cache);
  const membershipService = new SalesChannelMembershipService(
    options.emFactory,
    options.eventBus,
    options.auditLogService,
  );
  const cacheInvalidator = attachSalesChannelsCacheInvalidator(options.eventBus, cache);

  return {
    cache,
    resolver,
    membershipService,
    cacheInvalidator,
    plugin: async (app) => {
      await registerSalesChannelResolverMiddleware(app, {
        resolver,
        ...(options.strictAdmin !== undefined ? { strictAdmin: options.strictAdmin } : {}),
        // Feature 062 — audit sink for bound-key channel-mismatch refusals.
        ...(options.auditLogService !== undefined
          ? { auditLogService: options.auditLogService }
          : {}),
      });
    },
  };
}
