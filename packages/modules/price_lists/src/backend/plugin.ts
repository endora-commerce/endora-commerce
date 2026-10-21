import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort, SalesRepAssignmentPort } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { PriceListService } from './services/price-list-service.js';
import { PricingService, type PricingServiceOptions } from './services/pricing-service.js';
import type { BookLineAnswer, ChannelBridgeSubquery } from './services/book-pricing.js';
import type { ProfilePricingCacheKey } from './services/pricing-cache.js';
import type { PricingProfile, ProfileMemoKey } from './services/pricing-profile.js';
import { PriceBookService } from './services/price-book-service.js';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import type { PriceListTargetReads } from './services/price-list-service.js';
import type { PricingServiceContract } from './services/pricing-service.interface.js';
import { PriceListStatusWorker, type SweepResult } from './services/price-list-status-worker.js';
import { PricingCache } from './services/pricing-cache.js';
import {
  PricingGeneration,
  type PricingGenerationPublisher,
} from './services/pricing-generation.js';
import { BuyerLinePriceService } from './services/buyer-line-price-service.js';
import { registerPricingRoutes } from './routes.js';
import { registerStorefrontPricingRoutes } from './routes.storefront.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import {
  effectiveState,
  enterSystemScope,
  rethrowIfModuleDisabled,
} from '@endora-commerce/platform/kernel';

const STATUS_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export const STATUS_SWEEP_SCOPE_REASON = 'price_lists: status sweep';

/**
 * The body of one tick of the status sweeper's timer: ask whether any price
 * list is due to change status, and open the system scope only when one is
 * (issue #120). Answers what the sweep flipped, or `null` when it did not run.
 *
 * Entering the scope is what writes the `tenant.escape_hatch` audit record, and
 * a tick is five minutes from the last — further apart than the audit writer's
 * aggregation window — so a scope entered on every tick is 288 audit rows a day
 * on an installation whose price lists carry no dates at all.
 *
 * **The question is asked outside any scope and answers yes or no, nothing
 * else** (`PriceListStatusWorker.hasDueTransitions`). Everything the sweep
 * reads or writes is still read inside the scope, by `sweep()` itself — the
 * answer decides only *whether* the scope is entered.
 *
 * **A question that cannot be answered counts as yes.** The tick then runs as
 * it always did, scope and audit record included: a failing probe may cost an
 * audit row, and can never save one.
 *
 * The scope opens here, for the timer, and not inside `sweep()`: the same
 * method is reachable from an admin route (`routes.ts`), where it already runs
 * inside the request's scope and must not open a second one (feature 072,
 * T034).
 */
export async function statusSweepTick(
  worker: Pick<PriceListStatusWorker, 'sweep' | 'hasDueTransitions'>,
): Promise<SweepResult | null> {
  let hasWork = true;
  try {
    hasWork = await worker.hasDueTransitions();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return null;
  return enterSystemScope(STATUS_SWEEP_SCOPE_REASON, () => worker.sweep(), {
    entryPoint: 'interval',
  });
}

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
  /**
   * D-287 P0 — where a pricing generation bump is announced to every other
   * process. Absent, a bump clears this process only (the behaviour before it
   * existed). The subscribing half is armed by the module's boot hook.
   */
  pricingGenerationPublisher?: PricingGenerationPublisher;
  /** Feature 024 — optional cross-module hook so price-list mutations land in the audit log. */
  auditLogService?: AuditPort;
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
  /**
   * Feature 146 (threat model T8) — `organizations`' sales-rep scope. The admin
   * resolved-price probe answers a non-platform admin only about organizations
   * they may see.
   */
  salesRepScope: SalesRepAssignmentPort;
  /**
   * Feature 160 — the kernel's membership accessor: a price book's channel set
   * is the registered `price-list` bridge, read through its sanctioned
   * subquery and written through `replaceChannelsForEntity` (Principle XII).
   */
  salesChannelMembership?: Pick<
    SalesChannelMembershipPort,
    'entityIdsInChannelSubquery' | 'replaceChannelsForEntity' | 'listChannelsForEntity'
  >;
  /**
   * Feature 160 — which engine the batched entry points run. `legacy` until the
   * consumer phase of the feature switches the composition to `books`; see
   * `PricingServiceOptions`.
   */
  pricingModel?: PricingServiceOptions['model'];
  /** Feature 160 — ask the `price_lists.surface` worker for a rebuild (best effort). */
  requestSurfaceRebuild?: () => Promise<void>;
}

export interface PriceListsModuleHandle {
  priceListService: PriceListService;
  pricingService: PricingServiceContract;
  statusWorker: PriceListStatusWorker;
  /**
   * Feature 146 — the probe's body as a service, behind both the admin probe and
   * `buyerLinePricePort`, so the two cannot drift (research R2).
   */
  buyerLinePriceService: BuyerLinePriceService;
  /**
   * D-287 P0 — this process's pricing generation: the boot hook arms its
   * subscriber, and every writer bumps it after commit.
   */
  pricingGeneration: PricingGeneration;
  /** Feature 160 — the price-book write service (base prices, books, rows, channel sets). */
  priceBookService: PriceBookService;
  /** Feature 160 — the engine itself, for the surface worker and the subscriptions. */
  pricingEngine: PricingService;
}

export function priceListsModule(options: PriceListsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: PriceListsModuleHandle;
} {
  const ttl = options.pricingCacheTtlMs !== undefined ? { ttlMs: options.pricingCacheTtlMs } : {};
  const pricingCache = new PricingCache<Awaited<ReturnType<PricingService['resolveEngine']>>>(ttl);
  // Feature 160 — the price-book engine's layers: answers keyed by pricing
  // profile, and the profile memo per organization chain, group, channel and
  // currency (research R6). Same TTL, same generation.
  const bookCache = new PricingCache<BookLineAnswer, ProfilePricingCacheKey>(ttl);
  const profileMemo = new PricingCache<PricingProfile, ProfileMemoKey>(ttl);
  let pricingEngine: PricingService | undefined;
  // Every writer tells the generation, never the LRU directly: a bump clears
  // this process's layers and announces itself to every other process.
  const pricingGeneration = new PricingGeneration(
    {
      invalidateAll: () => {
        pricingCache.invalidateAll();
        bookCache.invalidateAll();
        profileMemo.invalidateAll();
        if (pricingEngine?.usesPriceBooks) pricingEngine.bookPricing.invalidateAll();
      },
    },
    options.pricingGenerationPublisher,
    // Feature 160 — the writer marks the price surface stale after its commit.
    async () => {
      if (pricingEngine?.usesPriceBooks) await pricingEngine.priceSurface.markStale();
    },
  );
  const priceListService = new PriceListService(
    options.emFactory,
    pricingGeneration,
    options.auditLogService,
    options.commandBus,
    options.targetReads,
  );
  // This module builds the engine; a deployment that overrides it wraps the
  // `pricingService` **registration** from an overlay module's
  // `ctx.di.decorate` (D-103), so nothing about the override reaches this
  // factory. It used to: `decoratePricingService` was a contribution point a
  // composition root filled from a file under `apps/<deployment>/decorations/`,
  // and that seam is retired — one mechanism, and it is the one that needs no
  // edit here when a second deployment overrides a second service.
  //
  // Consumers read `handle.pricingService` as the *contract* rather than as the
  // class, and that still matters: what the container hands out is a wrapper
  // whenever a deployment decorates the registration.
  pricingEngine = new PricingService(
    options.emFactory,
    pricingCache,
    options.resolveOrgChain,
    options.targetReads,
    // D-287 P0 — the customer's own group, for callers that name the account.
    options.customerAccountRead,
    {
      model: options.pricingModel ?? 'legacy',
      ...(options.salesChannelMembership
        ? { channelBridge: options.salesChannelMembership as ChannelBridgeSubquery }
        : {}),
      bookCache,
      profileMemo,
      ...(options.requestSurfaceRebuild ? { requestSurfaceRebuild: options.requestSurfaceRebuild } : {}),
    },
  );
  const pricingService: PricingServiceContract = pricingEngine;
  const priceBookService = new PriceBookService({
    emFactory: options.emFactory,
    ...(options.commandBus ? { commandBus: options.commandBus } : {}),
    pricingGeneration,
    ...(options.salesChannelMembership ? { channelMembership: options.salesChannelMembership } : {}),
    targetReads: options.targetReads,
  });
  const statusWorker = new PriceListStatusWorker(options.emFactory, pricingGeneration);
  // One engine instance behind the probe and the port alike: a quote's "price
  // at request" and its "current price" must be the same question.
  const buyerLinePriceService = new BuyerLinePriceService({
    pricingService,
    catalogProductRead: options.targetReads.catalogProductRead,
    customerAccountRead: options.customerAccountRead,
    organizationDetails: options.targetReads.organizationDetails,
    salesChannels: {
      findById: (id) => options.emFactory().findOne(SalesChannel, { id }),
      findSystemDefault: () => options.emFactory().findOne(SalesChannel, { systemDefault: true }),
    },
  });

  return {
    handle: {
      priceListService,
      pricingService,
      statusWorker,
      buyerLinePriceService,
      pricingGeneration,
      priceBookService,
      pricingEngine,
    },
    plugin: async (app: FastifyInstance) => {
      await registerPricingRoutes(app, {
        priceListService,
        emFactory: options.emFactory,
        requireAdmin: options.requireAdmin,
        catalogProductRead: options.targetReads.catalogProductRead,
        catalogCategoryRead: options.targetReads.catalogCategoryRead,
        organizationDetails: options.targetReads.organizationDetails,
        customerGroupRead: options.targetReads.customerGroupRead,
        customerAccountRead: options.customerAccountRead,
        buyerLinePriceService,
        salesRepScope: options.salesRepScope,
        statusWorker,
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
          // opens for it and not inside `sweep()`. Issue #120 — and only on a
          // tick that has a transition to make: `statusSweepTick` asks first,
          // outside any scope, and answers `null` when nothing was due.
          statusSweepTick(statusWorker)
            .then((result) => {
              if (result && (result.scheduledToActive > 0 || result.activeToExpired > 0)) {
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
