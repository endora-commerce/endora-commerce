import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModulePlugin } from '../../http/server.js';
import { defineModuleRoutes } from '../_lifecycle/plugin-helpers.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import { LinkedInConfigService } from './services/linkedin-config.service.js';
import {
  LinkedInConversionMappingsService,
  type LinkedInAuditContext,
  type LinkedInAuditSink,
} from './services/conversion-mappings.service.js';
import { StorefrontRevalidator } from '../../http/storefront-revalidator.js';
import { registerLinkedInAdsStorefrontRoutes } from './routes.storefront.js';
import { registerLinkedInAdsAdminRoutes } from './routes.admin.js';

export interface LinkedInAdsModuleOptions {
  emFactory: () => EntityManager;
  settings: SettingsService;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Resolve the admin audit context (actor) from a request. */
  resolveAuditContext: (req: FastifyRequest) => LinkedInAuditContext;
  /** Append-only audit sink for mapping changes. */
  auditLog?: LinkedInAuditSink;
  /** Subscribe to `settings.value_changed` to invalidate the storefront config cache. */
  onSettingChanged?: (handler: (settingCode: string) => void) => void;
  /** Storefront base URL + shared secret for on-demand cache revalidation. */
  storefrontBaseUrl?: string;
  revalidateSecret?: string;
}

/**
 * Composition root for the LinkedIn Ads module (feature 063). Builds the service
 * graph and registers the storefront + admin routes, gated on the module's
 * enabled state via `defineModuleRoutes`.
 *
 * Server-side conversion reporting (US4) is specified but not yet implemented;
 * `linkedin_ads.server_side_enabled` therefore stays off and the storefront
 * reports conversions from the browser. See specs/063-linkedin-ads/tasks.md
 * Phase 5.
 */
export function linkedInAdsModule(options: LinkedInAdsModuleOptions): ModulePlugin {
  const revalidator = new StorefrontRevalidator({
    baseUrl: options.storefrontBaseUrl,
    secret: options.revalidateSecret,
  });
  const invalidateConfig = (): void => {
    void revalidator.revalidate(['linkedin:config']);
  };

  const mappings = new LinkedInConversionMappingsService(
    options.emFactory,
    options.auditLog,
    invalidateConfig,
  );
  const configService = new LinkedInConfigService(options.settings, (channelId) =>
    mappings.loadForChannel(channelId),
  );

  // Config edits propagate immediately rather than after the cache TTL.
  options.onSettingChanged?.((settingCode) => {
    if (settingCode.startsWith('linkedin_ads.')) invalidateConfig();
  });

  return async (app) => {
    revalidator.setLogger(app.log);

    await defineModuleRoutes('linkedin_ads', async (scoped) => {
      await registerLinkedInAdsStorefrontRoutes(scoped, { configService });
      await registerLinkedInAdsAdminRoutes(scoped, {
        mappings,
        requireAdmin: options.requireAdmin,
        resolveAuditContext: options.resolveAuditContext,
      });
    })(app);
  };
}
