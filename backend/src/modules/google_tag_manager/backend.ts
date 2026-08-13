import type Redis from 'ioredis';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { StorefrontRevalidator } from '../../http/storefront-revalidator.js';
import { GtmConfigService } from './services/gtm-config.service.js';
import { createGtmRelayQueue, createGtmRelayWorker } from './services/ss-relay-queue.js';
import { makeEnqueuer, makeProcessor } from './services/ss-relay.service.js';
import { SgtmClient } from './services/sgtm-client.js';
import { registerGoogleTagManagerStorefrontRoutes } from './routes.storefront.js';

/**
 * `google_tag_manager` — the third of the four ad modules whose subscription
 * outlived its gate (feature 072, wave 2, T103).
 *
 * Same shape as `meta_ads` and `linkedin_ads`: routes wrapped in
 * `defineModuleRoutes`, but `onSettingChanged` arriving from a root as a bare
 * `eventBus.on('settings.value_changed', …)`, so a switched-off module still
 * answered every `google_tag_manager.*` change with an outbound storefront
 * revalidation. `ctx.subscribe` is `subscribeForModule`, so it stops with the
 * module now.
 *
 * **`moduleQueueRedis` is a separate name from `redis`, on purpose.** This
 * module builds a BullMQ producer queue when it has a Redis connection, and the
 * harness deliberately gives it none — `test-server.ts` says why: "a BullMQ
 * queue built per `setupBackendServer()` is never closed, and this harness is
 * constructed once per test file inside a single fork", so `/collect` degrades
 * to 503 there and is contract-tested against its own bare instance instead.
 * `redis` *is* registered in the harness container, so resolving that would
 * have silently handed this module a connection the harness spent a comment
 * explaining it must not have. A distinct name lets a composition say "no queue
 * here" instead of leaving it to a missing option.
 *
 * The worker is registered through `ctx.worker`, which is `defineModuleWorker`
 * — so the consumer stops with the module too, not only the producer.
 */

interface GtmServices {
  readonly revalidator: StorefrontRevalidator;
  readonly configService: GtmConfigService;
  readonly invalidateConfig: () => void;
  readonly enqueueRelay: ReturnType<typeof makeEnqueuer> | undefined;
}

export interface GoogleTagManagerCradle {
  readonly settingsReadPort: SettingsService;
  /**
   * The connection this module may build its relay queue on. Absent in a
   * composition that does not want a queue — which is the harness, and any
   * deployment running without Redis.
   */
  readonly moduleQueueRedis: Redis | undefined;
  readonly googleTagManagerServices: GtmServices;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    googleTagManagerServices: ctx
      .asFunction(
        ({ moduleQueueRedis }: GoogleTagManagerCradle): GtmServices => {
          const revalidator = new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          });
          const invalidateConfig = (): void => {
            void revalidator.revalidate(['gtm:config']);
          };
          const configService = new GtmConfigService(lazyPort<SettingsService>(ctx, 'settingsReadPort'));
          // Producer side: the API needs it to enqueue whether or not this
          // process also runs the consumer.
          const relayQueue = moduleQueueRedis
            ? createGtmRelayQueue(moduleQueueRedis)
            : undefined;
          return {
            revalidator,
            configService,
            invalidateConfig,
            enqueueRelay: relayQueue ? makeEnqueuer(relayQueue) : undefined,
          };
        },
      )
      .singleton(),
  });

  // An operator's edit propagates immediately rather than after the 300 s TTL
  // (FR-009) — while the module is on.
  ctx.subscribe('settings.value_changed', (payload) => {
    const settingCode = (payload as { settingCode?: unknown }).settingCode;
    if (typeof settingCode !== 'string' || !settingCode.startsWith('google_tag_manager.')) return;
    ctx.cradle<GoogleTagManagerCradle>().googleTagManagerServices.invalidateConfig();
  });

  ctx.routes(async (app) => {
    const { googleTagManagerServices, settingsReadPort, moduleQueueRedis } =
      ctx.cradle<GoogleTagManagerCradle>();
    googleTagManagerServices.revalidator.setLogger(app.log);

    // Queue consumer (Principle X): a separable worker entrypoint, gated on
    // role. `ctx.worker` wraps it in `defineModuleWorker`.
    if (process.env['BACKEND_ROLE'] !== 'api' && moduleQueueRedis) {
      ctx.worker(
        createGtmRelayWorker(
          moduleQueueRedis,
          makeProcessor({ settings: settingsReadPort, client: new SgtmClient() }),
        ),
        { logger: app.log },
      );
    }

    await registerGoogleTagManagerStorefrontRoutes(app, {
      configService: googleTagManagerServices.configService,
      ...(googleTagManagerServices.enqueueRelay
        ? { enqueueRelay: googleTagManagerServices.enqueueRelay }
        : {}),
    });
  });
}
