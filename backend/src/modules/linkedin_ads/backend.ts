import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsReadPort } from '../../kernel/ports/settings.js';
import { StorefrontRevalidator } from '../../http/storefront-revalidator.js';
import { LinkedInConfigService } from './services/linkedin-config.service.js';
import {
  LinkedInConversionMappingsService,
  type LinkedInAuditContext,
} from './services/conversion-mappings.service.js';
import { registerLinkedInAdsAdminRoutes } from './routes.admin.js';
import { registerLinkedInAdsStorefrontRoutes } from './routes.storefront.js';

/**
 * `linkedin_ads` — converted with `meta_ads`, which it is a near-copy of
 * (feature 072, wave 2, T106).
 *
 * Same off-state leak, same fix: the routes were gated by `defineModuleRoutes`
 * but the `settings.value_changed` subscription arrived from a root as a bare
 * `eventBus.on`, so a switched-off module still answered every
 * `linkedin_ads.*` settings change with an outbound storefront revalidation.
 * `ctx.subscribe` is `subscribeForModule`, so the subscription now stops with
 * the module.
 *
 * `auditLog` stops being optional here too — see the note in `meta_ads`.
 *
 * The two modules are converted in one commit rather than one after the other.
 * They are the same forty lines twice over, both roots build them from adjacent
 * blocks, and splitting them would have meant leaving the shared
 * `adminAuditActorResolver` contribution half-introduced between commits.
 */

interface LinkedInAdsServices {
  readonly revalidator: StorefrontRevalidator;
  readonly mappings: LinkedInConversionMappingsService;
  readonly configService: LinkedInConfigService;
  readonly invalidateConfig: () => void;
}

export interface LinkedInAdsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly settingsReadPort: SettingsReadPort;
  readonly requireAdmin: RequireAdminFactory;
  /** How this composition names the acting admin; `null` for a non-admin caller. */
  readonly adminAuditActorResolver: (request: FastifyRequest) => LinkedInAuditContext;
  readonly linkedInAdsServices: LinkedInAdsServices;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    linkedInAdsServices: ctx
      .asFunction(
        ({
          emFactory,
          auditLogService,
        }: LinkedInAdsCradle): LinkedInAdsServices => {
          const revalidator = new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          });
          const invalidateConfig = (): void => {
            void revalidator.revalidate(['linkedin:config']);
          };
          const mappings = new LinkedInConversionMappingsService(
            emFactory,
            auditLogService,
            invalidateConfig,
          );
          const configService = new LinkedInConfigService(
            lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
            (channelId) =>
            mappings.loadForChannel(channelId),
          );
          return { revalidator, mappings, configService, invalidateConfig };
        },
      )
      .singleton(),
  });

  // Config edits propagate immediately rather than after the cache TTL — while
  // the module is on.
  ctx.subscribe('settings.value_changed', (payload) => {
    const settingCode = (payload as { settingCode?: unknown }).settingCode;
    if (typeof settingCode !== 'string' || !settingCode.startsWith('linkedin_ads.')) return;
    ctx.cradle<LinkedInAdsCradle>().linkedInAdsServices.invalidateConfig();
  });

  ctx.routes(async (app) => {
    const { linkedInAdsServices, requireAdmin, adminAuditActorResolver } =
      ctx.cradle<LinkedInAdsCradle>();
    linkedInAdsServices.revalidator.setLogger(app.log);
    await registerLinkedInAdsStorefrontRoutes(app, {
      configService: linkedInAdsServices.configService,
    });
    await registerLinkedInAdsAdminRoutes(app, {
      mappings: linkedInAdsServices.mappings,
      requireAdmin,
      resolveAuditContext: adminAuditActorResolver,
    });
  });
}
