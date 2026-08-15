import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import { z } from 'zod';
import { FEED_DELIVERY_LIMITS, PRODUCT_FEED_SETTING_CODES } from '@b2b/contracts';
import type { CommandBus } from '../../commands/index.js';
import type { ModulePlugin } from '../../http/server.js';
import type { AdminNotificationService } from '../admin_notifications/services/admin-notification-service.js';
import type { CustomFieldDefinitionService } from '../custom_fields/services/custom-field-definition.service.js';
import { Product } from '../catalog/entities/product.entity.js';
import { SalesChannel } from '../../kernel/sales-channels/sales-channel.entity.js';
import type { LanguageService } from '../languages/services/language-service.js';
import type { PricingServiceContract } from '../price_lists/services/pricing-service.interface.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import type { TaxService } from '../taxes/services/tax-service.js';
import {
  ArtefactStore,
  type ArtefactStorageAdapterProvider,
  type ArtefactStorePort,
} from './services/artefact-store.js';
import {
  attachFeedCacheInvalidator,
  NoopFeedTokenCache,
  RedisFeedTokenCache,
  type FeedTokenCache,
} from './services/feed-cache-invalidator.js';
import {
  FeedGenerationService,
  type AnonymousPriceResolver,
  type NamedListPriceResolver,
  type PublicImageUrlResolver,
} from './services/feed-generation.service.js';
import { FeedRunService } from './services/feed-run.service.js';
import { ItemFieldResolver } from './services/item-field-resolver.js';
import type { ItemFieldResolverPort } from './services/item-field-resolver.interface.js';
import { FeedTemplateService } from './services/feed-template.service.js';
import { FeedTemplateIoService } from './services/feed-template-io.service.js';
import type { ProductFieldDefinition } from './services/field-source-catalogue.js';
import { ProductFeedService } from './services/product-feed.service.js';
import { TemplatePreviewService } from './services/template-preview.service.js';
import {
  ProductSelectionService,
  type CatalogSelectionPort,
  type SelectionPricePort,
} from './services/product-selection.service.js';
import {
  createFeedGenerationQueue,
  createFeedReaperQueue,
  type createFeedGenerationWorker,
  type createFeedReaperWorker,
} from './services/queues/feed-generation-queue.js';
import {
  BullFeedScheduler,
  NoopFeedScheduler,
  type FeedScheduler,
  type ReconcileResult,
} from './services/queues/feed-scheduler.js';
import {
  DEFAULT_STALE_CLAIM_TIMEOUT_MINUTES,
  FeedRunReaperService,
} from './services/feed-run-reaper.service.js';
import {
  ArtefactRetentionService,
  DEFAULT_ARTEFACT_RETENTION_COUNT,
} from './services/artefact-retention.service.js';
import { FailedRunNotifier } from './services/failed-run-notifier.js';
import {
  attachFeedScheduleSync,
  attachTaxonomyScheduleSync,
  FeedScheduleReconciler,
  type TaxonomyRefreshSchedulePort,
} from './services/feed-schedule-reconciler.js';
import { registerFeedGenerationWorker } from './workers/feed-generation-worker.js';
import {
  ensureReaperSchedule,
  registerFeedRunReaperWorker,
} from './workers/feed-run-reaper-worker.js';
import { reconcilePredefinedTemplates } from './seeds/predefined-templates.js';
import {
  registerProductFeedsAdminRoutes,
} from './routes.admin.js';
import { registerProductFeedsDeliveryRoutes } from './routes.delivery.js';
import type { CredentialsService } from '../credentials/services/credentials.service.js';
import { DeliveryConfigService } from './services/delivery/delivery-config.service.js';
import { DeliveryService } from './services/delivery/delivery.service.js';
import type { FeedDeliveryAdapter } from './services/delivery/delivery-adapter.interface.js';
import { HttpDeliveryAdapter } from './services/delivery/adapters/http-delivery-adapter.js';
import { SftpDeliveryAdapter } from './services/delivery/adapters/sftp-delivery-adapter.js';
import { FtpDeliveryAdapter } from './services/delivery/adapters/ftp-delivery-adapter.js';
import { createFeedDeliveryQueue } from './services/queues/feed-delivery-queue.js';
import { registerFeedDeliveryWorker } from './workers/feed-delivery-worker.js';
import { registerProductFeedsPublicRoutes } from './routes.public.js';
import { registerProductFeedsTemplateRoutes } from './routes.templates.js';
import { registerProductFeedsTaxonomyRoutes } from './routes.taxonomies.js';
import { TaxonomyMappingService } from './services/taxonomy-mapping.service.js';
import { TaxonomyReconcilerService } from './services/taxonomy-reconciler.service.js';
import { TaxonomyRefreshService } from './services/taxonomy-refresh.service.js';
import { TaxonomyRevisionService } from './services/taxonomy-revision.service.js';
import { TaxonomyRevisionRetentionService } from './services/taxonomy-revision-retention.service.js';
import { TaxonomySourceFetcher } from './services/taxonomy-source-fetcher.js';
import type { TaxonomySourceFetcherPort } from './services/taxonomy-source-fetcher.interface.js';
import { createTaxonomyRefreshQueue } from './services/queues/taxonomy-refresh-queue.js';
import {
  ensureTaxonomyRefreshSchedule,
  registerTaxonomyRefreshWorker,
  removeTaxonomyRefreshSchedule,
} from './workers/taxonomy-refresh-worker.js';
import {
  DEFAULT_TAXONOMY_FETCH_CRON,
  DEFAULT_TAXONOMY_SOURCE_URLS,
} from './manifest.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Composition root for the Product Feed module — feature 067.
 *
 * Every cross-module collaborator arrives as an **injected option** wired in
 * `composition.ts` (Principle I): the module never reaches into another
 * module's internals, and deleting it leaves no dangling reference. Where the
 * collaborator publishes a formal contract (`pricing-service.interface.ts`) the
 * option is typed by that contract, so an overlay can replace it with `tsc` as
 * the gate (Principle XV); where it does not, the option is typed by the
 * service's own public class, which is the pattern `catalog/plugin.ts` already
 * uses for exactly these collaborators.
 *
 * Lifecycle gating is applied once, by `backend.ts` mounting this plugin
 * through `ctx.routes` — a disabled module answers `503` with `Retry-After` on
 * both the admin and the public surface. This file registers an encapsulated
 * context and no gate: wrapping again here would add a second, identical check
 * per request.
 *
 * **No Redis ⇒ no queue, no cache, no scheduler, and everything still works.**
 * That is not a convenience: `backend/test/helpers/test-server.ts` runs
 * `setupBackendServer()` once per test file in a single fork, and adding
 * Redis/BullMQ connections there has previously taken ~225 test files down with
 * "too many clients" — a failure a targeted vitest run never reveals
 * (research §R18). Tests drive `handle.generation.generateNow(...)` directly.
 */

// ---------------------------------------------------------------------------
// Module-owned ports
// ---------------------------------------------------------------------------

/**
 * Availability indication, injected as a lambda — never a raw `stock_levels`
 * read. Only `inStock` is consumed: a feed's `availability` field is a binary
 * in-stock / out-of-stock signal, not a quantity, so the module deliberately
 * asks for less than the inventory service returns.
 */
export type FeedAvailabilityResolver = (
  productIds: string[],
  salesChannelId: string,
) => Promise<Map<string, { inStock: boolean }>>;

/**
 * Category-subtree expansion, injected as a lambda for the same reason
 * availability is: `product_categories` is the catalog's bridge table, and a
 * criteria rule on a category must include its descendants (FR-025) without
 * this module learning the catalog's tree shape.
 */
export type FeedCategoryExpander = (
  categoryIds: string[],
) => Promise<Map<string, Set<string>>>;

/** Narrow reader over the Settings module. */
export interface ProductFeedsSettingsReader {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}

/** The `EventBus` surface this module uses. */
export interface ProductFeedsEventBus {
  emit(eventName: string, payload: unknown): void | Promise<void>;
  on(eventName: string, handler: (payload: unknown) => void | Promise<void>): () => void;
}

/** The platform-wide sales-channel id the Settings module uses for global values. */
const GLOBAL_SETTINGS_SCOPE = '00000000-0000-0000-0000-000000000000';

/**
 * Structured, non-fatal logging for the workers. A background sweep that cannot
 * log must still sweep, so this can never throw and never takes a logger
 * dependency the module would otherwise not have.
 */
function warn(message: string, detail: Record<string, unknown>): void {
  console.warn(JSON.stringify({ level: 'warn', msg: message, ...detail }));
}

// ---------------------------------------------------------------------------
// Module wiring
// ---------------------------------------------------------------------------

export interface ProductFeedsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  commandBus: CommandBus;
  eventBus: ProductFeedsEventBus;
  /** Assets Library storage adapters — bytes only, never an `Asset` row (FR-043). */
  storageAdapters: ArtefactStorageAdapterProvider;
  /** The ONE sanctioned channel accessor (Principle XII). */
  salesChannelMembership: SalesChannelMembershipService;
  pricingService: PricingServiceContract;
  taxService: TaxService;
  resolveAvailability: FeedAvailabilityResolver;
  /** Category-subtree expansion for the criteria compiler (FR-025). */
  expandCategoryProductIds: FeedCategoryExpander;
  /**
   * Maps asset ids to stable, publicly reachable URLs. Anything not publicly
   * readable must be ABSENT from the result, never present as a signed URL
   * (FR-043) — which is why this is a port and not a direct adapter call.
   */
  resolvePublicImageUrls: PublicImageUrlResolver;
  /** Product-host attributes and custom fields — one registry since feature 061. */
  customFieldDefinitions: CustomFieldDefinitionService;
  languageService: LanguageService;
  /**
   * Operator notification on a failed run (FR-056). Optional because the
   * notifying path itself lands with US6 (T106); declaring it here keeps the
   * seam in one place.
   */
  adminNotificationService?: AdminNotificationService;
  settings: ProductFeedsSettingsReader;
  /** Origin the public feed URL is built on (`PUBLIC_API_BASE_URL`). */
  publicBaseUrl: string;
  /**
   * `SETTINGS_SECRET_ENCRYPTION_KEY`. Lets a newly issued feed token be stored
   * recoverably so the admin can show its link again. Optional: without it the
   * module behaves exactly as it did before — the link is shown once.
   */
  tokenEncryptionKey?: string | undefined;
  redis?: Redis;
  /** Start this module's BullMQ consumer here (`BACKEND_ROLE !== 'api'`). */
  runWorkers?: boolean;
  /** Override the scheduler (tests, overlay). Defaults to the no-op. */
  scheduler?: FeedScheduler;
  /** Override the artefact store (tests, overlay). */
  artefactStore?: ArtefactStorePort;
  /** Override the item field resolver (overlay seam, Principle XV). */
  itemFieldResolver?: ItemFieldResolverPort;
  /**
   * The credentials module, which owns every secret a delivery target needs
   * (feature 070 / FR-107). Optional: without it the module behaves exactly as
   * it did before delivery existed — no delivery routes, no delivery worker,
   * and a feed that is fetched rather than pushed.
   */
  credentials?: CredentialsService;
  /**
   * The delivery transports. Defaults to the three shipped adapters; an overlay
   * replaces or extends the map to speak a partner's bespoke protocol with
   * `tsc` as the contract gate (Principle XV). Tests inject stubs so **no test
   * in this repository opens a socket**.
   */
  deliveryAdapters?: Map<FeedDeliveryAdapter['protocol'], FeedDeliveryAdapter>;
  /** Root of the bundled taxonomy files. Tests point it at a small fixture. */
  taxonomyDataRoot?: string;
  /**
   * The taxonomy egress transport (overlay seam, Principle XV; research §R24).
   * Tests inject a stub so **no test in this repository can reach the network**
   * — the same reason `taxonomyDataRoot` points at a path that does not exist.
   */
  taxonomySourceFetcher?: TaxonomySourceFetcherPort;
}

export interface ProductFeedsModuleHandle {
  artefactStore: ArtefactStorePort;
  scheduler: FeedScheduler;
  feeds: ProductFeedService;
  /** Template CRUD and the FR-009 validations the structure editor relies on. */
  templates: FeedTemplateService;
  /** Deterministic export and untrusted-document import (FR-012 – FR-018). */
  templateIo: FeedTemplateIoService;
  generation: FeedGenerationService;
  runs: FeedRunService;
  /** Releases claims held by a worker that died (FR-036). */
  reaper: FeedRunReaperService;
  /** Bounded artefact history — object first, then row (FR-052). */
  retention: ArtefactRetentionService;
  /** Postgres → Redis schedule reconciliation (FR-031). */
  schedules: FeedScheduleReconciler;
  /** Criteria compilation and match counting — the preview surface (FR-028). */
  selection: ProductSelectionService;
  /**
   * Feed delivery (feature 070). Null on a deployment wired without the
   * credentials module — delivery cannot store a password without it, and
   * storing one anywhere else is what FR-107 forbids.
   */
  delivery: {
    config: DeliveryConfigService;
    service: DeliveryService;
  } | null;
  tokenCache: FeedTokenCache;
  taxonomies: TaxonomyMappingService;
  taxonomyReconciler: TaxonomyReconcilerService;
  /** One check for a newer provider revision; installs INACTIVE (FR-086). */
  taxonomyRefresh: TaxonomyRefreshService;
  /** Revisions list, impact preview and the two operator Commands. */
  taxonomyRevisions: TaxonomyRevisionService;
  /** Installs any missing predefined template (FR-007, FR-008). */
  reconcileTemplates: () => Promise<number>;
  /**
   * Installs any missing bundled taxonomy revision and re-evaluates mappings
   * for staleness. **This path reads files only and opens no socket**; it is a
   * no-op once installed, and it marks a bundled revision current only when the
   * provider has none, so an upgrade never activates a revision an operator did
   * not choose (FR-078, FR-086).
   */
  reconcileTaxonomies: () => Promise<void>;
  /**
   * Re-assert every per-feed Job Scheduler plus the module-wide sweep from
   * Postgres. Idempotent; safe on every boot of every worker process, and the
   * one thing that makes a flushed Redis cost a tick rather than a feed
   * (research §R5.2).
   */
  reconcileSchedules: () => Promise<ReconcileResult>;
}

export interface ProductFeedsModuleResult {
  plugin: ModulePlugin;
  handle: ProductFeedsModuleHandle;
  /** Closes queues, workers and subscriptions (graceful shutdown / tests). */
  close: () => Promise<void>;
}

export function productFeedsModule(
  options: ProductFeedsModuleOptions,
): ProductFeedsModuleResult {
  const artefactStore: ArtefactStorePort =
    options.artefactStore ?? new ArtefactStore(options.storageAdapters);
  const tokenCache: FeedTokenCache = options.redis
    ? new RedisFeedTokenCache(options.redis)
    : new NoopFeedTokenCache();
  const cacheInvalidator = attachFeedCacheInvalidator(options.eventBus, tokenCache);

  const settings = {
    async getNumber(code: string, fallback: number): Promise<number> {
      try {
        return await options.settings.get(code, GLOBAL_SETTINGS_SCOPE, z.number());
      } catch {
        // Not registered yet (first boot, before the manifest reconciler ran)
        // or unreadable — the manifest default is the answer.
        return fallback;
      }
    },
    async getStringForChannel(
      code: string,
      salesChannelId: string,
      fallback: string,
    ): Promise<string> {
      try {
        const value = await options.settings.get(code, salesChannelId, z.string());
        return value.trim() !== '' ? value.trim() : fallback;
      } catch {
        return fallback;
      }
    },
    async getBoolean(code: string, fallback: boolean): Promise<boolean> {
      try {
        return await options.settings.get(code, GLOBAL_SETTINGS_SCOPE, z.boolean());
      } catch {
        return fallback;
      }
    },
    async getString(code: string, fallback: string): Promise<string> {
      try {
        const value = await options.settings.get(code, GLOBAL_SETTINGS_SCOPE, z.string());
        return value.trim() !== '' ? value.trim() : fallback;
      } catch {
        return fallback;
      }
    },
  };

  const runs = new FeedRunService(options.emFactory);

  /** A named price list is used verbatim (FR-020) — no rule evaluation. */
  const resolveNamedListPrice: NamedListPriceResolver = async (input) => {
    const em = options.emFactory();
    const rows = (await em
      .getConnection()
      .execute(
        `select "amount" from "price_list_price_brackets"
          where "price_list_id" = ? and "product_id" = ? and "currency_code" = ?
          order by "min_quantity" asc limit 1`,
        [input.priceListId, input.productId, input.currencyCode],
        'all',
        em.getTransactionContext(),
      )) as Array<{ amount: string }>;
    const amount = rows[0]?.amount;
    return amount === undefined ? null : Number(amount);
  };

  /** The anonymous storefront resolution: no organization, no customer group (R12). */
  const resolveAnonymousPrice: AnonymousPriceResolver = async (input) => {
    const resolved = await options.pricingService.resolveLinePrice({
      product: input.product as Product,
      variantId: input.variantId,
      context: {
        quantity: 1,
        organization: null,
        customerGroupId: null,
        salesChannel: input.salesChannel,
        currencyCode: input.currencyCode,
      },
    });
    return resolved ? { amount: Number(resolved.amount), isSale: resolved.isSale } : null;
  };

  /**
   * Prices for a criteria batch (FR-025 "price range"). Deliberately the same
   * two paths generation uses — the named list verbatim, otherwise the
   * anonymous channel resolution — so the count an operator sees before saving
   * is computed from the prices the next run will actually emit (FR-028).
   */
  const resolveSelectionPrices: SelectionPricePort = async (input) => {
    const out = new Map<string, number>();
    if (input.productIds.length === 0) return out;
    const em = options.emFactory();

    if (input.priceListId) {
      const placeholders = input.productIds.map(() => '?').join(',');
      const rows = (await em
        .getConnection()
        .execute(
          `select distinct on ("product_id") "product_id", "amount"
             from "price_list_price_brackets"
            where "price_list_id" = ? and "currency_code" = ?
              and "product_id" in (${placeholders})
            order by "product_id" asc, "min_quantity" asc`,
          [input.priceListId, input.currencyCode, ...input.productIds],
          'all',
          em.getTransactionContext(),
        )) as Array<{ product_id: string; amount: string }>;
      for (const row of rows) out.set(row.product_id, Number(row.amount));
      return out;
    }

    const { salesChannelId } = input;
    const channel = await em.findOne(SalesChannel, { id: salesChannelId });
    if (!channel) return out;
    // The ids come from the channel-scoped selection; the channel is bound above
    // so the scoping is visible here too (`no-unscoped-channel-query`).
    const products = await em.find(Product, { id: { $in: input.productIds } });
    for (const product of products) {
      const resolved = await resolveAnonymousPrice({
        product,
        variantId: null,
        salesChannel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
        currencyCode: input.currencyCode,
      });
      if (resolved) out.set(product.id, resolved.amount);
    }
    return out;
  };

  const catalogSelection: CatalogSelectionPort = {
    expandCategoryProductIds: (categoryIds) => options.expandCategoryProductIds(categoryIds),
    listProductFieldKeys: async () => {
      // One registry since feature 061: product attributes and product custom
      // fields are both `custom_field_definitions` rows on the `product` host.
      const definitions = await options.customFieldDefinitions.listForEntity('product');
      return new Set(definitions.map((entry) => entry.definition.key));
    },
  };

  const selection = new ProductSelectionService({
    emFactory: options.emFactory,
    membership: options.salesChannelMembership,
    catalog: catalogSelection,
    resolveAvailability: options.resolveAvailability,
    resolvePrices: resolveSelectionPrices,
  });

  const retention = new ArtefactRetentionService({
    emFactory: options.emFactory,
    artefactStore,
    retentionCount: () =>
      settings.getNumber(
        PRODUCT_FEED_SETTING_CODES.ARTEFACT_RETENTION_COUNT,
        DEFAULT_ARTEFACT_RETENTION_COUNT,
      ),
    logWarn: warn,
  });

  // FR-056 — optional because the notification surface is an injected
  // collaborator; without it the run row is still the record, it just does not
  // ring a bell.
  const failedRunNotifier = options.adminNotificationService
    ? new FailedRunNotifier({
        emFactory: options.emFactory,
        notifications: options.adminNotificationService,
        logWarn: warn,
      })
    : null;

  // -------------------------------------------------------------------------
  // Delivery (feature 070)
  //
  // Present iff the credentials module is wired: every secret a target needs
  // lives there (FR-107), and a delivery configuration that could not store a
  // password would be a screen that silently loses one. A deployment without it
  // behaves exactly as it did before delivery existed.
  // -------------------------------------------------------------------------
  const deliveryAdapters: Map<FeedDeliveryAdapter['protocol'], FeedDeliveryAdapter> =
    options.deliveryAdapters ??
    new Map<FeedDeliveryAdapter['protocol'], FeedDeliveryAdapter>([
      ['http', new HttpDeliveryAdapter()],
      ['sftp', new SftpDeliveryAdapter()],
      ['ftp', new FtpDeliveryAdapter()],
    ]);

  const deliveryConfig = options.credentials
    ? new DeliveryConfigService({
        emFactory: options.emFactory,
        commandBus: options.commandBus,
        credentials: options.credentials,
      })
    : null;

  const deliveryService = deliveryConfig
    ? new DeliveryService({
        emFactory: options.emFactory,
        config: deliveryConfig,
        artefactStore,
        adapters: deliveryAdapters,
        testRateLimitPerHour: () =>
          settings.getNumber(
            PRODUCT_FEED_SETTING_CODES.DELIVERY_TEST_RATE_LIMIT_PER_HOUR,
            FEED_DELIVERY_LIMITS.DEFAULT_TEST_RATE_LIMIT_PER_HOUR,
          ),
        logWarn: warn,
      })
    : null;

  const generation = new FeedGenerationService({
    emFactory: options.emFactory,
    selection,
    runs,
    artefactStore,
    enforceRetention: (feedId, protectedArtefactId) =>
      retention.enforce(feedId, 'feed', protectedArtefactId),
    ...(failedRunNotifier
      ? { notifyFailedRun: (input) => failedRunNotifier.notify(input) }
      : {}),
    // FR-102 — the port exists whenever delivery does; whether anything is
    // actually sent is the feed's own configuration, resolved downstream.
    //
    // With Redis this only enqueues, which is what keeps the upload out of the
    // generation job (Principle X) and its retries away from the published run
    // (FR-103). **Without Redis it delivers inline**, because the alternative is
    // a deployment where an operator configures a target, sees no error, and is
    // never delivered to. That path is safe by construction: `deliver()` never
    // throws, and the caller swallows anyway — the run is finished and
    // published before either branch runs.
    ...(deliveryService
      ? {
          deliverArtefact: async ({ feedId, runId, artefactId }) => {
            if (deliveryQueue) {
              await deliveryQueue.add('deliver', {
                productFeedId: feedId,
                feedRunId: runId,
                feedArtefactId: artefactId,
              });
              return;
            }
            await deliveryService.deliver({
              feedId,
              runId,
              artefactId,
              attempt: 1,
              // One attempt: with no queue there is nothing to schedule a
              // retry on, and pretending otherwise would record an attempt
              // count that never happens.
              maxAttempts: 1,
            });
          },
        }
      : {}),
    resolver: options.itemFieldResolver ?? new ItemFieldResolver(),
    settings,
    resolveNamedListPrice,
    resolveAnonymousPrice,
    resolveTaxRate: async ({ countryCode, productType }) => {
      const resolved = await options.taxService.taxRateFor({
        country: countryCode,
        productType: productType as 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual',
        // A feed has no buyer, so no VAT status can be inferred; the ordinary
        // taxable-buyer rule is the only defensible assumption (R12).
        vatStatus: 'vat_payer',
      });
      // `source: 'none'` means no rule and no default matched. On a gross feed
      // that is a run warning, never a silent zero-VAT price (R12).
      return resolved.source === 'none' ? null : resolved.rate;
    },
    resolveAvailability: options.resolveAvailability,
    resolvePublicImageUrls: options.resolvePublicImageUrls,
    loadTaxonomyResolution: (providerCode) => taxonomies.resolutionContext(providerCode),
    listActiveLanguages: async () => {
      const languages = await options.languageService.listActive();
      return languages.map((l) => ({
        code: l.code,
        fallbackCode: l.fallbackCode ?? null,
        isDefault: l.isDefault,
      }));
    },
  });

  const taxonomyReconciler = new TaxonomyReconcilerService({
    emFactory: options.emFactory,
    ...(options.taxonomyDataRoot !== undefined ? { dataRoot: options.taxonomyDataRoot } : {}),
  });
  const taxonomies = new TaxonomyMappingService({
    emFactory: options.emFactory,
    commandBus: options.commandBus,
  });

  // -------------------------------------------------------------------------
  // Taxonomy revision refresh (FR-086 – FR-099)
  //
  // The whole mechanism ships OFF (`taxonomy_fetch_enabled` defaults to
  // `false`), and off is a fully supported state: with the switch off no Job
  // Scheduler exists, `POST /checks` is refused, and nothing here opens a
  // socket. That is also why off is the state every dev environment and every
  // CI run exercises — a supported configuration that is never the default is a
  // configuration that rots.
  // -------------------------------------------------------------------------
  const taxonomyFetchEnabled = (): Promise<boolean> =>
    settings.getBoolean(PRODUCT_FEED_SETTING_CODES.TAXONOMY_FETCH_ENABLED, false);

  const taxonomySourceUrl = async (
    providerCode: 'google_merchant' | 'meta',
    language: 'en' | 'pl',
  ): Promise<string> => {
    const code =
      providerCode === 'google_merchant'
        ? language === 'en'
          ? PRODUCT_FEED_SETTING_CODES.TAXONOMY_SOURCE_URL_GOOGLE_EN
          : PRODUCT_FEED_SETTING_CODES.TAXONOMY_SOURCE_URL_GOOGLE_PL
        : language === 'en'
          ? PRODUCT_FEED_SETTING_CODES.TAXONOMY_SOURCE_URL_META_EN
          : PRODUCT_FEED_SETTING_CODES.TAXONOMY_SOURCE_URL_META_PL;
    return settings.getString(code, DEFAULT_TAXONOMY_SOURCE_URLS[providerCode][language]);
  };

  const taxonomyRetention = new TaxonomyRevisionRetentionService({
    emFactory: options.emFactory,
    retentionCount: () =>
      settings.getNumber(PRODUCT_FEED_SETTING_CODES.TAXONOMY_REVISION_RETENTION_COUNT, 3),
    logWarn: warn,
  });

  const taxonomyRefresh = new TaxonomyRefreshService({
    emFactory: options.emFactory,
    fetcher: options.taxonomySourceFetcher ?? new TaxonomySourceFetcher(),
    reconciler: taxonomyReconciler,
    retention: taxonomyRetention,
    settings: { enabled: taxonomyFetchEnabled, sourceUrl: taxonomySourceUrl },
    ...(failedRunNotifier
      ? {
          notifyNotFound: (input) =>
            failedRunNotifier.notifyTaxonomyNotFound({
              providerCode: input.providerCode,
              checkId: input.checkId,
              detail: input.detail,
            }),
        }
      : {}),
    logWarn: warn,
  });

  const feeds = new ProductFeedService({
    emFactory: options.emFactory,
    commandBus: options.commandBus,
    publicBaseUrl: options.publicBaseUrl,
    tokenEncryptionKey: options.tokenEncryptionKey,
  });

  /**
   * The product-host definition registry, read once per call. Attributes and
   * product custom fields are the same rows since feature 061, so the template
   * editor's picker and its save-time key validation resolve identically —
   * which is what stops the editor offering a binding the save then refuses.
   */
  const listProductFieldDefinitions = async (): Promise<ProductFieldDefinition[]> => {
    const definitions = await options.customFieldDefinitions.listForEntity('product');
    return definitions.map(({ definition }) => ({
      key: definition.key,
      label: definition.labelDefault || definition.key,
      description: null,
      valueType: definition.valueType,
    }));
  };
  const listProductFieldKeys = async (): Promise<Set<string>> =>
    new Set((await listProductFieldDefinitions()).map((entry) => entry.key));

  const templates = new FeedTemplateService({
    emFactory: options.emFactory,
    commandBus: options.commandBus,
    listProductFieldKeys,
  });

  const templateIo = new FeedTemplateIoService({
    emFactory: options.emFactory,
    commandBus: options.commandBus,
    templates,
    listProductFieldKeys,
  });

  const templatePreview = new TemplatePreviewService({
    emFactory: options.emFactory,
    generation,
    resolver: options.itemFieldResolver ?? new ItemFieldResolver(),
    listProductFieldKeys,
    listActiveLanguages: async () => {
      const languages = await options.languageService.listActive();
      return languages.map((l) => ({
        code: l.code,
        fallbackCode: l.fallbackCode ?? null,
        isDefault: l.isDefault,
      }));
    },
    loadTaxonomyResolution: (providerCode) => taxonomies.resolutionContext(providerCode),
    storefrontOriginFor: (salesChannelId) =>
      settings.getStringForChannel(
        'sales_channels.storefront_url',
        salesChannelId,
        process.env['STOREFRONT_BASE_URL'] ?? '',
      ),
  });

  // Producer + consumer. With no Redis the producer is a no-op: the route still
  // answers 202 with a `queued` run (FR-032), which is exactly what a
  // producer-only API process does when the worker lives elsewhere.
  const queue = options.redis ? createFeedGenerationQueue(options.redis) : undefined;
  const reaperQueue = options.redis ? createFeedReaperQueue(options.redis) : undefined;
  const taxonomyRefreshQueue = options.redis
    ? createTaxonomyRefreshQueue(options.redis)
    : undefined;
  // Delivery has a queue of its own so a failed upload and its retries can never
  // reach the generation run that has already published (FR-103).
  const deliveryQueue =
    options.redis && deliveryService ? createFeedDeliveryQueue(options.redis) : undefined;

  // The real scheduler exists only where a queue does. Everywhere else the
  // no-op stands in, so no caller needs a null check and no test opens a
  // connection (research §R18).
  const scheduler: FeedScheduler =
    options.scheduler ?? (queue ? new BullFeedScheduler(queue) : new NoopFeedScheduler());

  const reaper = new FeedRunReaperService({
    emFactory: options.emFactory,
    artefactStore,
    staleTimeoutMinutes: () =>
      settings.getNumber(
        PRODUCT_FEED_SETTING_CODES.STALE_CLAIM_TIMEOUT_MINUTES,
        DEFAULT_STALE_CLAIM_TIMEOUT_MINUTES,
      ),
    ...(failedRunNotifier
      ? { notifyFailedRun: (input) => failedRunNotifier.notify(input) }
      : {}),
  });

  // "Exists iff the setting is on" — turning the switch off REMOVES the job
  // rather than leaving one that wakes weekly and returns early (FR-087).
  const taxonomyRefreshSchedule: TaxonomyRefreshSchedulePort | undefined = taxonomyRefreshQueue
    ? {
        ensure: (cron) => ensureTaxonomyRefreshSchedule(taxonomyRefreshQueue, cron),
        remove: () => removeTaxonomyRefreshSchedule(taxonomyRefreshQueue),
      }
    : undefined;

  const taxonomyRevisions = new TaxonomyRevisionService({
    emFactory: options.emFactory,
    commandBus: options.commandBus,
    reconciler: taxonomyReconciler,
    refresh: taxonomyRefresh,
    fetchEnabled: taxonomyFetchEnabled,
    ...(taxonomyRefreshQueue
      ? {
          enqueueCheck: async ({ providerCode, checkId }) => {
            await taxonomyRefreshQueue.add('check', { providerCode, checkId });
          },
        }
      : {}),
  });

  const schedules = new FeedScheduleReconciler({
    emFactory: options.emFactory,
    scheduler,
    ...(taxonomyRefreshSchedule ? { taxonomyRefreshSchedule } : {}),
    taxonomyRefreshSettings: {
      enabled: taxonomyFetchEnabled,
      cron: () =>
        settings.getString(
          PRODUCT_FEED_SETTING_CODES.TAXONOMY_FETCH_CRON,
          DEFAULT_TAXONOMY_FETCH_CRON,
        ),
    },
  });

  // The schedule lifecycle: Postgres commits first, Redis is touched after
  // (research §R5.4). Subscribing to the module's own events rather than
  // calling from the service keeps the ordering true for every write path —
  // create, update, duplicate and delete alike — and means a Redis failure can
  // never roll back a committed feed.
  const scheduleSync = attachFeedScheduleSync(options.eventBus, schedules);
  // The Settings module emits `settings.value_changed` on commit, so flipping
  // the taxonomy master switch takes effect at that moment rather than at the
  // next boot: an operator told the platform will stop contacting Google should
  // not have to restart it to make that true.
  const taxonomyScheduleSync = attachTaxonomyScheduleSync(options.eventBus, schedules);

  let worker: ReturnType<typeof createFeedGenerationWorker> | undefined;
  let reaperWorker: ReturnType<typeof createFeedReaperWorker> | undefined;
  let taxonomyRefreshWorker: ReturnType<typeof registerTaxonomyRefreshWorker> | undefined;
  let deliveryWorker: ReturnType<typeof registerFeedDeliveryWorker> | undefined;
  if (options.redis && options.runWorkers) {
    worker = registerFeedGenerationWorker({
      redis: options.redis,
      generation,
      runs,
      logWarn: warn,
    });
    reaperWorker = registerFeedRunReaperWorker({
      redis: options.redis,
      reaper,
      logWarn: warn,
    });
    taxonomyRefreshWorker = registerTaxonomyRefreshWorker({
      redis: options.redis,
      refresh: taxonomyRefresh,
      logWarn: warn,
    });
    if (deliveryService) {
      deliveryWorker = registerFeedDeliveryWorker({
        redis: options.redis,
        delivery: deliveryService,
        maxAttempts: () =>
          settings.getNumber(
            PRODUCT_FEED_SETTING_CODES.DELIVERY_MAX_ATTEMPTS,
            FEED_DELIVERY_LIMITS.DEFAULT_MAX_ATTEMPTS,
          ),
        // AS-3 — an exhausted delivery reaches the operator through the same
        // path a failed run does, rather than sitting silently in a table.
        ...(failedRunNotifier
          ? { notifyExhausted: (input) => failedRunNotifier.notifyDeliveryExhausted(input) }
          : {}),
        logWarn: warn,
      });
    }
  }

  const handle: ProductFeedsModuleHandle = {
    artefactStore,
    scheduler,
    feeds,
    templates,
    templateIo,
    generation,
    runs,
    reaper,
    retention,
    schedules,
    selection,
    delivery:
      deliveryConfig && deliveryService
        ? { config: deliveryConfig, service: deliveryService }
        : null,
    tokenCache,
    taxonomies,
    taxonomyReconciler,
    taxonomyRefresh,
    taxonomyRevisions,
    reconcileTemplates: () => reconcilePredefinedTemplates(options.emFactory()),
    reconcileTaxonomies: async () => {
      await taxonomyReconciler.reconcile();
      // Point each provider's templates at its current revision so a
      // `provider_category` field resolves without operator action.
      await taxonomyReconciler.linkTemplatesToCurrentTaxonomies();
    },
    reconcileSchedules: async () => {
      const result = await schedules.reconcile();
      // The module-wide sweep is installed alongside the per-feed schedules, so
      // a flushed Redis rebuilds both in one place.
      if (reaperQueue && options.runWorkers) await ensureReaperSchedule(reaperQueue);
      // FR-087 / FR-089 — and the taxonomy check scheduler, whose desired state
      // is the master switch. A flushed Redis rebuilds all three in one place.
      if (options.runWorkers) await schedules.reconcileTaxonomyRefreshSchedule();
      return result;
    },
  };

  // Encapsulated, not gated — `backend.ts` mounts this through `ctx.routes`,
  // which already applies `defineModuleRoutes('product_feeds', …)` (feature 072).
  const plugin = async (outer: FastifyInstance): Promise<void> => {
    await outer.register(async (app: FastifyInstance) => {
    await registerProductFeedsAdminRoutes(app, {
      requireAdmin: options.requireAdmin,
      emFactory: options.emFactory,
      feeds,
      selection,
      artefactStore,
      tokenCache,
      enqueueRun: async ({ productFeedId, feedRunId }) => {
        if (!queue) return;
        await queue.add('generate', { productFeedId, feedRunId });
      },
    });
    if (deliveryConfig && deliveryService) {
      await registerProductFeedsDeliveryRoutes(app, {
        requireAdmin: options.requireAdmin,
        config: deliveryConfig,
        delivery: deliveryService,
      });
    }
    await registerProductFeedsTemplateRoutes(app, {
      requireAdmin: options.requireAdmin,
      templates,
      io: templateIo,
      preview: templatePreview,
      listProductFieldDefinitions,
    });
    await registerProductFeedsTaxonomyRoutes(app, {
      requireAdmin: options.requireAdmin,
      mappings: taxonomies,
      revisions: taxonomyRevisions,
    });
    await registerProductFeedsPublicRoutes(app, {
      emFactory: options.emFactory,
      artefactStore,
      tokenCache,
      hitRateLimitPerMinute: () =>
        settings.getNumber(PRODUCT_FEED_SETTING_CODES.PUBLIC_FETCH_RATE_LIMIT_PER_MINUTE, 60),
    });
    });
  };

  return {
    plugin,
    handle,
    close: async () => {
      cacheInvalidator.dispose();
      scheduleSync.dispose();
      taxonomyScheduleSync.dispose();
      await worker?.close().catch(() => undefined);
      await reaperWorker?.close().catch(() => undefined);
      await taxonomyRefreshWorker?.close().catch(() => undefined);
      await deliveryWorker?.close().catch(() => undefined);
      await queue?.close().catch(() => undefined);
      await reaperQueue?.close().catch(() => undefined);
      await taxonomyRefreshQueue?.close().catch(() => undefined);
      await deliveryQueue?.close().catch(() => undefined);
    },
  };
}
