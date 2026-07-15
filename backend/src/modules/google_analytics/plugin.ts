import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModulePlugin } from '../../http/server.js';
import { defineModuleRoutes, defineModuleWorker } from '../_lifecycle/plugin-helpers.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import { GaConfigService } from './services/ga-config.service.js';
import {
  GaCustomEventsService,
  type GaChannelPort,
  type GaAuditContext,
  type GaAuditSink,
} from './services/custom-events.service.js';
import {
  createGaDeliveryQueue,
  createGaDeliveryWorker,
} from './services/ss-delivery-queue.js';
import { makeEnqueuer, makeProcessor } from './services/ss-delivery.service.js';
import { Ga4MpClient } from './services/ga4-mp-client.js';
import { ensureCookieConsentBlock } from './services/cookie-consent-block-seeder.js';
import { StorefrontRevalidator } from './services/storefront-revalidator.js';
import { registerGoogleAnalyticsStorefrontRoutes } from './routes.storefront.js';
import { registerGoogleAnalyticsAdminRoutes } from './routes.admin.js';

export interface GoogleAnalyticsModuleOptions {
  emFactory: () => EntityManager;
  settings: SettingsService;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Sales-channel code ⇄ id port (isolation — Principle I). */
  channels: GaChannelPort;
  /** Resolve the admin audit context (actor) from a request. */
  resolveAuditContext: (req: FastifyRequest) => GaAuditContext;
  /** Append-only audit sink for custom-event changes. */
  auditLog?: GaAuditSink;
  /** Redis connection — when present, server-side delivery is queue-backed (Principle X). */
  redis?: Redis;
  /** Whether this process runs queue consumers (BACKEND_ROLE != api). */
  runWorkers?: boolean;
  /** Subscribe to `settings.value_changed` to invalidate the storefront config cache. */
  onSettingChanged?: (handler: (settingCode: string) => void) => void;
  /** Storefront base URL + shared secret for on-demand cache revalidation. */
  storefrontBaseUrl?: string;
  revalidateSecret?: string;
}

/**
 * Composition root for the Google Analytics module (feature 049). Builds the
 * service graph, the (optional) BullMQ server-side delivery queue + worker, and
 * registers the storefront + admin routes, all gated on the module's enabled
 * state via `defineModuleRoutes`.
 */
export function googleAnalyticsModule(options: GoogleAnalyticsModuleOptions): ModulePlugin {
  const revalidator = new StorefrontRevalidator({
    baseUrl: options.storefrontBaseUrl,
    secret: options.revalidateSecret,
  });
  const invalidateConfig = (): void => {
    void revalidator.revalidate(['ga:config']);
  };

  const customEvents = new GaCustomEventsService(
    options.emFactory,
    options.channels,
    options.auditLog,
    invalidateConfig,
  );
  const configService = new GaConfigService(options.settings, (channelId) =>
    customEvents.loadForChannel(channelId),
  );

  // Producer-side queue (needed by the API to enqueue regardless of worker role).
  const deliveryQueue = options.redis ? createGaDeliveryQueue(options.redis) : undefined;
  const enqueueCollect = deliveryQueue ? makeEnqueuer(deliveryQueue) : undefined;

  // Invalidate the storefront config cache when any google_analytics.* setting
  // changes, so admin config edits propagate immediately (not after the TTL).
  options.onSettingChanged?.((settingCode) => {
    if (settingCode.startsWith('google_analytics.')) invalidateConfig();
  });

  return async (app) => {
    revalidator.setLogger(app.log);

    // Seed the predefined cookie-consent CMS block (idempotent; runs after
    // channels exist). Guarded so a platform without the CMS module skips it.
    try {
      await ensureCookieConsentBlock(options.emFactory);
    } catch (err) {
      app.log.warn({ err }, '[google_analytics] cookie-consent CMS block seed skipped');
    }

    // Queue consumer (Principle X): separable worker entrypoint, gated on role.
    if (options.runWorkers && options.redis && deliveryQueue) {
      const processor = makeProcessor({
        settings: options.settings,
        client: new Ga4MpClient(),
      });
      defineModuleWorker(
        'google_analytics',
        createGaDeliveryWorker(options.redis, processor),
        { logger: app.log },
      );
    }

    await defineModuleRoutes('google_analytics', async (scoped) => {
      await registerGoogleAnalyticsStorefrontRoutes(scoped, {
        configService,
        ...(enqueueCollect ? { enqueueCollect } : {}),
      });
      await registerGoogleAnalyticsAdminRoutes(scoped, {
        customEvents,
        requireAdmin: options.requireAdmin,
        resolveAuditContext: options.resolveAuditContext,
      });
    })(app);
  };
}
