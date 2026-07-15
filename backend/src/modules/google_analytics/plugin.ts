import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModulePlugin } from '../../http/server.js';
import { defineModuleRoutes } from '../_lifecycle/plugin-helpers.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import { GaConfigService } from './services/ga-config.service.js';
import { registerGoogleAnalyticsStorefrontRoutes } from './routes.storefront.js';

export interface GoogleAnalyticsModuleOptions {
  emFactory: () => EntityManager;
  settings: SettingsService;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Redis connection — when present, server-side delivery is queue-backed (Principle X). */
  redis?: Redis;
  /** Whether this process runs queue consumers (BACKEND_ROLE != api). */
  runWorkers?: boolean;
}

/**
 * Composition root for the Google Analytics module (feature 049). Builds the
 * service graph and registers the storefront (+ admin, US3) routes, all gated
 * on the module's enabled state via `defineModuleRoutes`.
 */
export function googleAnalyticsModule(options: GoogleAnalyticsModuleOptions): ModulePlugin {
  const configService = new GaConfigService(options.settings);

  return async (app) => {
    await defineModuleRoutes('google_analytics', async (scoped) => {
      await registerGoogleAnalyticsStorefrontRoutes(scoped, {
        configService,
      });
    })(app);
  };
}
