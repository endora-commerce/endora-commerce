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
}

/**
 * Composition root for the Google Analytics module (feature 049). Builds the
 * service graph, the (optional) BullMQ server-side delivery queue + worker, and
 * registers the storefront + admin routes, all gated on the module's enabled
 * state via `defineModuleRoutes`.
 */
export function googleAnalyticsModule(options: GoogleAnalyticsModuleOptions): ModulePlugin {
  const customEvents = new GaCustomEventsService(
    options.emFactory,
    options.channels,
    options.auditLog,
  );
  const configService = new GaConfigService(options.settings, (channelId) =>
    customEvents.loadForChannel(channelId),
  );

  // Producer-side queue (needed by the API to enqueue regardless of worker role).
  const deliveryQueue = options.redis ? createGaDeliveryQueue(options.redis) : undefined;
  const enqueueCollect = deliveryQueue ? makeEnqueuer(deliveryQueue) : undefined;

  return async (app) => {
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
