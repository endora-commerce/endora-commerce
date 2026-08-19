import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogProductReadPort,
  CatalogPromoAttributePort,
  PromotionApplyPort,
  PromotionCodePort,
  DictionaryValidator,
  DictionaryReferenceRegistryPort,
} from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { OrganizationReadPort } from '../../kernel/ports/organizations.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import { PromotionService } from './services/promotion-service.js';
import type { PromotionUsageFinalizer } from './services/promotion-usage-finalizer.js';
import { PromotionCodeService } from './services/promotion-code-port.js';
import { CouponService } from './services/coupon-service.js';
import { PromotionRuleStore } from './services/promotion-rule-store.js';
import { PromotionStatsService } from './services/promotion-stats-service.js';
import { registerPromotionRoutes } from './routes.js';
import type { PromotionRuleTargetPorts } from './routes.js';
import { registerPromotionCurrencyReferences } from './services/promotion-currency-reference.js';

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
 * **One bundle stays in the root**, for the reason `megamenu`'s did.
 * `ruleTargets` reads `organizations`, `categories`, `payment_methods` and
 * `delivery_methods` tables directly; it belongs to modules that have not
 * converted, and pulling it in would give this module reads of storage it does
 * not own.
 *
 * `catalogQueryPort` used to be the second, and this comment used to say the
 * honest end state was for the two methods this module reached on
 * `CatalogQueryService` to move behind a narrower port. Feature 075's Phase P
 * did exactly that: `catalogPromoAttributePort` is those two questions, and
 * `catalogProductReadPort` is the per-line attribute hydration that used to be
 * an `em.find(Product, …)`. Both are resolved by contract type here.
 */

export interface PromotionsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly salesChannelMembershipPort: SalesChannelMembershipService;
  readonly dictionaryValidator: DictionaryValidator;
  /** Owned by `catalog`: the two promo-attribute questions the Rule Builder asks. */
  readonly catalogPromoAttributePort: CatalogPromoAttributePort;
  /** Owned by `catalog`: the product rows a cart line's attribute values come from. */
  readonly catalogProductReadPort: CatalogProductReadPort;
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

  /**
   * D-94.5 — the co-transactional half of the promotion seam, as its own
   * gated port.
   *
   * `orders` used to reach `finalizeUsage` through `promotionService`, typed
   * by an interface `orders` wrote itself: `lazyPort<T>` is an unchecked cast,
   * so with `T` on the consumer's side nothing verified that this module still
   * satisfied it. The interface is `PromotionUsageFinalizer`, declared beside
   * the implementation, and `orders` imports the type — a permanent
   * cross-module ledger entry naming `promotion_usages_order_fk`, because the
   * signature carries the caller's `EntityManager` and FR-034 keeps a MikroORM
   * type out of `@b2b/contracts`.
   */
  ctx.di.providePort<PromotionUsageFinalizer>(
    'promotionUsageFinalizer',
    ctx
      .asFunction((): PromotionUsageFinalizer => {
        // Lazily, even though this module owns the name: `providePort` gates
        // on the effective state, and a singleton that captured its own gate
        // would answer after an operator switched this module off.
        const service = lazyPort<PromotionService>(ctx, 'promotionService');
        return {
          finalizeUsage: (em, input) => service.finalizeUsage(em, input),
        };
      })
      .singleton(),
  );

  ctx.di.providePort<PromotionApplyPort>(
    'promotionService',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: PromotionsCradle) =>
          new PromotionService(
            emFactory,
            // The two required ones first (issue #164): both are resolved for
            // every composition, so the type no longer says otherwise.
            lazyPort<CatalogPromoAttributePort>(ctx, 'catalogPromoAttributePort'),
            lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            lazyPort<SalesChannelMembershipService>(ctx, 'salesChannelMembershipPort'),
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
      catalogPromoAttributes: lazyPort<CatalogPromoAttributePort>(
        ctx,
        'catalogPromoAttributePort',
      ),
      ruleTargets: promotionRuleTargets,
    });
  });

  /**
   * This module's rows carry a currency code, so it answers "who still points at
   * this currency?" about its own tables (feature 077, D-87), where the owner used
   * to count them with SQL naming this module's tables.
   *
   * A **contribution** hook: it pushes an inert descriptor into `currencyReferenceRegistry`,
   * an ungated registry, and carries no presence probe (D-62/D-68). Probing
   * would be wrong in the dangerous direction — a switched-off module still owns
   * the rows, so its currency must still refuse the delete, which is the
   * enumeration policy the registry states.
   */
  ctx.onBoot(() => {
    registerPromotionCurrencyReferences(
      lazyPort<DictionaryReferenceRegistryPort>(ctx, 'currencyReferenceRegistry'),
      ctx.cradle<PromotionsCradle>().emFactory,
    );
  });
}
