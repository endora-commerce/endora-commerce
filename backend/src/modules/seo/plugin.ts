import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { MetaTagResolverService } from './services/meta-tag-resolver.service.js';
import {
  SitemapGeneratorService,
  type SitemapGeneratorOptions,
  type SitemapSettingsPort,
} from './services/sitemap-generator.service.js';
import { registerSeoRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface SeoModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /**
   * Port into the SettingsService so the sitemap generator can read the
   * per-channel `sales_channels.storefront_url` setting. Optional — when
   * absent the generator falls back to env / hard-coded base URL.
   */
  settings?: SitemapSettingsPort;
  sitemap?: SitemapGeneratorOptions;
}

export interface SeoModuleHandle {
  metaResolver: MetaTagResolverService;
  sitemap: SitemapGeneratorService;
}

export function seoModule(options: SeoModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: SeoModuleHandle;
} {
  const metaResolver = new MetaTagResolverService(options.emFactory);
  const sitemap = new SitemapGeneratorService(
    options.emFactory,
    options.settings ?? null,
    options.sitemap ?? {},
  );
  return {
    handle: { metaResolver, sitemap },
    plugin: async (app: FastifyInstance) => {
      await registerSeoRoutes(app, {
        metaResolver,
        sitemap,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
