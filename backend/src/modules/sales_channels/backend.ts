import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type {
  DictionaryValidator,
  SalesChannelAttributionRegistryPort,
} from '@b2b/contracts';
import type { CommandBus } from '../../commands/command-bus.js';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type {
  SalesChannelsCache,
  SalesChannelsCacheInvalidation,
} from '../../kernel/sales-channels/sales-channels-cache.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import { SalesChannelAttributionRegistry } from './services/sales-channel-attribution-registry.js';
import { SalesChannelsService } from './services/sales-channels.service.js';
import type { AdminAuditContext } from './services/sales-channels.service.js';
import { registerSalesChannelsAdminRoutes } from './routes.admin.js';

/**
 * `sales_channels` — what is left after the kernel took the resolution
 * machinery (feature 072, wave 2, T110).
 *
 * T019 moved the cache, the resolver, the membership service, the middleware
 * and the default-channel reconciler into `kernel/sales-channels/`, and this
 * conversion finishes the thought: a composition root composes those through
 * `composeSalesChannelsKernel`, and the module keeps only what an operator
 * would recognise as the module — the admin CRUD service and its routes.
 *
 * The division is not cosmetic. Resolving which channel a request belongs to
 * backs every channel-scoped read in the platform (Principle XII), so it must
 * not be gated on this module: switching the administration screens off would
 * otherwise leave every storefront request with no resolved channel.
 *
 * **`dictionaryValidator` was optional, and never once supplied.** Neither
 * composition passed it, so `SalesChannelsService` has been skipping the
 * language- and currency-code checks it declares — creating a channel with a
 * language nothing in the platform speaks is accepted today, silently. It is a
 * declared dependency now, not an option: its absence removes a check rather
 * than a capability, which is the line these conversions have been drawing.
 */

export interface SalesChannelsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditLogService;
  /** D-51 — moving the system-default flag is a Command (Principle XIII). */
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminAuditActorResolver: (req: FastifyRequest) => AdminAuditContext;
  /** Kernel-composed, so it is the same cache the resolver reads through. */
  readonly salesChannelsCache: SalesChannelsCache;
  readonly salesChannelMembershipPort: SalesChannelMembershipService;
  readonly dictionaryValidator: DictionaryValidator;
  /**
   * Owned here, contributed to from `orders` and `quote_requests` (feature 075,
   * D-87). A plain registration, not a port: a contributor pushes into it from
   * a boot hook, and a gate there would stop the backend from starting.
   */
  readonly salesChannelAttributionRegistry: SalesChannelAttributionRegistryPort;
  readonly salesChannelsService: SalesChannelsService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    /**
     * "Who is still attributed to this channel?" — the contribution seam the
     * FR-006 delete guard reads (feature 075, D-87). `SalesChannelsService`
     * used to answer it here, with one statement naming `orders` and
     * `quote_requests`; each owner counts its own rows now.
     *
     * `di.register`, not `di.providePort`: `orders` and `quote_requests` push
     * into this from their own boot hooks, and a gate resolved there would
     * refuse at a point in the boot that has nothing to answer. This module is
     * `nonDeactivatable`, so there is no flip for a gate to protect either.
     */
    salesChannelAttributionRegistry: ctx
      .asFunction(
        (): SalesChannelAttributionRegistryPort => new SalesChannelAttributionRegistry(),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'salesChannelsService',
    ctx
      .asFunction(
        ({
          emFactory,
          eventBus,
          auditLogService,
          commandBus,
          salesChannelAttributionRegistry,
        }: SalesChannelsCradle) =>
          new SalesChannelsService(
            emFactory,
            eventBus,
            // Another module's port, so it is resolved per call rather than
            // captured. Required since feature 075 — the branch its absence
            // used to take was a raw `select` over `languages` and
            // `currencies`, and it is gone.
            lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
            // This module's own registration, so it is captured like `emFactory`.
            salesChannelAttributionRegistry,
            auditLogService,
            // Resolved per call rather than captured: the cache is composed by a
            // root. Narrowed to the invalidating half (D-93): this service drops
            // the cache at its write seam and must not be able to seed it, which
            // is the resolver's job.
            lazyPort<SalesChannelsCacheInvalidation>(ctx, 'salesChannelsCache'),
            // A deployment input, like `emFactory` and `eventBus` — not a port,
            // so it is captured with them.
            commandBus,
          ),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const { salesChannelMembershipPort, requireAdmin } = ctx.cradle<SalesChannelsCradle>();

    await registerSalesChannelsAdminRoutes(app, {
      // Lazily, even though the module owns this port: route *registration* runs
      // inside `buildServer` whatever the module's effective state is, so
      // destructuring the gate here would stop the next start instead of
      // stopping the routes (D-40).
      salesChannelsService: lazyPort<SalesChannelsService>(ctx, 'salesChannelsService'),
      membershipService: salesChannelMembershipPort,
      requireAdmin,
      resolveAdminAuditContext: (req) =>
        ctx.cradle<SalesChannelsCradle>().adminAuditActorResolver(req),
    });
  });
}
