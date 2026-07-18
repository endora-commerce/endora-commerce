import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerGroupService } from './services/customer-group-service.js';
import { PriceListService } from './services/price-list-service.js';
import { PricingService } from './services/pricing-service.js';
import { PriceListStatusWorker } from './services/price-list-status-worker.js';
import { PricingCache } from './services/pricing-cache.js';
import { registerPricingRoutes } from './routes.js';
import { registerStorefrontPricingRoutes } from './routes.storefront.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';

const STATUS_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface PriceListsAuditContext {
  actorAdminUserId: string;
  impersonatedCustomerAccountId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface PriceListsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /**
   * Set to `false` to skip the in-process status sweeper (tests drive
   * the worker directly via `internal/sweep`; production keeps it on).
   * The platform doesn't yet ship a BullMQ-class repeatable-job
   * registry — when it does, swap this for a Queue/Worker pair on the
   * existing pricing queue (research §R13).
   */
  enableStatusSweeper?: boolean;
  /** Pass `0` to disable the in-memory pricing LRU (tests). */
  pricingCacheTtlMs?: number;
  /** Feature 024 — optional cross-module hook so price-list mutations land in the audit log. */
  auditLogService?: AuditLogService;
  /** Feature 054 — audits `patch` co-transactionally when provided. */
  commandBus?: CommandBus;
  /** Feature 024 — resolves the admin actor identity for audit entries. */
  resolveAdminAuditContext?: (req: FastifyRequest) => {
    actorAdminUserId: string;
    impersonatedCustomerAccountId?: string | null;
  };
}

export interface PriceListsModuleHandle {
  customerGroupService: CustomerGroupService;
  priceListService: PriceListService;
  pricingService: PricingService;
  statusWorker: PriceListStatusWorker;
}

export function priceListsModule(options: PriceListsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: PriceListsModuleHandle;
} {
  const customerGroupService = new CustomerGroupService(options.emFactory);
  const pricingCache = new PricingCache<Awaited<ReturnType<PricingService['resolveEngine']>>>(
    options.pricingCacheTtlMs !== undefined ? { ttlMs: options.pricingCacheTtlMs } : {},
  );
  const priceListService = new PriceListService(
    options.emFactory,
    pricingCache,
    options.auditLogService,
    options.commandBus,
  );
  const pricingService = new PricingService(options.emFactory, pricingCache);
  const statusWorker = new PriceListStatusWorker(options.emFactory);

  return {
    handle: { customerGroupService, priceListService, pricingService, statusWorker },
    plugin: async (app: FastifyInstance) => {
      await registerPricingRoutes(app, {
        customerGroupService,
        priceListService,
        pricingService,
        emFactory: options.emFactory,
        requireAdmin: options.requireAdmin,
        ...(options.resolveAdminAuditContext
          ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
          : {}),
      });
      await registerStorefrontPricingRoutes(app, {
        priceListService,
        pricingService,
        emFactory: options.emFactory,
      });

      if (options.enableStatusSweeper !== false) {
        const handle = setInterval(() => {
          statusWorker
            .sweep()
            .then((result) => {
              if (result.scheduledToActive > 0 || result.activeToExpired > 0) {
                app.log.info(
                  { result },
                  'price-list status sweep flipped lifecycle rows',
                );
              }
            })
            .catch((err: unknown) => {
              app.log.error({ err }, 'price-list status sweep failed');
            });
        }, STATUS_SWEEP_INTERVAL_MS);
        // Don't keep the Node process alive purely for the sweeper.
        if (typeof handle.unref === 'function') handle.unref();
        app.addHook('onClose', async () => {
          clearInterval(handle);
        });
      }
    },
  };
}
