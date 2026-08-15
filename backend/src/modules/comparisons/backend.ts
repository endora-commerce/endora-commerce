import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import type { CatalogAttributeReadService } from '../catalog/services/catalog-attribute-read.service.js';
import { Comparison } from './entities/comparison.entity.js';
import { ComparisonProduct } from './entities/comparison-product.entity.js';
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

export const entities = [Comparison, ComparisonProduct];

export interface ComparisonsCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: SettingsService;
  /** Owned by `catalog`; a root registers it until that module converts. */
  readonly catalogAttributeReadPort: CatalogAttributeReadService;
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
            lazyPort<SettingsService>(ctx, 'settingsReadPort'),
            // Resolved per call: `catalog` is hand-wired and a root registers
            // this after the pass this module composes in.
            {
              listByFlag: (flag: Parameters<CatalogAttributeReadService['listByFlag']>[0]) =>
                ctx.cradle<ComparisonsCradle>().catalogAttributeReadPort.listByFlag(flag),
            } as CatalogAttributeReadService,
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
