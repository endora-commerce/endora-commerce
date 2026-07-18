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
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';

export interface SeoModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Feature 054 — audits SEO override writes co-transactionally when provided. */
  auditLog?: AuditLogService;
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
  const metaResolver = new MetaTagResolverService(options.emFactory, options.auditLog);
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
