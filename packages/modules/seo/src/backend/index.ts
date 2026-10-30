import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryReadPort,
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CatalogProductUrlKeyReadPort,
  CmsPageReadPort,
  SeoMetaWritePort,
  SeoProductMetaPort,
  SettingWriteValidatorRegistryPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { MetaTagResolverService } from './services/meta-tag-resolver.service.js';
import {
  SitemapGeneratorService,
  type SitemapGeneratorOptions,
} from './services/sitemap-generator.service.js';
import {
  StorefrontAddressService,
  type StorefrontAddressSettingsPort,
} from './services/storefront-address.service.js';
import {
  CrawlerFilePreviewService,
  createCrawlerFilePreviewStore,
  type CrawlerFilePreviewSettingsPort,
} from './services/crawler-file-preview.service.js';
import { registerSeoRoutes, type SeoRouteSettingsPort } from './routes.js';
import { createCrawlerTextValidator } from './services/crawler-text-validator.js';
import { SeoMetaOverride } from './entities/seo-meta-override.entity.js';
import { SitemapCache } from './entities/sitemap-cache.entity.js';
import { marksSitemapStale } from './services/sitemap-staleness.js';

/**
 * `seo` — the sitemap that only read its setting in production (feature 072,
 * wave 2, T117).
 *
 * `SitemapGeneratorService` resolves a channel's base URL in three steps:
 * the per-channel `sales_channels.storefront_url` setting, then
 * `STOREFRONT_BASE_URL`, then a fallback. The settings port that makes the
 * first step possible was an optional constructor argument, `composition.ts`
 * passed one and `test-server.ts` did not — so under the harness that step has
 * never existed and every sitemap URL has come from env or fallback.
 *
 * That is the `cms` shape again, in its quieter form: not an endpoint that
 * 500s, but a resolution step that silently is not there, producing a
 * plausible answer from the next rung down. Resolving `settingsReadPort` here
 * gives both compositions the same three steps.
 *
 * `sitemapOptions` stays a contribution point rather than becoming env-derived.
 * It is genuinely composition-specific — the harness pins `staleAfterMs: 0` so
 * regeneration is deterministic and a fixed `baseUrl` so an assertion has
 * something stable to match — and a module should not have to know which of its
 * callers is a test.
 *
 * SEO overrides are admin writes, and since feature 163 they run as Commands on
 * the container's `commandBus` — one audit entry per request with the full row
 * before and after — rather than through a hand-held audit sink.
 */


export interface SeoCradle {
  readonly emFactory: () => EntityManager;
  /** Every SEO override write is a Command (feature 163, analyze C1). */
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: StorefrontAddressSettingsPort;
  /** Composition-specific sitemap tuning; `{}` in production. */
  readonly sitemapOptions: SitemapGeneratorOptions;
  readonly seoMetaResolver: MetaTagResolverService;
  readonly seoSitemapService: SitemapGeneratorService;
  /** Where a channel's storefront is, and which rung said so. */
  readonly seoStorefrontAddress: StorefrontAddressService;
  readonly seoCrawlerFilePreview: CrawlerFilePreviewService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    sitemapOptions: ctx.asFunction((): SitemapGeneratorOptions => ({})).singleton(),

    seoMetaResolver: ctx
      .asFunction(
        ({ emFactory, commandBus }: SeoCradle) =>
          new MetaTagResolverService(
            emFactory,
            commandBus,
            // Feature 075, Phase C. Never captured: the proxies resolve per
            // call, so a switched-off owner answers 503 `MODULE_DISABLED` at
            // the call rather than through a gate frozen at composition time.
            lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            lazyPort<CatalogCategoryReadPort>(ctx, 'catalogCategoryReadPort'),
            lazyPort<CmsPageReadPort>(ctx, 'cmsPageReadPort'),
            // Feature 163 — a channel-scoped override needs the product in the channel (FR-014).
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
          ),
      )
      .singleton(),

    // One resolution of a channel's storefront address, for the sitemap that
    // stamps URLs with it and the preview that asks the storefront at it. The
    // last rung is the composition's: the harness pins it through
    // `sitemapOptions.baseUrl`, as it did when this lived in the sitemap service.
    seoStorefrontAddress: ctx
      .asFunction(
        ({ sitemapOptions }: SeoCradle) =>
          new StorefrontAddressService(
            lazyPort<StorefrontAddressSettingsPort>(ctx, 'settingsReadPort'),
            { fallbackUrl: sitemapOptions.baseUrl },
          ),
      )
      .singleton(),

    // The preview of a channel's crawler file
    // (`specs/144-seo-search-engine-robots/contracts/admin-surfaces.md` §3).
    // No `fetchFn` is passed: the service reads the platform's `fetch` at each
    // call, and every bound on the request is a constant in its own file.
    seoCrawlerFilePreview: ctx
      .asFunction(
        ({ emFactory, seoStorefrontAddress }: SeoCradle) =>
          new CrawlerFilePreviewService(
            lazyPort<CrawlerFilePreviewSettingsPort>(ctx, 'settingsReadPort'),
            createCrawlerFilePreviewStore(emFactory),
            seoStorefrontAddress,
          ),
      )
      .singleton(),

    seoSitemapService: ctx
      .asFunction(
        ({ emFactory, sitemapOptions, seoStorefrontAddress }: SeoCradle) =>
          new SitemapGeneratorService(
            emFactory,
            seoStorefrontAddress,
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            lazyPort<CatalogCategoryReadPort>(ctx, 'catalogCategoryReadPort'),
            lazyPort<CmsPageReadPort>(ctx, 'cmsPageReadPort'),
            // Feature 163 — what is available to a crawler, per channel language.
            lazyPort<CatalogProductAvailabilityPort>(ctx, 'catalogProductAvailabilityPort'),
            // Feature 163 — each product's URL key per channel language.
            lazyPort<CatalogProductUrlKeyReadPort>(ctx, 'catalogProductUrlKeyReadPort'),
            sitemapOptions,
          ),
      )
      .singleton(),
  });

  /**
   * Feature 163 (R13) — product metadata per sales channel × language, for the
   * product page `catalog` builds. `catalog` declares this edge `degrades-without`
   * and probes `seo`'s presence before resolving it, so with `seo` off the page
   * shows its derived metadata.
   */
  ctx.di.providePort<SeoProductMetaPort>(
    'seoProductMetaPort',
    ctx
      .asFunction(({ seoMetaResolver }: SeoCradle): SeoProductMetaPort => ({
        resolveForProduct: (input) => seoMetaResolver.resolveForProduct(input),
        readScoped: (productId, scope) => seoMetaResolver.readScoped(productId, scope),
        listScopesForProduct: (productId) => seoMetaResolver.listScopesForProduct(productId),
      }))
      .singleton(),
  );

  ctx.di.providePort<SeoMetaWritePort>(
    'seoMetaWritePort',
    ctx
      .asFunction(({ seoMetaResolver }: SeoCradle): SeoMetaWritePort => ({
        async upsertProductMeta(input) {
          await seoMetaResolver.upsertOverride({
            entityType: 'product',
            entityId: input.productId,
            locale: input.locale,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          });
        },
      }))
      .singleton(),
  );

  /**
   * Feature 163 (security review, carry 4) — a sitemap lists what an anonymous
   * crawler may open now, so a change to that answer marks the cached documents
   * stale: the scoped status, the publication window (the catalogue's window
   * sweep emits `publicationWindow` for every bound it crosses), the audience and
   * the URL keys, and the global status, archive and audience (`marksSitemapStale`,
   * S-W1). `ctx.subscribe` gates the handler on this module's presence.
   */
  ctx.subscribe('product.updated.v1', async (payload) => {
    const { changedFields } = payload as { changedFields?: readonly string[] };
    if (!marksSitemapStale(changedFields)) return;
    await ctx.cradle<SeoCradle>().seoSitemapService.markAllStale();
  });
  // S-W1 — an archived product leaves every sitemap (its `product.updated.v1`
  // `['archivedAt']` does too; this one also covers an emitter that announces only it).
  ctx.subscribe('product.archived.v1', async () => {
    await ctx.cradle<SeoCradle>().seoSitemapService.markAllStale();
  });

  ctx.routes(async (app) => {
    const { seoMetaResolver, seoSitemapService, seoCrawlerFilePreview, requireAdmin } =
      ctx.cradle<SeoCradle>();
    await registerSeoRoutes(app, {
      metaResolver: seoMetaResolver,
      sitemap: seoSitemapService,
      crawlerFilePreview: seoCrawlerFilePreview,
      requireAdmin,
      // Resolved per call, like the sitemap's own read of the same port.
      settings: lazyPort<SeoRouteSettingsPort>(ctx, 'settingsReadPort'),
    });
  });

  /**
   * The size limit on the crawler texts (`specs/144-seo-search-engine-robots/`,
   * FR-006) — a **contribution** to the `settings` module's write-validator
   * registry, and nothing else.
   *
   * Deliberately without a presence probe. The registry filters by contributor
   * when a write asks it which validators answer for a code, so a validator
   * registered while `seo` is off is simply not enumerated — and one that was
   * *not* registered because a probe returned early would stay missing after
   * an operator switched `seo` back on, until the next restart: the texts
   * would be editable again with no limit on them.
   *
   * It has no entry in `BOOT_HOOKS_WITHOUT_PRESENCE`, and owes none. That
   * ledger records hooks that do **work** while their module is off and says
   * why each is right to; this one contributes an inert descriptor, awaits
   * nothing and touches no store, so `check:entry-presence` does not count it
   * among the entry points that have to decide presence.
   */
  ctx.onBoot(() => {
    const validators = lazyPort<SettingWriteValidatorRegistryPort>(
      ctx,
      'settingWriteValidatorRegistry',
    );
    validators.register(createCrawlerTextValidator());
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  SeoMetaOverride,
  SitemapCache,
];
