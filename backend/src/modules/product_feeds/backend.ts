import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { CommandBus } from '../../commands/index.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { ConfigurationTypeRegistry } from '../credentials/services/configuration-type-registry.js';
import { productFeedsModule, type ProductFeedsModuleOptions } from './plugin.js';
import { feedDeliveryConfigurationType } from './services/delivery/delivery-credential.type.js';
import {
  presenceAwareRecorder,
  type AdminNotificationPort,
} from './services/failed-run-notifier.js';
import {
  FEED_CACHE_INVALIDATION_EVENTS,
  invalidateFeedTokenCache,
} from './services/feed-cache-invalidator.js';
import {
  syncFeedScheduleFromEvent,
  syncTaxonomyScheduleFromEvent,
} from './services/feed-schedule-reconciler.js';

/**
 * `product_feeds` — four adapters a root builds, and three seams only a test
 * composition has (feature 072, wave 3, T137).
 *
 * The four are how this module reaches outside itself to assemble a feed row:
 * opening the storage backend an artefact is written to, resolving availability
 * bands across the caller's warehouses, expanding a category to its descendants
 * through the documented catalog port, and turning asset ids into *stable*
 * public URLs. Each crosses a boundary this module must not reach through
 * directly, and each is several lines of root code rather than a service
 * reference, so they are contributed as one {@link ProductFeedsBridge} — always
 * supplied together, by the same caller.
 *
 * The three seams are the taxonomy data root, the taxonomy source fetcher and
 * the delivery adapters. Production contributes none of them and the module
 * uses its shipped taxonomy files and real delivery targets; the harness
 * substitutes all three, because no test may fetch a taxonomy over the network
 * or deliver a feed anywhere. That is the `ksef` shape from wave 2: what a test
 * composition does differently is information about the seam, not boilerplate
 * to normalise away.
 *
 * `resolvePublicImageUrls` deserves its own note. FR-043 says only stable public
 * URLs reach a feed file, so a private asset is *absent* from the map rather
 * than present as an expiring signed URL — one that would survive token rotation
 * and break the moment it expired. That rule lives in the root's adapter because
 * it needs `assets_library`'s resolver; it moves here when that module converts.
 */

/** How this composition assembles the parts of a feed row. */
export interface ProductFeedsBridge {
  readonly storageAdapters: ProductFeedsModuleOptions['storageAdapters'];
  readonly resolveAvailability: ProductFeedsModuleOptions['resolveAvailability'];
  readonly expandCategoryProductIds: ProductFeedsModuleOptions['expandCategoryProductIds'];
  readonly resolvePublicImageUrls: ProductFeedsModuleOptions['resolvePublicImageUrls'];
}

/** What `product_feeds` resolves from the container, and the names it owns. */
export interface ProductFeedsCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly eventBus: EventBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly salesChannelMembershipPort: NonNullable<ProductFeedsModuleOptions['salesChannelMembership']>;
  readonly pricingService: NonNullable<ProductFeedsModuleOptions['pricingService']>;
  readonly taxService: NonNullable<ProductFeedsModuleOptions['taxService']>;
  readonly credentialsService: NonNullable<ProductFeedsModuleOptions['credentials']>;
  readonly customFieldDefinitionService: NonNullable<ProductFeedsModuleOptions['customFieldDefinitions']>;
  readonly languageService: NonNullable<ProductFeedsModuleOptions['languageService']>;
  /** `admin_notifications`' gated port — wrapped below, never handed on raw. */
  readonly adminNotificationService: AdminNotificationPort;
  readonly settingsReadPort: NonNullable<ProductFeedsModuleOptions['settings']>;
  readonly moduleQueueRedis: Redis | undefined;
  /** Root-supplied (Principle X): the harness runs no generation or reaper consumer. */
  readonly productFeedsRunWorkers: boolean;
  readonly productFeedsBridge: ProductFeedsBridge;
  /**
   * Pinned per composition rather than derived, and registered **early** in each
   * root: the boot hook below constructs the module, and these two are read at
   * construction rather than per call.
   *
   * A feed URL exists to be pasted into Merchant Center, so production reads
   * `PUBLIC_API_BASE_URL`; the harness pins `http://feeds.test.local` because a
   * test asserts the exact link an administrator is handed. The key is pinned
   * for a related reason: tests deliberately do not load `backend/.env`, and
   * several suites set and re-read an encrypted token in the same run. Same
   * shape as `newsletter`'s base URLs (T114) — what a test composition pins is
   * information about the seam.
   */
  readonly productFeedsPublicBaseUrl: ProductFeedsModuleOptions['publicBaseUrl'];
  readonly productFeedsTokenEncryptionKey: ProductFeedsModuleOptions['tokenEncryptionKey'];
  /**
   * Contribution point: the taxonomy source and delivery targets a composition
   * substitutes. Production contributes nothing — shipped taxonomy files, real
   * delivery — and the harness substitutes all three.
   */
  readonly productFeedsTestOverrides: Pick<
    ProductFeedsModuleOptions,
    'taxonomyDataRoot' | 'taxonomySourceFetcher' | 'deliveryAdapters'
  >;
  readonly productFeeds: ReturnType<typeof productFeedsModule>;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Production contributes nothing and uses its shipped taxonomy + real targets.
    productFeedsTestOverrides: ctx
      .asFunction((): ProductFeedsCradle['productFeedsTestOverrides'] => ({}))
      .singleton(),

    productFeeds: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          eventBus,
          moduleQueueRedis,
          productFeedsRunWorkers,
          productFeedsPublicBaseUrl,
          productFeedsTokenEncryptionKey,
        }: ProductFeedsCradle) => {
          const bridge = (): ProductFeedsBridge =>
            ctx.cradle<ProductFeedsCradle>().productFeedsBridge;
          return productFeedsModule({
            emFactory,
            commandBus,
            eventBus,
            runWorkers: productFeedsRunWorkers,
            ...(moduleQueueRedis === undefined ? {} : { redis: moduleQueueRedis }),
            publicBaseUrl: productFeedsPublicBaseUrl,
            ...(productFeedsTokenEncryptionKey === undefined
              ? {}
              : { tokenEncryptionKey: productFeedsTokenEncryptionKey }),
            requireAdmin: (permission) => async (req, reply) =>
              ctx.cradle<ProductFeedsCradle>().requireAdmin(permission)(req, reply),
            salesChannelMembership: lazyPort<
              ProductFeedsCradle['salesChannelMembershipPort']
            >(ctx, 'salesChannelMembershipPort'),
            pricingService: lazyPort<ProductFeedsCradle['pricingService']>(
              ctx,
              'pricingService',
            ),
            taxService: lazyPort<ProductFeedsCradle['taxService']>(ctx, 'taxService'),
            credentials: lazyPort<ProductFeedsCradle['credentialsService']>(
              ctx,
              'credentialsService',
            ),
            customFieldDefinitions: lazyPort<
              ProductFeedsCradle['customFieldDefinitionService']
            >(ctx, 'customFieldDefinitionService'),
            languageService: lazyPort<ProductFeedsCradle['languageService']>(
              ctx,
              'languageService',
            ),
            // D-60 — the bell's absence is decided here, in front of the gate,
            // and reaches the notifiers as `not-present` in the return type.
            // A `catch` at the call site fused "the operator switched
            // notifications off" with "the write failed" into one `false`.
            adminNotificationService: presenceAwareRecorder(
              lazyPort<AdminNotificationPort>(ctx, 'adminNotificationService'),
            ),
            settings: lazyPort<ProductFeedsCradle['settingsReadPort']>(ctx, 'settingsReadPort'),
            // Forwarded per call so a root may contribute the bridge at any
            // point in its own ordering.
            storageAdapters: {
              getActive: () => bridge().storageAdapters.getActive(),
              getForBackend: (backend) => bridge().storageAdapters.getForBackend(backend),
            },
            resolveAvailability: (productIds, salesChannelId) =>
              bridge().resolveAvailability(productIds, salesChannelId),
            expandCategoryProductIds: (categoryIds) =>
              bridge().expandCategoryProductIds(categoryIds),
            resolvePublicImageUrls: (assetIds) => bridge().resolvePublicImageUrls(assetIds),
            ...ctx.cradle<ProductFeedsCradle>().productFeedsTestOverrides,
          });
        },
      )
      .singleton(),
  });

  /**
   * The five subscriptions this module owns (issue #107).
   *
   * All five were bare `eventBus.on` calls inside the plugin body. Two of them
   * write: the feed-changed handler re-asserts a BullMQ Job Scheduler and clears
   * the row's `next_run_at`, and the taxonomy handler installs or removes the
   * check scheduler — so a switched-off `product_feeds` went on generating feeds
   * on a timer while every route that serves them refused. `ctx.subscribe` puts
   * the effective state in front of each handler.
   */
  const handle = (): ReturnType<typeof productFeedsModule>['handle'] =>
    ctx.cradle<ProductFeedsCradle>().productFeeds.handle;

  for (const event of FEED_CACHE_INVALIDATION_EVENTS) {
    ctx.subscribe(event, async (payload) => {
      await invalidateFeedTokenCache(handle().tokenCache, payload);
    });
  }

  // Postgres commits first, Redis is touched after (research §R5.4): the event
  // is emitted by the Command Bus on commit, so the row is durable before the
  // scheduler is touched and a Redis failure can never roll back a saved feed.
  ctx.subscribe('product_feeds.feed_changed', async (payload) => {
    await syncFeedScheduleFromEvent(handle().schedules, payload);
  });

  // The taxonomy master switch takes effect at the moment it is flipped. The
  // reconcile re-reads the two settings, and the settings write seam has already
  // dropped them: it invalidates the cache and awaits the drop before it emits
  // (issue #45), so this no longer depends on registration order.
  ctx.subscribe('settings.value_changed', async (payload) => {
    await syncTaxonomyScheduleFromEvent(handle().schedules, payload);
  });

  ctx.routes(async (app) => {
    await ctx.cradle<ProductFeedsCradle>().productFeeds.plugin(app);
  });

  // Three boot reconciles, all log-and-continue: an unbootable API is worse
  // than any of the drifts they repair, and the next boot repairs it anyway.
  //
  //  - FR-007 / FR-008: install any missing predefined template. Non-destructive
  //    — an existing `system_code` is left alone.
  //  - FR-077 / FR-078 / FR-086: install any bundled taxonomy revision the
  //    database lacks and re-evaluate mappings for staleness. **Reads files
  //    only and opens no socket**; a bundled revision becomes the one in force
  //    only when the provider has none, so a platform upgrade never activates a
  //    revision an operator did not choose.
  //  - FR-031: re-assert every per-feed Job Scheduler, so a flushed Redis, an
  //    old snapshot or a crash between the Postgres commit and the Redis call
  //    costs at most one missed tick rather than a feed that silently stops
  //    regenerating. Worker role only — an API-only process must not own
  //    schedules.
  ctx.onBoot(async () => {
    // Presence is decided here — first, and outside every `try` below (issue
    // #147, D-62). A boot hook has no caller to answer: `runBootHooks` wraps it
    // in a `catch` that re-throws as `ModuleCompositionError`, so a
    // `ModuleDisabledError` raised from inside would either be swallowed by the
    // `reconcile` helper — whose tolerance exists for a transient API failure —
    // or take the boot out. Asked here it is neither, and one question covers
    // all three reconciles: with the module off, none of them should run.
    //
    // FR-031's schedule reconcile is the one that made this urgent. It
    // re-asserts every per-feed BullMQ Job Scheduler, so a switched-off module
    // was writing scheduler keys into Redis on every deploy — "behaves as if
    // never installed" failing on a seam no ratchet watched: a Job Scheduler is
    // not a `setInterval`, and the timer check did not read boot hooks. It does
    // now — `check:entry-presence`, D-68 — so removing this probe fails the
    // build rather than waiting for the next deploy to notice.
    if (!effectiveState.isPresent('product_feeds')) return;
    const runWorkers = ctx.cradle<ProductFeedsCradle>().productFeedsRunWorkers;
    const handle = ctx.cradle<ProductFeedsCradle>().productFeeds.handle;
    const reconcile = async (what: string, run: () => Promise<unknown>): Promise<void> => {
      try {
        await run();
      } catch (err: unknown) {
        // eslint-disable-next-line no-console -- boot path; no app logger yet.
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: `product_feeds ${what} reconcile failed`,
            error: String(err),
          }),
        );
      }
    };
    await reconcile('predefined-template', () => handle.reconcileTemplates());
    await reconcile('taxonomy', () => handle.reconcileTaxonomies());
    if (runWorkers) await reconcile('schedule', () => handle.reconcileSchedules());
  });

  /**
   * FR-041 — the delivery target's credential type (T143a).
   *
   * Both roots used to push this descriptor into `credentials`' registry, so a
   * configuration type belonging to a module the operator had switched off was
   * still offered by `GET /credentials/types` and still writable. It is
   * declared by the module that owns it now.
   *
   * A second hook rather than a line in the one above, because the two have
   * nothing to do with each other: that one is the worker-role reconcile and
   * returns early on an API process, this one has to run in every process that
   * serves the credentials admin surface.
   *
   * It deliberately does **not** carry the presence probe the reconcile hook
   * above does (D-62). This pushes an inert descriptor into an ungated registry
   * the host filters by owner presence — the third of the four sanctioned
   * answers in the deactivation-consequence ledger — so an absent contributor
   * costs `credentials` nothing. Probing it would mean a module an operator
   * switches back on at runtime contributes nothing until the next restart.
   */
  ctx.onBoot(() => {
    lazyPort<ConfigurationTypeRegistry>(ctx, 'configurationTypeRegistry').register(
      feedDeliveryConfigurationType,
    );
  });
}
