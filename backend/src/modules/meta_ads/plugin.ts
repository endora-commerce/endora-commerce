import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModulePlugin } from '../../http/server.js';
import { defineModuleRoutes } from '../_lifecycle/plugin-helpers.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import { MetaConfigService } from './services/meta-config.service.js';
import {
  MetaCustomEventMappingsService,
  type MetaAuditContext,
  type MetaAuditSink,
} from './services/custom-event-mappings.service.js';
import { StorefrontRevalidator } from '../google_analytics/services/storefront-revalidator.js';
import { registerMetaAdsStorefrontRoutes } from './routes.storefront.js';
import { registerMetaAdsAdminRoutes } from './routes.admin.js';

export interface MetaAdsModuleOptions {
  emFactory: () => EntityManager;
  settings: SettingsService;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveAuditContext: (req: FastifyRequest) => MetaAuditContext;
  auditLog?: MetaAuditSink;
  onSettingChanged?: (handler: (settingCode: string) => void) => void;
  storefrontBaseUrl?: string;
  revalidateSecret?: string;
}

/**
 * Composition root for the Meta Ads module (feature 064). Builds the service
 * graph and registers the storefront + admin routes, gated on the module's
 * enabled state via `defineModuleRoutes`.
 */
export function metaAdsModule(options: MetaAdsModuleOptions): ModulePlugin {
  const revalidator = new StorefrontRevalidator({
    baseUrl: options.storefrontBaseUrl,
    secret: options.revalidateSecret,
  });
  const invalidateConfig = (): void => {
    void revalidator.revalidate(['meta:config']);
  };

  const mappings = new MetaCustomEventMappingsService(
    options.emFactory,
    options.auditLog,
    invalidateConfig,
  );
  const configService = new MetaConfigService(options.settings, (channelId) =>
    mappings.loadForChannel(channelId),
  );

  options.onSettingChanged?.((settingCode) => {
    if (settingCode.startsWith('meta_ads.')) invalidateConfig();
  });

  return async (app) => {
    revalidator.setLogger(app.log);

    await defineModuleRoutes('meta_ads', async (scoped) => {
      await registerMetaAdsStorefrontRoutes(scoped, { configService });
      await registerMetaAdsAdminRoutes(scoped, {
        mappings,
        requireAdmin: options.requireAdmin,
        resolveAuditContext: options.resolveAuditContext,
      });
    })(app);
  };
}
