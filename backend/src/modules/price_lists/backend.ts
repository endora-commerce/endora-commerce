import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type {
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CustomerGroupReadPort,
  OrganizationDetailsPort,
  PriceListAdminPort,
  PriceListReadPort,
} from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { priceListsModule, type PriceListsModuleOptions } from './plugin.js';
import { DEFAULT_PRICING_CACHE_TTL_MS } from './services/pricing-cache.js';
import {
  CustomerGroupReadService,
  PriceListReadService,
  toPriceListRecord,
} from './services/price-list-read-port.js';
import type { PricingServiceContract } from './services/pricing-service.interface.js';

/**
 * `price_lists` — the decoration proof target (feature 072, wave 3, T127).
 *
 * `decoratePricingService` is why this module is in the feature at all, and it
 * survives the conversion unchanged in shape: a contribution point the module
 * owns and defaults absent, which a deployment fills with a wrapper over core.
 * D-28's whole argument is that a client override must *receive* the core
 * implementation rather than replace it, and a contribution point is exactly
 * that shape — the module always constructs core and hands it to whatever the
 * root contributed.
 *
 * Two options are root-supplied rather than env-derived, and for the reason
 * that has now bitten four conversions: the test harness genuinely differs.
 * `enableStatusSweeper` is off there because a wall-clock interval per test
 * file writes to the database at random moments, and `pricingCacheTtlMs` is 0
 * because a test writes a price and reads it back in the same breath. Neither
 * is a property of the module, and neither should be inferred from a missing
 * argument.
 *
 * **The TTL's default came home in T143a cluster 6.** `pricingCacheTtlMs` is a
 * contribution point, so it needs a default, and the default is this module's
 * `DEFAULT_PRICING_CACHE_TTL_MS` — which production was importing *out of this
 * module* to hand straight back to it. A root repeating a module's own constant
 * is a knob that can drift while looking like configuration: the harness's 0 is
 * a real composition decision and stays, and production now contributes
 * nothing, which is what "no opinion" should look like.
 *
 * `resolveOrgChain` becomes a real port read. It is `organizations`'
 * inheritance resolver, and its absence made feature 056 resolve flat — a
 * descendant never picked up an ancestor's org-named list. Both roots passed
 * it; the manifest now declares the dependency that was always there.
 *
 * The admin audit context stays contributed, because the two compositions
 * disagree on something real: production substitutes a zero UUID for a
 * non-admin caller and the harness substitutes its test admin. That is a
 * composition's answer to "who is acting", not the module's.
 */

/** What `price_lists` resolves from the container, and the names it owns. */
export interface PriceListsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly organizationInheritancePort: {
    priceListOrgChain: (orgId: string) => Promise<readonly string[]>;
  };
  /**
   * Feature 075 Phase C — the neighbour reads this module made by importing
   * `catalog`'s and `organizations`' entities. Each is resolved lazily, so a
   * switched-off owner refuses at the call rather than at composition.
   */
  readonly catalogProductReadPort: CatalogProductReadPort;
  readonly catalogCategoryReadPort: CatalogCategoryReadPort;
  readonly organizationDetailsPort: OrganizationDetailsPort;
  /** Composition-specific: a wall-clock sweeper is wrong in a test harness. */
  readonly priceListsEnableStatusSweeper: boolean;
  /**
   * Contribution point, defaulted to this module's own `DEFAULT_PRICING_CACHE_TTL_MS`.
   * A composition overrides it where it means something: the harness sets 0, so
   * the LRU is off and a write is read back at once.
   */
  readonly priceListsPricingCacheTtlMs: number;
  /** Root-shaped: production and the harness name a non-admin caller differently. */
  readonly priceListsAdminAuditContext: NonNullable<
    PriceListsModuleOptions['resolveAdminAuditContext']
  >;
  /** Contribution point (D-28): absent ⇒ core pricing, byte for byte. */
  readonly decoratePricingService: PriceListsModuleOptions['decoratePricingService'];
  readonly priceLists: ReturnType<typeof priceListsModule>;
  readonly pricingService: PricingServiceContract;
  readonly customerGroupService: ReturnType<typeof priceListsModule>['handle']['customerGroupService'];
  readonly priceListService: ReturnType<typeof priceListsModule>['handle']['priceListService'];
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point, absent by default: the bare-core build.
    decoratePricingService: ctx
      .asFunction((): PriceListsCradle['decoratePricingService'] => undefined)
      .singleton(),

    // Contribution point, defaulted to the module's own constant (T143a). A
    // root that wants the shipped behaviour now writes nothing; the harness
    // overrides it in the root contribution slot — after `composeModules`,
    // before `runBootHooks()` — which is the order a contribution point needs:
    // earlier and this default overwrites the root, later and a boot hook has
    // already read this default.
    priceListsPricingCacheTtlMs: ctx
      .asFunction((): number => DEFAULT_PRICING_CACHE_TTL_MS)
      .singleton(),

    priceLists: ctx
      .asFunction(
        ({
          emFactory,
          auditLogService,
          commandBus,
          priceListsEnableStatusSweeper,
          priceListsPricingCacheTtlMs,
        }: PriceListsCradle) =>
          priceListsModule({
            emFactory,
            auditLogService,
            commandBus,
            enableStatusSweeper: priceListsEnableStatusSweeper,
            pricingCacheTtlMs: priceListsPricingCacheTtlMs,
            requireAdmin: (permission) => async (req, reply) =>
              ctx.cradle<PriceListsCradle>().requireAdmin(permission)(req, reply),
            resolveAdminAuditContext: (req: FastifyRequest) =>
              ctx.cradle<PriceListsCradle>().priceListsAdminAuditContext(req),
            resolveOrgChain: (orgId) =>
              ctx.cradle<PriceListsCradle>().organizationInheritancePort.priceListOrgChain(orgId),
            // Feature 075 Phase C. `lazyPort` rather than a cradle read: these
            // are handed to services this factory builds as a singleton, and a
            // captured gate keeps answering after its owner is switched off.
            targetReads: {
              catalogProductRead: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
              catalogCategoryRead: lazyPort<CatalogCategoryReadPort>(
                ctx,
                'catalogCategoryReadPort',
              ),
              organizationDetails: lazyPort<OrganizationDetailsPort>(
                ctx,
                'organizationDetailsPort',
              ),
            },
            // Read at construction, and it has to be: the decoration decides
            // which object every consumer then holds, so it cannot be deferred
            // past the moment the engine is built.
            ...(ctx.cradle<PriceListsCradle>().decoratePricingService === undefined
              ? {}
              : {
                  decoratePricingService: ctx.cradle<PriceListsCradle>()
                    .decoratePricingService!,
                }),
          }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'pricingService',
    ctx.asFunction(({ priceLists }: PriceListsCradle) => priceLists.handle.pricingService).singleton(),
  );
  ctx.di.providePort(
    'customerGroupService',
    ctx
      .asFunction(({ priceLists }: PriceListsCradle) => priceLists.handle.customerGroupService)
      .singleton(),
  );
  ctx.di.providePort(
    'priceListService',
    ctx
      .asFunction(({ priceLists }: PriceListsCradle) => priceLists.handle.priceListService)
      .singleton(),
  );

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // The three ports above hand out services built inside the plugin, and the
  // two heaviest consumers do not want a service at all: `organizations` and
  // `product_feeds` read a price-list *row*, `customers` and `pwa` read a
  // customer-group row. Those four reach the entity classes today; these two
  // read ports are what they rewire to.
  //
  // `priceListAdminPort` narrows `PriceListService` to the five methods
  // `pim_ergonode` measurably calls during an import run. `PricingServiceContract`
  // stays in `services/pricing-service.interface.ts` — it is the feature-057
  // decoration's contract gate, and moving it would move the gate.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<PriceListReadPort>(
    'priceListReadPort',
    ctx.asFunction(({ emFactory }: PriceListsCradle) => new PriceListReadService(emFactory)).singleton(),
  );

  ctx.di.providePort<CustomerGroupReadPort>(
    'customerGroupReadPort',
    ctx
      .asFunction(({ emFactory }: PriceListsCradle) => new CustomerGroupReadService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<PriceListAdminPort>(
    'priceListAdminPort',
    ctx
      .asFunction((): PriceListAdminPort => {
        const service = (): PriceListsCradle['priceListService'] =>
          ctx.cradle<PriceListsCradle>().priceLists.handle.priceListService;
        return {
          getById: async (id) => toPriceListRecord(await service().getById(id)),
          listProducts: (priceListId) => service().listProducts(priceListId),
          addProduct: (priceListId, productId) => service().addProduct(priceListId, productId),
          replaceBrackets: (priceListId, productId, bracketsByCurrency) =>
            service().replaceBrackets(priceListId, productId, bracketsByCurrency),
          summarizeBracketsForProduct: (productId) =>
            service().summarizeBracketsForProduct(productId),
        };
      })
      .singleton(),
  );

  ctx.routes(async (app) => {
    await ctx.cradle<PriceListsCradle>().priceLists.plugin(app);
  });
}
