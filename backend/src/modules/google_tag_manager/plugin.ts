import type Redis from 'ioredis';
import type { ModulePlugin } from '../../http/server.js';
import { StorefrontRevalidator } from '../../http/storefront-revalidator.js';
import { defineModuleRoutes, defineModuleWorker } from '../_lifecycle/plugin-helpers.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { GtmConfigService } from './services/gtm-config.service.js';
import { createGtmRelayQueue, createGtmRelayWorker } from './services/ss-relay-queue.js';
import { makeEnqueuer, makeProcessor } from './services/ss-relay.service.js';
import { SgtmClient } from './services/sgtm-client.js';
import { registerGoogleTagManagerStorefrontRoutes } from './routes.storefront.js';

export interface GoogleTagManagerModuleOptions {
  settings: SettingsService;
  /** Subscribe to `settings.value_changed` to invalidate the storefront config cache. */
  onSettingChanged?: (handler: (settingCode: string) => void) => void;
  /** Storefront base URL + shared secret for on-demand cache revalidation. */
  storefrontBaseUrl?: string;
  revalidateSecret?: string;
  /** Redis connection — when present, the server-side relay is queue-backed (Principle X). */
  redis?: Redis;
  /** Whether this process runs queue consumers (BACKEND_ROLE != api). */
  runWorkers?: boolean;
}

/**
 * Composition root for the Google Tag Manager module (feature 066).
 *
 * The module owns no entity and no admin surface, so there is no
 * `EntityManager`, no `requireAdmin` and no audit sink here: its only
 * persistent state is Settings values, written and audited by the Settings
 * module (research §§R2, R3, R12).
 */
export function googleTagManagerModule(
  options: GoogleTagManagerModuleOptions,
): ModulePlugin {
  const revalidator = new StorefrontRevalidator({
    baseUrl: options.storefrontBaseUrl,
    secret: options.revalidateSecret,
  });
  const invalidateConfig = (): void => {
    void revalidator.revalidate(['gtm:config']);
  };

  const configService = new GtmConfigService(options.settings);

  // Producer-side queue: the API needs it to enqueue regardless of whether this
  // process also runs the consumer.
  const relayQueue = options.redis ? createGtmRelayQueue(options.redis) : undefined;
  const enqueueRelay = relayQueue ? makeEnqueuer(relayQueue) : undefined;

  // Invalidate the storefront config cache when any google_tag_manager.*
  // setting changes, so an operator's edit propagates immediately rather than
  // after the 300 s TTL (FR-009).
  options.onSettingChanged?.((settingCode) => {
    if (settingCode.startsWith('google_tag_manager.')) invalidateConfig();
  });

  return async (app) => {
    revalidator.setLogger(app.log);

    // Queue consumer (Principle X): separable worker entrypoint, gated on role.
    if (options.runWorkers && options.redis && relayQueue) {
      const processor = makeProcessor({
        settings: options.settings,
        client: new SgtmClient(),
      });
      defineModuleWorker(
        'google_tag_manager',
        createGtmRelayWorker(options.redis, processor),
        { logger: app.log },
      );
    }

    await defineModuleRoutes('google_tag_manager', async (scoped) => {
      await registerGoogleTagManagerStorefrontRoutes(scoped, {
        configService,
        ...(enqueueRelay ? { enqueueRelay } : {}),
      });
    })(app);
  };
}
