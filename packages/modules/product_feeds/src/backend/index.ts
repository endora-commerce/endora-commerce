import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import { effectiveState } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type {
  AdminNotificationRecordPort,
  AssetReadPort,
  CatalogCategoryReadPort,
  CatalogGalleryPort,
  CatalogProductFilterPort,
  CatalogProductReadPort,
  ConfigurationTypeRegistryPort,
  CustomFieldDefinitionReadPort,
  InventoryAvailabilityPort,
  ObjectStoragePort,
  PriceListReadPort,
} from '@endora-commerce/contracts';
import { productFeedsModule, type ProductFeedsModuleOptions } from './plugin.js';
import { feedDeliveryConfigurationType } from './services/delivery/delivery-credential.type.js';
import { presenceAwareRecorder } from './services/failed-run-notifier.js';
import {
  FEED_CACHE_INVALIDATION_EVENTS,
  invalidateFeedTokenCache,
} from './services/feed-cache-invalidator.js';
import {
  syncFeedScheduleFromEvent,
  syncTaxonomyScheduleFromEvent,
} from './services/feed-schedule-reconciler.js';
import { FeedArtefact } from './entities/feed-artefact.entity.js';
import { FeedDelivery } from './entities/feed-delivery.entity.js';
import { FeedDeliveryAttempt } from './entities/feed-delivery-attempt.entity.js';
import { FeedRun } from './entities/feed-run.entity.js';
import { FeedRunIssue } from './entities/feed-run-issue.entity.js';
import { FeedTaxonomy } from './entities/feed-taxonomy.entity.js';
import { FeedTaxonomyCheck } from './entities/feed-taxonomy-check.entity.js';
import { FeedTaxonomyMapping } from './entities/feed-taxonomy-mapping.entity.js';
import { FeedTaxonomyNode } from './entities/feed-taxonomy-node.entity.js';
import { FeedTemplate } from './entities/feed-template.entity.js';
import { FeedTemplateField } from './entities/feed-template-field.entity.js';
import { ProductFeed } from './entities/product-feed.entity.js';

/**
 * `product_feeds` — three seams only a test composition has (feature 072, wave
 * 3, T137), and, since `specs/110-instance-repository/` T118c, no bridge.
 *
 * The three seams are the taxonomy data root, the taxonomy source fetcher and
 * the delivery adapters. Production contributes none of them and the module
 * uses its shipped taxonomy files and real delivery targets; the harness
 * substitutes all three, because no test may fetch a taxonomy over the network
 * or deliver a feed anywhere. That is the `ksef` shape from wave 2: what a test
 * composition does differently is information about the seam, not boilerplate
 * to normalise away.
 *
 * **`ProductFeedsBridge` is deleted rather than relocated.** It was one
 * contributed name carrying four members — the storage backend an artefact is
 * written to, availability bands across the caller's warehouses, a category
 * expanded to its descendants, and asset ids turned into stable public URLs —
 * and every one of them is a published port this module resolves for itself
 * below. Three of the four cost their owner a publication and each is recorded
 * where it landed:
 *
 *  - **`objectStoragePort`** is the design act. This module writes bytes into
 *    `assets_library`' configured store under its own `product-feeds/` prefix
 *    and creates no `Asset` row (FR-043), so what it borrows is *which bucket
 *    this deployment writes to, with which credentials* — not an asset library.
 *    The owner's in-process `StorageAdapter` could not be published as it
 *    stood: it names `NodeJS.ReadableStream`, its `setVisibility?` is optional
 *    (D-97.3), and its `getForBackend` answers a union whose second arm cannot
 *    stream bytes at all — which is why both consumers of it wrote
 *    `if (!('open' in adapter) || typeof adapter.open !== 'function')` and why
 *    this module's root closure *threw* in that branch.
 *  - **`inventoryAvailabilityPort`** existed and carried no type argument, so
 *    there was no name to import; `inventory` publishes
 *    {@link InventoryAvailabilityPort} now.
 *  - **`catalogCategoryReadPort.expandCategoryProductIds`** is the batched,
 *    cycle-tolerant, live-narrowed subtree walk the criteria compiler needs
 *    (FR-025). It is **not** N calls to `listProductIdsInSubtree`: that one is
 *    structural by contract — it filters neither `isActive` nor `deletedAt` —
 *    and it is a recursive CTE with no cycle guard.
 *  - **`assetReadPort.resolvePublicUrls`** carries FR-043's own rule, and it
 *    moved to the owner because only the owner can apply it: a consumer holding
 *    an asset id cannot tell a stable URL from an expiring signed one, and an
 *    absent entry rather than a `catch` is the degrade expressed in the return
 *    type (composition checklist item 7).
 */

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
  readonly customFieldDefinitionReadPort: NonNullable<ProductFeedsModuleOptions['customFieldDefinitions']>;
  readonly languageService: NonNullable<ProductFeedsModuleOptions['languageService']>;
  /**
   * `admin_notifications`' gated port — wrapped below, never handed on raw.
   * The name is `adminNotificationRecordPort` since D-98.2: the container
   * name a contract publishes, rather than the owner's class registration.
   */
  readonly adminNotificationRecordPort: AdminNotificationRecordPort;
  readonly settingsReadPort: NonNullable<ProductFeedsModuleOptions['settings']>;
  readonly moduleQueueRedis: Redis | undefined;
  /** Root-supplied (Principle X): the harness runs no generation or reaper consumer. */
  readonly productFeedsRunWorkers: boolean;
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
          // The four ports the bridge used to carry. Each is a `lazyPort`
          // proxy, which resolves per property access — so nothing here is a
          // captured gate, and each of the three owners keeps its own answer to
          // being switched off.
          const objectStorage = lazyPort<ObjectStoragePort>(ctx, 'objectStoragePort');
          const availability = lazyPort<InventoryAvailabilityPort>(
            ctx,
            'inventoryAvailabilityPort',
          );
          const categoryReads = lazyPort<CatalogCategoryReadPort>(
            ctx,
            'catalogCategoryReadPort',
          );
          const assetReads = lazyPort<AssetReadPort>(ctx, 'assetReadPort');
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
            // D-98.2 / issue #196 — the read port `custom_fields` publishes.
            // `customFieldDefinitionService` is that module's own CRUD surface,
            // deliberately unpublished; the two calls this module makes are both
            // `listForEntity('product')`, which is what the read port is for.
            customFieldDefinitions: lazyPort<CustomFieldDefinitionReadPort>(
              ctx,
              'customFieldDefinitionReadPort',
            ),
            // Feature 075, Phase C — `languageReadPort`, not `languageService`.
            // The four calls this module makes are all reads, and the read port
            // is the shape `languages` published for exactly them.
            languageService: lazyPort<ProductFeedsCradle['languageService']>(
              ctx,
              'languageReadPort',
            ),
            // Feature 075, Phase C — `catalog`'s two published read models and
            // `price_lists`' list reader, replacing `em.find(Product, …)`,
            // `em.find(Category, …)` and `em.findOne(PriceList, …)` in this
            // module's own services. All three owners are already binding
            // `dependencies` of this manifest, and all three reads fail closed:
            // a feed built from a catalogue the platform is not serving is worse
            // than a run that stops and says so.
            catalogProducts: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            catalogCategories: lazyPort<CatalogCategoryReadPort>(
              ctx,
              'catalogCategoryReadPort',
            ),
            // Feature 075 / D-87 — the images of a hydration batch, over the
            // owner's batch read rather than a `select … from gallery_items`
            // this module wrote itself. Same binding argument as the two above:
            // the images of a catalogue the platform is not serving have no
            // business in a feed, and over the port the read stops with the
            // rest of the run instead of publishing them.
            catalogGallery: lazyPort<CatalogGalleryPort>(ctx, 'galleryService'),
            // The last of the seventeen, and the one Phase P escalated rather
            // than guessed at: the criteria scan. The rule compiles to
            // `CatalogProductFilter` — `catalog`'s published grammar — and the
            // owner runs it, with FR-026's eligibility floor and the keyset
            // cursor on its side of the boundary rather than in a conjunction
            // this module builds.
            catalogProductFilter: lazyPort<CatalogProductFilterPort>(
              ctx,
              'catalogProductFilterPort',
            ),
            priceLists: lazyPort<PriceListReadPort>(ctx, 'priceListReadPort'),
            // D-60 — the bell's absence is decided here, in front of the gate,
            // and reaches the notifiers as `not-present` in the return type.
            // A `catch` at the call site fused "the operator switched
            // notifications off" with "the write failed" into one `false`.
            adminNotificationService: presenceAwareRecorder(
              // D-98.2 / issue #196 — `adminNotificationRecordPort` is the name
              // the contract publishes and the one that answers with a record;
              // `adminNotificationService` is the class registration, whose
              // `record` hands back the `AdminNotification` entity.
              lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort'),
            ),
            settings: lazyPort<ProductFeedsCradle['settingsReadPort']>(ctx, 'settingsReadPort'),
            // T118c — `assets_library`' published object store. The bytes of a
            // feed artefact, under this module's own locator prefix and with no
            // `Asset` row: what is borrowed is the deployment's bucket and
            // credentials, which is the one thing this module cannot know.
            objectStorage,
            // T118c — `inventory`'s port, resolved here rather than handed in.
            // The binding is deliberate and it is what the manifest already
            // says: a feed whose availability column is silently absent is
            // worse than a run that stops and records why.
            resolveAvailability: (productIds, salesChannelId) =>
              availability.resolveAvailabilityBands(productIds, salesChannelId),
            // T118c — `catalog`'s category read model. The batched, live-narrowed,
            // cycle-tolerant walk, and not N calls to `listProductIdsInSubtree`:
            // that one is structural by contract and has no cycle guard.
            expandCategoryProductIds: (categoryIds) =>
              categoryReads.expandCategoryProductIds(categoryIds),
            // T118c — FR-043's rule, asked of the module that can answer it.
            // An asset that is not live, not public, or whose URL could only be
            // produced as an expiring signed link is simply absent from the map;
            // this module cannot tell those apart from an id and a URL string.
            resolvePublicImageUrls: (assetIds) => assetReads.resolvePublicUrls(assetIds),
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
    // `ctx.worker` applies `defineModuleWorker('product_feeds', …)`, which the
    // four `workers/*.ts` factories used to call for themselves — a reach into
    // `kernel/lifecycle/plugin-helpers`, classified **A** by
    // `contracts/host-package.md` §1.4c because a composed module uses this
    // seam and publishing the wrapper would re-open by bare specifier what
    // `check:subscribe-seam` closed by relative path.
    //
    // Attached here rather than at registration for `webhooks`' reason: this is
    // where `app.log` exists, and a `BACKEND_ROLE=worker` process reaches it —
    // `src/worker.ts` builds the server precisely to register module plugins
    // and simply never listens.
    for (const worker of ctx.cradle<ProductFeedsCradle>().productFeeds.workers) {
      ctx.worker(worker, { logger: app.log });
    }
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
    lazyPort<ConfigurationTypeRegistryPort>(ctx, 'configurationTypeRegistry').register(
      feedDeliveryConfigurationType,
    );
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
 *
 * Twelve classes. A test that needs one takes it out of *this* array through
 * `test/helpers/package-entities.ts` rather than by naming the source file:
 * the platform composes the published artefact, so a second spelling is a
 * second copy of the class and the ORM's lookup is by name (D-160.6.1).
 */
export const entities = [
  FeedArtefact,
  FeedDelivery,
  FeedDeliveryAttempt,
  FeedRun,
  FeedRunIssue,
  FeedTaxonomy,
  FeedTaxonomyCheck,
  FeedTaxonomyMapping,
  FeedTaxonomyNode,
  FeedTemplate,
  FeedTemplateField,
  ProductFeed,
];
