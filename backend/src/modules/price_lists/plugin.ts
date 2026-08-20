import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort } from '@b2b/contracts';
import { PriceListService } from './services/price-list-service.js';
import { PricingService } from './services/pricing-service.js';
import type { PriceListTargetReads } from './services/price-list-service.js';
import type { PricingServiceContract } from './services/pricing-service.interface.js';
import { PriceListStatusWorker } from './services/price-list-status-worker.js';
import { PricingCache } from './services/pricing-cache.js';
import { registerPricingRoutes } from './routes.js';
import { registerStorefrontPricingRoutes } from './routes.storefront.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import { enterSystemScope } from '../../kernel/scope.js';

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
  /**
   * Feature 056 — resolves the acting org's inheritance chain (nearest-first)
   * so a descendant inherits an ancestor's org-named price list. Absent ⇒ flat.
   */
  resolveOrgChain?: (orgId: string) => Promise<readonly string[]>;
  /**
   * A client override of the pricing engine, as a **decoration** (feature 072,
   * D-28): it receives the core implementation and returns one that wraps it.
   *
   * This replaced feature 057's `pricingServiceClass`, which handed in a
   * subclass to construct *instead of* core. Replacement is why a client
   * override stopped receiving core fixes the day it was written — the next fix
   * to `resolveLinePrice` landed in a class the deployment no longer
   * instantiated. Wrapping keeps core in the call path.
   *
   * Absent ⇒ core, byte-for-byte unchanged for the bare-core build.
   */
  decoratePricingService?: (inner: PricingServiceContract) => PricingServiceContract;
  /**
   * Feature 075 Phase C — the neighbour read ports this module resolves instead
   * of importing `catalog`'s, `organizations`' and `customer_accounts`'
   * entities. Required: every one of them is a real dependency this module has
   * always had, and the manifest declares all of them.
   */
  targetReads: PriceListTargetReads;
  /**
   * Feature 076 (D-79) — the admin resolved-price probe's customer read. It is
   * not a rule target, so it is its own option rather than a fifth member of
   * `targetReads`.
   */
  customerAccountRead: CustomerAccountReadPort;
}

export interface PriceListsModuleHandle {
  priceListService: PriceListService;
  pricingService: PricingServiceContract;
  statusWorker: PriceListStatusWorker;
}

export function priceListsModule(options: PriceListsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: PriceListsModuleHandle;
} {
  const pricingCache = new PricingCache<Awaited<ReturnType<PricingService['resolveEngine']>>>(
    options.pricingCacheTtlMs !== undefined ? { ttlMs: options.pricingCacheTtlMs } : {},
  );
  const priceListService = new PriceListService(
    options.emFactory,
    pricingCache,
    options.auditLogService,
    options.commandBus,
    options.targetReads,
  );
  // Core is always constructed; a deployment override wraps it rather than
  // taking its place (feature 072, D-28). Consumers read
  // `handle.pricingService` unchanged, so the wrap propagates everywhere it is
  // used — and they read it as the *contract*, because a decorated engine is
  // deliberately not an instance of the core class.
  const corePricingService = new PricingService(
    options.emFactory,
    pricingCache,
    options.resolveOrgChain,
    options.targetReads,
  );
  const pricingService: PricingServiceContract =
    options.decoratePricingService?.(corePricingService) ?? corePricingService;
  const statusWorker = new PriceListStatusWorker(options.emFactory);

  return {
    handle: { priceListService, pricingService, statusWorker },
    plugin: async (app: FastifyInstance) => {
      await registerPricingRoutes(app, {
        priceListService,
        pricingService,
        emFactory: options.emFactory,
        requireAdmin: options.requireAdmin,
        catalogProductRead: options.targetReads.catalogProductRead,
        catalogCategoryRead: options.targetReads.catalogCategoryRead,
        organizationDetails: options.targetReads.organizationDetails,
        customerGroupRead: options.targetReads.customerGroupRead,
        customerAccountRead: options.customerAccountRead,
        ...(options.resolveAdminAuditContext
          ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
          : {}),
      });
      await registerStorefrontPricingRoutes(app, {
        priceListService,
        pricingService,
        emFactory: options.emFactory,
        catalogProductRead: options.targetReads.catalogProductRead,
        organizationDetails: options.targetReads.organizationDetails,
      });

      if (options.enableStatusSweeper !== false) {
        const handle = setInterval(() => {
          // Presence is asked first, and outside the promise chain's `catch`
          // (issue #126). The route seam gates *requests*; this body is not one,
          // so it runs at boot whatever the effective state, and a timer
          // callback has nowhere to throw to — `ModuleDisabledError` cannot
          // propagate from here and must be *decided*, not caught. Asking it
          // below, inside the `catch`, would make a switched-off module and a
          // genuinely failed sweep the same silent no-op — and a sweep that runs
          // while price lists are off changes what customers are charged.
          if (!effectiveState.isPresent('price_lists')) return;
          // Feature 072 (T034) — the timer is the entry point, so the scope
          // opens here and not inside `sweep()`: the same method is reachable
          // from an admin route (`routes.ts`), where it already runs inside the
          // request's scope and must not open a second one.
          enterSystemScope('price_lists: status sweep', () => statusWorker.sweep(), {
            entryPoint: 'interval',
          })
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
