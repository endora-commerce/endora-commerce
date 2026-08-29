import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { StorefrontRevalidator } from '@endora-commerce/platform/http';
import { MetaConfigService } from './services/meta-config.service.js';
import {
  MetaCustomEventMappingsService,
  type MetaAuditContext,
} from './services/custom-event-mappings.service.js';
import { registerMetaAdsAdminRoutes } from './routes.admin.js';
import { registerMetaAdsStorefrontRoutes } from './routes.storefront.js';
import { MetaCustomEventMapping } from './entities/meta-custom-event-mapping.entity.js';

/**
 * `meta_ads` — the module that kept calling the storefront after it was
 * switched off (feature 072, wave 2, T108).
 *
 * The routes were already gated: `plugin.ts` wrapped them in
 * `defineModuleRoutes('meta_ads', …)`. The **subscription** was not. A root
 * passed `onSettingChanged` as a bare `eventBus.on('settings.value_changed', …)`,
 * so the handler stayed live regardless of the module's effective state, and
 * every `meta_ads.*` settings change fired
 *
 *     revalidator.revalidate(['meta:config'])
 *
 * — an outbound HTTP POST to the storefront, asking it to rebuild a cache tag
 * for a module that was serving nothing. Constitution XVII item 2 asks for
 * EventBus subscriptions to go through `subscribeForModule` for exactly this
 * reason, and `ctx.subscribe` is that wrapper, so the conversion closes it by
 * construction rather than by remembering.
 *
 * The same shape is in `linkedin_ads`, `google_analytics` and
 * `google_tag_manager`; the first is converted alongside this one.
 *
 * `auditLog` stops being optional. It is the append-only sink for mapping
 * changes — the record of who altered the pixel's event mapping — and an
 * optional audit sink defaults to *not recording*. Both roots passed one, so
 * nothing was lost; this is the ninth time in this transition that shape has
 * been removed rather than the ninth incident.
 */

interface MetaAdsServices {
  readonly revalidator: StorefrontRevalidator;
  readonly mappings: MetaCustomEventMappingsService;
  readonly configService: MetaConfigService;
  readonly invalidateConfig: () => void;
}

export interface MetaAdsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly settingsReadPort: SettingsReadPort;
  readonly requireAdmin: RequireAdminFactory;
  /** How this composition names the acting admin; `null` for a non-admin caller. */
  readonly adminAuditActorResolver: (request: FastifyRequest) => MetaAuditContext;
  readonly metaAdsServices: MetaAdsServices;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    metaAdsServices: ctx
      .asFunction(
        ({ emFactory, auditLogService }: MetaAdsCradle): MetaAdsServices => {
          const revalidator = new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          });
          const invalidateConfig = (): void => {
            void revalidator.revalidate(['meta:config']);
          };
          const mappings = new MetaCustomEventMappingsService(
            emFactory,
            auditLogService,
            invalidateConfig,
          );
          const configService = new MetaConfigService(
            lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
            (channelId) =>
            mappings.loadForChannel(channelId),
          );
          return { revalidator, mappings, configService, invalidateConfig };
        },
      )
      .singleton(),
  });

  ctx.subscribe('settings.value_changed', (payload) => {
    const settingCode = (payload as { settingCode?: unknown }).settingCode;
    if (typeof settingCode !== 'string' || !settingCode.startsWith('meta_ads.')) return;
    ctx.cradle<MetaAdsCradle>().metaAdsServices.invalidateConfig();
  });

  ctx.routes(async (app) => {
    const { metaAdsServices, requireAdmin, adminAuditActorResolver } =
      ctx.cradle<MetaAdsCradle>();
    metaAdsServices.revalidator.setLogger(app.log);
    await registerMetaAdsStorefrontRoutes(app, { configService: metaAdsServices.configService });
    await registerMetaAdsAdminRoutes(app, {
      mappings: metaAdsServices.mappings,
      requireAdmin,
      resolveAuditContext: adminAuditActorResolver,
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
  MetaCustomEventMapping,
];
