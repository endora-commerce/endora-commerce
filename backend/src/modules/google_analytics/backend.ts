import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { StorefrontRevalidator } from '../../http/storefront-revalidator.js';
import { GaCustomEvent } from './entities/ga-custom-event.entity.js';
import { GaConfigService } from './services/ga-config.service.js';
import {
  GaCustomEventsService,
  type GaChannelPort,
  type GaAuditContext,
} from './services/custom-events.service.js';
import {
  createGaDeliveryQueue,
  createGaDeliveryWorker,
} from './services/ss-delivery-queue.js';
import { makeEnqueuer, makeProcessor } from './services/ss-delivery.service.js';
import { Ga4MpClient } from './services/ga4-mp-client.js';
import { ensureCookieConsentBlock } from './services/cookie-consent-block-seeder.js';
import { registerGoogleAnalyticsAdminRoutes } from './routes.admin.js';
import { registerGoogleAnalyticsStorefrontRoutes } from './routes.storefront.js';

/**
 * `google_analytics` — the last of the four ad modules, and the only one with
 * something to say about *where* a seed belongs (feature 072, wave 2, T102).
 *
 * The off-state leak is the same one `meta_ads`, `linkedin_ads` and
 * `google_tag_manager` carried: routes gated by `defineModuleRoutes`, but the
 * `settings.value_changed` subscription arriving from a root as a bare
 * `eventBus.on`, so a switched-off module kept POSTing to the storefront.
 * `ctx.subscribe` is `subscribeForModule`; the worker moves to `ctx.worker`,
 * which is `defineModuleWorker`. That closes the fourth and last of them.
 *
 * **The CMS block seed stays in `ctx.routes`, not `ctx.onBoot`.** It is the one
 * decision here that is not mechanical. `ensureCookieConsentBlock` writes a
 * predefined CMS block, so it needs `cms`' tables to exist and it needs sales
 * channels — and it is deliberately wrapped in a `try/catch` that downgrades
 * failure to a warning, because a platform composed without the CMS module must
 * still boot. `ctx.onBoot` would run it earlier, which buys nothing it needs and
 * costs the ordering guarantee it currently has for free by running at plugin
 * attach. `_i18n` taught this lesson the expensive way in wave 1: a seed moved
 * to `onBoot` that silently found nothing.
 *
 * `channels` is `salesChannelCodeIdPort` — the code⇄id lookup, which belongs to
 * `sales_channels` and is registered by a root until that module converts
 * (T110). `auditLog` stops being optional, as in the other three.
 */

export const entities = [GaCustomEvent];

interface GaServices {
  readonly revalidator: StorefrontRevalidator;
  readonly customEvents: GaCustomEventsService;
  readonly configService: GaConfigService;
  readonly invalidateConfig: () => void;
  readonly enqueueCollect: ReturnType<typeof makeEnqueuer> | undefined;
}

export interface GoogleAnalyticsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly settingsReadPort: SettingsService;
  readonly requireAdmin: RequireAdminFactory;
  /** Owned by `sales_channels`; a root registers it until that module converts. */
  readonly salesChannelCodeIdPort: GaChannelPort;
  /** How this composition names the acting admin; `null` for a non-admin caller. */
  readonly adminAuditActorResolver: (request: FastifyRequest) => GaAuditContext;
  /** Absent in a composition that wants no BullMQ queue — see `google_tag_manager`. */
  readonly moduleQueueRedis: Redis | undefined;
  readonly googleAnalyticsServices: GaServices;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    googleAnalyticsServices: ctx
      .asFunction(
        ({
          emFactory,
          auditLogService,
          settingsReadPort,
          salesChannelCodeIdPort,
          moduleQueueRedis,
        }: GoogleAnalyticsCradle): GaServices => {
          const revalidator = new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          });
          const invalidateConfig = (): void => {
            void revalidator.revalidate(['ga:config']);
          };
          const customEvents = new GaCustomEventsService(
            emFactory,
            salesChannelCodeIdPort,
            auditLogService,
            invalidateConfig,
          );
          const configService = new GaConfigService(settingsReadPort, (channelId) =>
            customEvents.loadForChannel(channelId),
          );
          // Producer side: the API enqueues whether or not this process also
          // runs the consumer.
          const deliveryQueue = moduleQueueRedis
            ? createGaDeliveryQueue(moduleQueueRedis)
            : undefined;
          return {
            revalidator,
            customEvents,
            configService,
            invalidateConfig,
            enqueueCollect: deliveryQueue ? makeEnqueuer(deliveryQueue) : undefined,
          };
        },
      )
      .singleton(),
  });

  // Admin config edits propagate immediately rather than after the TTL — while
  // the module is on.
  ctx.subscribe('settings.value_changed', (payload) => {
    const settingCode = (payload as { settingCode?: unknown }).settingCode;
    if (typeof settingCode !== 'string' || !settingCode.startsWith('google_analytics.')) return;
    ctx.cradle<GoogleAnalyticsCradle>().googleAnalyticsServices.invalidateConfig();
  });

  ctx.routes(async (app) => {
    const {
      googleAnalyticsServices,
      emFactory,
      settingsReadPort,
      requireAdmin,
      adminAuditActorResolver,
      moduleQueueRedis,
    } = ctx.cradle<GoogleAnalyticsCradle>();
    googleAnalyticsServices.revalidator.setLogger(app.log);

    // Seed the predefined cookie-consent CMS block (idempotent; runs once
    // channels exist). Guarded so a platform without the CMS module skips it
    // rather than failing to boot.
    try {
      await ensureCookieConsentBlock(emFactory);
    } catch (err) {
      app.log.warn({ err }, '[google_analytics] cookie-consent CMS block seed skipped');
    }

    // Queue consumer (Principle X): a separable worker entrypoint, gated on
    // role. `ctx.worker` wraps it in `defineModuleWorker`.
    if (process.env['BACKEND_ROLE'] !== 'api' && moduleQueueRedis) {
      ctx.worker(
        createGaDeliveryWorker(
          moduleQueueRedis,
          makeProcessor({ settings: settingsReadPort, client: new Ga4MpClient() }),
        ),
        { logger: app.log },
      );
    }

    await registerGoogleAnalyticsStorefrontRoutes(app, {
      configService: googleAnalyticsServices.configService,
      ...(googleAnalyticsServices.enqueueCollect
        ? { enqueueCollect: googleAnalyticsServices.enqueueCollect }
        : {}),
    });
    await registerGoogleAnalyticsAdminRoutes(app, {
      customEvents: googleAnalyticsServices.customEvents,
      requireAdmin,
      resolveAuditContext: adminAuditActorResolver,
    });
  });
}
