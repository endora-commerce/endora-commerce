import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogAttributeReadPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  ListingPricePort,
  OrganizationDetailsPort,
} from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelMembershipPort } from '../../kernel/ports/sales-channel.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { ComparisonService } from './services/comparison-service.js';
import { ComparisonAdminService } from './services/comparison-admin.service.js';
import { ComparableAttributeProjection } from './services/comparable-attribute-projection.js';
import { ShareTokenGenerator } from './services/share-token-generator.js';
import { ComparisonPdfRenderer } from './services/comparison-pdf-renderer.js';
import { registerComparisonsPublicRoutes } from './routes.public.js';
import { registerComparisonsShareRoutes } from './routes.share.js';
import { registerComparisonsAdminRoutes } from './routes.admin.js';

/**
 * `comparisons` — the module that made a whole service to throw it away
 * (feature 072, wave 2, T111).
 *
 * `ComparisonService`'s second constructor parameter was `_catalogQuery:
 * CatalogQueryService` — underscore-prefixed, unused, kept with the comment
 * "constructor contract kept; attribute reads moved to `catalogAttributes`".
 * To feed it, each composition root built an entire `CatalogQueryService`,
 * one of four per composition, and handed it to a parameter that discards it.
 * The parameter is gone and so is the construction; `catalogAttributeRead` is
 * what this module actually reads attributes through, and it stays.
 *
 * **`requireAdmin` becomes required, and this one failed *safe* before.** Where
 * `cms` and `assets_library` defaulted an absent gate to a permissive no-op,
 * this module's plugin read
 *
 *     if (options.requireAdmin) { await registerComparisonsAdminRoutes(…) }
 *
 * so an omitted gate removed the admin surface rather than opening it. That is
 * the right direction to fail in, and it is still worth removing: whether an
 * API exists at all should not be a side effect of an argument being passed.
 * Both roots passed one, so the surface is unchanged.
 *
 * `settingsService` stops being optional too. Absent, `compare.max_products`
 * silently fell back to a constant on every call, which is the quiet form —
 * an operator's configured limit ignored with no indication.
 *
 * `comparisonService` is a **port**: the login flow adopts an anonymous
 * comparison through it, across a module boundary.
 */

export interface ComparisonsCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: SettingsService;
  readonly comparisonService: ComparisonService;
  readonly comparisonAdminService: ComparisonAdminService;
  readonly comparisonShareTokens: ShareTokenGenerator;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'comparisonService',
    ctx
      .asFunction(
        ({ emFactory }: ComparisonsCradle) =>
          new ComparisonService(
            emFactory,
            new ComparableAttributeProjection(),
            ctx.cradle<ComparisonsCradle>().comparisonShareTokens,
            // Feature 075, Phase C — the products a comparison holds are
            // `catalog`'s rows. They used to be read with `em.find(Product, …)`
            // from inside this module, which no gate can see; over the port the
            // same read answers 503 when `catalog` is off, which is the
            // binding dependency this manifest declares.
            lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            // Issue #259 — the channel assortment gate on the add seam. A
            // kernel registration, so there is no module edge to declare and
            // nothing to switch off underneath it.
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            lazyPort<SettingsService>(ctx, 'settingsReadPort'),
            // The attribute read model, now `catalog`'s published port rather
            // than a hand-made adapter over a name a root registered.
            lazyPort<CatalogAttributeReadPort>(ctx, 'catalogAttributeReadPort'),
            // Issue #132 — a comparison column is a listing and prices through
            // the engine, not off the catalogue's legacy attribute.
            lazyPort<ListingPricePort>(ctx, 'pricingService'),
            // The viewer's organisation, for the customer group the pricing
            // engine selects a group-targeted list by. The edge binds: a
            // comparison that cannot read the buyer's organisation would quote
            // the channel price to a buyer who has negotiated one, which is
            // silently wrong rather than visibly refused.
            lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
          ),
      )
      .singleton(),
  );

  ctx.di.register({
    // One generator, registered rather than constructed twice. It happens to be
    // stateless today — `randomBytes(16)` and nothing else — so two instances
    // would agree; registering it means that stays true by construction rather
    // than by the class never gaining a key.
    comparisonShareTokens: ctx.asFunction(() => new ShareTokenGenerator()).singleton(),

    comparisonAdminService: ctx
      .asFunction(
        ({ emFactory }: ComparisonsCradle) =>
          new ComparisonAdminService(
            emFactory,
            // Resolved per call, not captured. `comparisonService` is a
            // transient port gate and Awilix's strict mode refuses a singleton
            // holding one — rightly, since a captured port keeps answering
            // after its module is switched off. `buildOwnerView` is the only
            // method this service reaches.
            {
              buildOwnerView: (
                ...args: Parameters<ComparisonService['buildOwnerView']>
              ) => ctx.cradle<ComparisonsCradle>().comparisonService.buildOwnerView(...args),
            } as ComparisonService,
            // Feature 075, Phase C — the owner column's e-mail address is
            // `customer_accounts`' row, read over its port instead of out of
            // its table.
            lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          ),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { requireAdmin, comparisonShareTokens } = ctx.cradle<ComparisonsCradle>();
    // The module's own two ports, read lazily. Route *registration* runs
    // whatever the module's effective state is — `defineModuleRoutes` gates
    // requests, not the wiring — so destructuring a gated port here asked the
    // gate inside `buildServer`, and an operator who had switched `comparisons`
    // off stopped the backend from starting rather than stopping its routes.
    const comparisonService = lazyPort<ComparisonService>(ctx, 'comparisonService');
    await registerComparisonsPublicRoutes(app, {
      comparisonService,
      tokens: comparisonShareTokens,
      pdfRenderer: new ComparisonPdfRenderer(),
    });
    await registerComparisonsShareRoutes(app, { comparisonService });
    await registerComparisonsAdminRoutes(app, {
      adminService: lazyPort<ComparisonAdminService>(ctx, 'comparisonAdminService'),
      requireAdmin,
    });
  });
}
