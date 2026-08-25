import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CmsPageReadPort,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { MetaTagResolverService } from './services/meta-tag-resolver.service.js';
import {
  SitemapGeneratorService,
  type SitemapGeneratorOptions,
  type SitemapSettingsPort,
} from './services/sitemap-generator.service.js';
import { registerSeoRoutes } from './routes.js';
import { SeoMetaOverride } from './entities/seo-meta-override.entity.js';
import { SitemapCache } from './entities/sitemap-cache.entity.js';

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
 * `auditLog` stops being optional: SEO overrides are admin writes, and an
 * optional audit sink defaults to not recording.
 */

export interface SeoCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: SitemapSettingsPort;
  /** Composition-specific sitemap tuning; `{}` in production. */
  readonly sitemapOptions: SitemapGeneratorOptions;
  readonly seoMetaResolver: MetaTagResolverService;
  readonly seoSitemapService: SitemapGeneratorService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    sitemapOptions: ctx.asFunction((): SitemapGeneratorOptions => ({})).singleton(),

    seoMetaResolver: ctx
      .asFunction(
        ({ emFactory, auditLogService }: SeoCradle) =>
          new MetaTagResolverService(
            emFactory,
            auditLogService,
            // Feature 075, Phase C. Never captured: the proxies resolve per
            // call, so a switched-off owner answers 503 `MODULE_DISABLED` at
            // the call rather than through a gate frozen at composition time.
            lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            lazyPort<CatalogCategoryReadPort>(ctx, 'catalogCategoryReadPort'),
            lazyPort<CmsPageReadPort>(ctx, 'cmsPageReadPort'),
          ),
      )
      .singleton(),

    seoSitemapService: ctx
      .asFunction(
        ({ emFactory, sitemapOptions }: SeoCradle) =>
          new SitemapGeneratorService(
            emFactory,
            lazyPort<SitemapSettingsPort>(ctx, 'settingsReadPort'),
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            lazyPort<CatalogCategoryReadPort>(ctx, 'catalogCategoryReadPort'),
            lazyPort<CmsPageReadPort>(ctx, 'cmsPageReadPort'),
            sitemapOptions,
          ),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { seoMetaResolver, seoSitemapService, requireAdmin } = ctx.cradle<SeoCradle>();
    await registerSeoRoutes(app, {
      metaResolver: seoMetaResolver,
      sitemap: seoSitemapService,
      requireAdmin,
    });
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
