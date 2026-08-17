import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  PromotionApplyPort,
  PromotionCodePort,
  DictionaryValidator,
} from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { OrganizationReadPort } from '../../kernel/ports/organizations.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import type { CatalogQueryService } from '../catalog/services/catalog-query.service.js';
import { PromotionService } from './services/promotion-service.js';
import { PromotionCodeService } from './services/promotion-code-port.js';
import { CouponService } from './services/coupon-service.js';
import { PromotionRuleStore } from './services/promotion-rule-store.js';
import { PromotionStatsService } from './services/promotion-stats-service.js';
import { registerPromotionRoutes } from './routes.js';
import type { PromotionRuleTargetPorts } from './routes.js';

/**
 * `promotions` — six optional arguments, one of which is a gate (feature 072,
 * wave 2, T115).
 *
 * The one worth naming is `resolveOrganizationStatus`, documented as
 * *"Defaults to 'skip' the gate when omitted (legacy composition)"*. Feature 026
 * US5 exists so an org-targeted promotion only fires for an **active**
 * Organization — a suspended or moderated customer should not keep receiving
 * negotiated discounts. Omitting the resolver skips that check entirely, so the
 * promotion applies to every organization regardless of status. Both roots pass
 * it, so nothing is live; it is a gate whose absent form is open, which is the
 * shape this transition has now removed ten times.
 *
 * `salesChannelMembership`, `dictionaryValidator` and `auditLog` are the same
 * story in quieter registers: without the first a new promotion binds to no
 * channel, without the second its language scope validates nothing, without the
 * third the write is unrecorded.
 *
 * **Two bundles stay in the root**, for the reason `megamenu`'s did.
 * `ruleTargets` reads `organizations`, `categories`, `payment_methods` and
 * `delivery_methods` tables directly, and `catalogQueryPort` is `catalog`'s
 * service; both belong to modules that have not converted, and pulling either
 * in would give this module reads of storage it does not own.
 *
 * `catalogQueryPort` is also the last live instance of the four-per-composition
 * `CatalogQueryService` recorded during wave-2 reconnaissance. Unlike
 * `comparisons`, which discarded it outright, this module genuinely uses two of
 * its methods — but both delegate to the attribute read model, so the honest
 * end state is for it to resolve `catalogAttributeReadPort` and for those two
 * methods to move. That is a refactor of `catalog`'s read surface rather than
 * of this module, so it stays as it is and stays recorded.
 */

export interface PromotionsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly salesChannelMembershipPort: SalesChannelMembershipService;
  readonly dictionaryValidator: DictionaryValidator;
  /** Owned by `catalog`; a root builds it until that module converts. */
  readonly catalogQueryPort: CatalogQueryService;
  /**
   * The tenancy read port — the gate that keeps a suspended org out (T138).
   * Was `organizationStatusResolver`, a raw `select "status" from
   * "organizations"` each root spelled by hand against another module's table.
   */
  readonly organizationReadPort: OrganizationReadPort;
  /** Rule Builder picker sources; root-shaped, reads four other modules' tables. */
  readonly promotionRuleTargets: PromotionRuleTargetPorts;
  readonly promotionService: PromotionService;
  readonly promotionCouponService: CouponService;
  readonly promotionRuleStore: PromotionRuleStore;
  readonly promotionStatsService: PromotionStatsService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point: a composition with no picker sources gets empty
    // pickers, not a broken Rule Builder.
    promotionRuleTargets: ctx
      .asFunction((): PromotionRuleTargetPorts => ({}))
      .singleton(),

    promotionCouponService: ctx
      .asFunction(
        ({ emFactory, auditLogService }: PromotionsCradle) =>
          new CouponService(emFactory, auditLogService),
      )
      .singleton(),

    promotionRuleStore: ctx
      .asFunction(
        ({ emFactory, auditLogService }: PromotionsCradle) =>
          new PromotionRuleStore(emFactory, auditLogService),
      )
      .singleton(),

    promotionStatsService: ctx
      .asFunction(({ emFactory }: PromotionsCradle) => new PromotionStatsService(emFactory))
      .singleton(),
  });

  /**
   * Feature 075, Phase P — the coupon-resolution port.
   *
   * `carts` reaches both promotion entities for one question: is this code
   * live, and which promotion is it? The three-step lookup behind it — the
   * legacy inline code, then the coupon table, then the promotion behind the
   * coupon, each filtered on `isActive` — is this module's, and reproducing it
   * in `carts` meant reproducing it correctly.
   */
  ctx.di.providePort<PromotionCodePort>(
    'promotionCodePort',
    ctx
      .asFunction(({ emFactory }: PromotionsCradle) => new PromotionCodeService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<PromotionApplyPort>(
    'promotionService',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: PromotionsCradle) =>
          new PromotionService(
            emFactory,
            lazyPort<SalesChannelMembershipService>(ctx, 'salesChannelMembershipPort'),
            lazyPort<CatalogQueryService>(ctx, 'catalogQueryPort'),
            lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
            undefined, // auditLogger — default console
            async (orgId: string) =>
              (
                await ctx
                  .cradle<PromotionsCradle>()
                  .organizationReadPort.loadEffectiveOrganization(orgId)
              )?.status ?? null,
            undefined, // actionRegistry — default built-ins
            auditLogService,
          ),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const {
      promotionCouponService,
      promotionRuleStore,
      promotionStatsService,
      requireAdmin,
      promotionRuleTargets,
    } = ctx.cradle<PromotionsCradle>();
    await registerPromotionRoutes(app, {
      // Lazily, even though the module owns this port: route *registration* runs
      // inside `buildServer` whatever the module's effective state is, so
      // destructuring the gate here would stop the next start instead of
      // stopping the routes (D-40).
      promotionService: lazyPort<PromotionService>(ctx, 'promotionService'),
      couponService: promotionCouponService,
      ruleStore: promotionRuleStore,
      statsService: promotionStatsService,
      requireAdmin,
      catalogQueryService: lazyPort<CatalogQueryService>(ctx, 'catalogQueryPort'),
      ruleTargets: promotionRuleTargets,
    });
  });
}
