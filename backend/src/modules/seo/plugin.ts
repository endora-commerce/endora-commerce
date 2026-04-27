import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { MetaTagResolverService } from './services/meta-tag-resolver.service.js';
import { SitemapGeneratorService, type SitemapGeneratorOptions } from './services/sitemap-generator.service.js';
import { registerSeoRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface SeoModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
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
