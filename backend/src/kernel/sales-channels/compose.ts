import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit/audit-log-service.js';
import { inProcessCaches } from '../cache/in-process-cache-registry.js';
import {
  SALES_CHANNELS_CACHE_NAMESPACE,
  SalesChannelsCache,
} from './sales-channels-cache.js';
import { SalesChannelResolverService } from './sales-channel-resolver.service.js';
import { SalesChannelMembershipService } from './sales-channel-membership.service.js';
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
  /**
   * Withdraws this process's cache from the operator-facing clear. Released
   * for tests; in production it lives until process exit.
   */
  readonly cacheRegistration: { readonly dispose: () => void };
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
  /**
   * The one thing composing the cache still has to *do*: announce it to the
   * operator-facing "clear cache" action (issue #33). The clear runs in this
   * process and has to reach the object that owns both layers, or it drops the
   * Redis keys while every warm process keeps serving — and re-pinning — the
   * channel it had already resolved.
   *
   * It used to ride on `attachSalesChannelsCacheInvalidator`, which also
   * subscribed to `sales_channels.identity_changed` and
   * `sales_channels.lifecycle_changed`. Those subscriptions are gone (D-93);
   * the registration is not, because it never had anything to do with the bus.
   */
  const unregister = inProcessCaches.register(SALES_CHANNELS_CACHE_NAMESPACE, cache);

  return {
    cache,
    resolver,
    membershipService,
    cacheRegistration: { dispose: unregister },
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
