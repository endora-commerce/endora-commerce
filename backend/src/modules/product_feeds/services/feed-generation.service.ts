import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
  CatalogGalleryPort,
  CatalogProductReadPort,
  CatalogProductRecord,
  CatalogProductVariantRecord,
  FeedRunFailureCode,
  FeedRunTrigger,
} from '@endora-commerce/contracts';
import { withSystemScope } from '../../../tenancy/escape-hatch.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { FeedRun } from '../entities/feed-run.entity.js';
import { FeedArtefact } from '../entities/feed-artefact.entity.js';
import { FeedTemplate } from '../entities/feed-template.entity.js';
import { FeedTemplateField } from '../entities/feed-template-field.entity.js';
import { ProductFeed } from '../entities/product-feed.entity.js';
import type { ArtefactStorePort, ArtefactStorageBackend } from './artefact-store.js';
import {
  ChannelUnavailableError,
  UnknownSelectionFieldError,
  type ProductSelectionService,
} from './product-selection.service.js';
import { terminalStatusFor, type FeedRunService, type RunCounters } from './feed-run.service.js';
import type {
  FeedItemPrice,
  FeedItemSource,
  FeedResolutionContext,
  ItemFieldResolverPort,
  ResolvableTemplateField,
} from './item-field-resolver.interface.js';
import {
  resolveProviderCategory,
  type TaxonomyCategoryNode,
  type TaxonomyMappingRow,
} from './taxonomy-mapping-resolver.js';
import { createFeedReadable, measureStream } from './serializers/feed-stream.js';
import { DelimitedFeedSerializer } from './serializers/delimited-feed-serializer.js';
import { XlsxFeedSerializer } from './serializers/xlsx-feed-serializer.js';
import { XmlFeedSerializer } from './serializers/xml-feed-serializer.js';
import type { AnyFeedSerializer, FeedItemField } from './serializers/serializer.interface.js';

/**
 * The generation pipeline — feature 067 / FR-034–FR-039, FR-060.
 *
 * ```
 *   selection (ids only, keyset)
 *     → hydrate one batch of 500
 *       → resolve each item (pure)
 *         → serialize (chunk per item)
 *           → artefactStore.put(stream)
 *   → publish by flipping ONE pointer, after put() resolves
 * ```
 *
 * Three properties this file is responsible for:
 *
 *  - **Nothing buffers.** The item source is an async generator; the serializer
 *    returns one chunk per item; the storage adapter consumes a `Readable`.
 *    `em.clear()` runs after every batch, because MikroORM's identity map is
 *    the classic way a "streaming" job silently becomes an in-memory one.
 *  - **An item-level problem never aborts the run** (FR-037). Skips and
 *    warnings are recorded and the run continues; only a configuration failure
 *    (unresolvable channel, unknown attribute, storage down) fails it.
 *  - **Publication is one pointer flip, after the object is complete**
 *    (FR-035). A failed, empty or over-threshold run never touches
 *    `published_artefact_id`, so the previously published file keeps serving.
 */

/** Hydration batch. 500 keeps peak memory at O(batch × fields) with room to spare. */
const HYDRATE_BATCH_SIZE = 500;

const STOREFRONT_URL_SETTING = 'sales_channels.storefront_url';

/** Resolves a product's unit price from a specific price list (FR-020, verbatim). */
export type NamedListPriceResolver = (input: {
  priceListId: string;
  productId: string;
  currencyCode: string;
}) => Promise<number | null>;

/** Resolves the anonymous channel price — organization-less, the storefront's own path. */
export type AnonymousPriceResolver = (input: {
  product: CatalogProductRecord;
  variantId: string | null;
  salesChannel: { id: string; defaultCurrency: string };
  currencyCode: string;
}) => Promise<{ amount: number; isSale: boolean } | null>;

/** Percentage VAT rate for a country, or null when no rule and no default matched. */
export type TaxRateResolver = (input: {
  countryCode: string;
  productType: string;
}) => Promise<number | null>;

export type AvailabilityResolver = (
  productIds: string[],
  salesChannelId: string,
) => Promise<Map<string, { inStock: boolean }>>;

/**
 * Maps asset ids to **stable, publicly reachable** URLs (FR-043). An asset that
 * is not public, or whose URL could only be produced as an expiring signed one,
 * must be absent from the result — never present as a signed URL.
 */
export type PublicImageUrlResolver = (
  assetIds: string[],
) => Promise<Map<string, string>>;

export interface FeedSettingsReader {
  getNumber(code: string, fallback: number): Promise<number>;
  getStringForChannel(code: string, salesChannelId: string, fallback: string): Promise<string>;
}

/**
 * Retention sweep, injected as a port so the generation pipeline owns the
 * *when* (immediately after a successful publish) and the retention service
 * owns the *what* (FR-052). Optional: a deployment with no sweep still
 * generates, it just keeps every file.
 */
export type ArtefactRetentionPort = (
  feedId: string,
  protectedArtefactId: string | null,
) => Promise<unknown>;

/** Operator notification on a failed run (FR-056). Optional for the same reason. */
export type FailedRunNotifierPort = (input: {
  feedId: string;
  runId: string;
  failureCode: FeedRunFailureCode | null;
  failureDetail: string | null;
}) => Promise<unknown>;

/**
 * Push the published artefact to the feed's delivery target — feature 070,
 * FR-102.
 *
 * A third optional port on the same seam as `enforceRetention` and
 * `notifyFailedRun`, invoked on **exactly one branch**: after a run has
 * published successfully. That placement is FR-102 itself — a failed, empty or
 * skipped run must not deliver, because the previously published file is the one
 * still being served and re-sending it would tell the partner something changed
 * when nothing did.
 *
 * The port only *enqueues*: the transfer is somebody else's server and a
 * multi-megabyte upload, so it runs in its own queue with its own retries
 * (Principle X). That is also what keeps FR-103 true — a delivery that fails
 * cannot fail the run, because by the time it is attempted the run is finished.
 */
export type ArtefactDeliveryPort = (input: {
  feedId: string;
  runId: string;
  artefactId: string;
}) => Promise<unknown>;

export interface FeedGenerationDeps {
  emFactory: () => EntityManager;
  /**
   * Feature 075, Phase C — the product, variant and category rows a feed line
   * is built from. All three were `em.find(<catalog entity>, …)` against tables
   * this module does not own, so a run kept publishing a catalogue an operator
   * had switched `catalog` off from. `catalog` is a binding dependency of this
   * manifest and the reads now fail closed with it.
   */
  catalogProducts: CatalogProductReadPort;
  catalogCategories: CatalogCategoryReadPort;
  /**
   * Feature 075 / D-87 — the gallery of a hydration batch. `listForProducts`
   * rather than `list`: the per-product call verifies the product and then runs
   * two more queries, so a 500-product batch would cost 1500 round-trips in
   * place of one, and a feed run walks the whole sellable catalogue. Only the
   * asset **ids** come back — the urls are `resolvePublicImageUrls`' answer,
   * which asks `assets_library` and drops whatever is not publicly reachable.
   */
  catalogGallery: CatalogGalleryPort;
  selection: ProductSelectionService;
  runs: FeedRunService;
  artefactStore: ArtefactStorePort;
  /** FR-052 — runs after a successful publish, never before it. */
  enforceRetention?: ArtefactRetentionPort;
  /** FR-056 — raised by the worker, never by a route. */
  notifyFailedRun?: FailedRunNotifierPort;
  /** FR-102 — enqueued after a successful publish, never on any other branch. */
  deliverArtefact?: ArtefactDeliveryPort;
  resolver: ItemFieldResolverPort;
  settings: FeedSettingsReader;
  resolveNamedListPrice: NamedListPriceResolver;
  resolveAnonymousPrice: AnonymousPriceResolver;
  resolveTaxRate: TaxRateResolver;
  resolveAvailability: AvailabilityResolver;
  resolvePublicImageUrls: PublicImageUrlResolver;
  listActiveLanguages: () => Promise<
    Array<{ code: string; fallbackCode: string | null; isDefault: boolean }>
  >;
  /**
   * The category tree and the installation-wide mapping set for one provider,
   * read ONCE per run. Resolution itself is pure and in-memory, so a 100k-item
   * feed costs two queries here rather than one per product.
   */
  loadTaxonomyResolution?: (providerCode: 'google_merchant' | 'meta') => Promise<{
    categoriesById: Map<string, TaxonomyCategoryNode>;
    mappingsByCategoryId: Map<string, TaxonomyMappingRow>;
  }>;
}

export interface GenerateOptions {
  trigger: FeedRunTrigger;
  triggeredByAdminUserId?: string | null;
  /** Pre-created `queued` run (the worker path). Omit to create one inline. */
  runId?: string;
  /**
   * Test seam for FR-027: drive the run with a channel id that does not
   * resolve, which a foreign key would otherwise refuse to persist. Production
   * never sets it.
   */
  overrideSalesChannelId?: string;
}

class StorageUnavailableError extends Error {}

/**
 * Writes one per-item issue onto the caller's `EntityManager`.
 *
 * The manager is a parameter rather than something the recorder obtains for
 * itself because `emFactory()` is `orm.em.fork()`: a row persisted onto a
 * private fork is dropped when the fork is garbage-collected, with no error
 * anywhere. The item source owns one manager per run and flushes it once per
 * batch, and that is the one these rows have to land on.
 */
type IssueRecorder = (
  em: EntityManager,
  severity: 'skip' | 'warning',
  reason: Parameters<FeedRunService['recordIssue']>[2]['reason'],
  item: { productId: string | null; variantId: string | null; sku: string | null },
  outputName: string | null,
  detail: string | null,
) => void;

export class FeedGenerationService {
  constructor(private readonly deps: FeedGenerationDeps) {}

  /**
   * Runs a generation to completion. Called by the queue consumer, and directly
   * by integration tests (the shared test server deliberately carries no Redis
   * — research §R18).
   */
  async generateNow(feedId: string, options: GenerateOptions): Promise<FeedRun> {
    const runId =
      options.runId ??
      (
        await this.deps.runs.createQueuedRun({
          productFeedId: feedId,
          trigger: options.trigger,
          triggeredByAdminUserId: options.triggeredByAdminUserId ?? null,
        })
      ).id;

    // The worker has no request and therefore no ambient tenant context; this
    // is the one audited hatch, with a non-empty reason (Principle XI).
    return withSystemScope(`product_feeds: generate feed ${feedId}`, () =>
      this.execute(feedId, runId, options),
    );
  }

  private async execute(
    feedId: string,
    runId: string,
    options: GenerateOptions,
  ): Promise<FeedRun> {
    // command-coverage-ignore: run execution (FR-034). The operator's write is the
    // `product_feeds.run.start` Command; this is the queue consumer's own
    // progress bookkeeping — claim, counters, heartbeat, artefact row, terminal
    // status. A scheduled tick has no actor at all (FR-060), and an audit entry
    // per tick would bury the writes that do have one.
    const startedAtMs = Date.now();
    const counters: RunCounters = {
      consideredCount: 0,
      emittedCount: 0,
      skippedCount: 0,
      warningCount: 0,
      issueOverflow: false,
    };

    const claim = await this.deps.runs.claim(feedId, runId);
    if (!claim.acquired) {
      const em = this.deps.emFactory();
      em.clear();
      return em.findOneOrFail(FeedRun, { id: runId });
    }

    const issueCap = await this.deps.settings.getNumber('product_feeds.run_issue_cap', 1000);
    const skipThreshold = await this.deps.settings.getNumber(
      'product_feeds.skip_share_failure_threshold',
      0.5,
    );

    let artefactId: string | null = null;
    let failureCode: FeedRunFailureCode | null = null;
    let failureDetail: string | null = null;

    try {
      const prepared = await this.prepare(feedId, options);
      // The field list as it stood when the run started — FR-076's "an
      // in-flight run completes against the template it started with".
      await this.storeTemplateSnapshot(runId, prepared.fields);

      let issuesWritten = 0;
      // `em` comes from the item source's own manager, because `emFactory()`
      // forks: a row persisted onto a manager nobody flushes is silently lost.
      const recordIssue: IssueRecorder = (em, severity, reason, item, outputName, detail) => {
        const written = this.deps.runs.recordIssue(
          em,
          runId,
          { severity, reason, ...item, outputName, detail },
          issuesWritten,
          issueCap,
        );
        if (written) issuesWritten += 1;
        else counters.issueOverflow = true;
      };

      const serializer = this.buildSerializer(prepared);
      const source = this.itemSource(prepared, runId, counters, recordIssue);
      const { stream, measurement } = measureStream(createFeedReadable(serializer, source));

      const em = this.deps.emFactory();
      const artefact = em.create(FeedArtefact, {
        productFeedId: feedId,
        feedRunId: runId,
        kind: 'feed',
        storageBackend: 'local',
        storageLocator: '',
        contentType: serializer.contentType,
        byteSize: 0,
        itemCount: 0,
      });
      const locator = this.deps.artefactStore.newLocator({
        artefactId: artefact.id,
        extension: serializer.fileExtension,
      });

      let put: { backend: ArtefactStorageBackend; locator: string };
      try {
        put = await this.deps.artefactStore.put({
          locator,
          contentType: serializer.contentType,
          stream,
        });
      } catch (err) {
        throw new StorageUnavailableError(String(err));
      }

      // Only now does the object exist in full. Everything below is metadata.
      artefact.storageBackend = put.backend;
      artefact.storageLocator = put.locator;
      artefact.byteSize = measurement.byteSize;
      artefact.itemCount = counters.emittedCount;
      artefact.checksumSha256 = measurement.checksumSha256;
      await em.persistAndFlush(artefact);
      artefactId = artefact.id;

      const terminal = terminalStatusFor(counters, skipThreshold);
      if (!terminal.failureCode && terminal.status !== 'empty') {
        const finished = await this.deps.runs.finish({
          feedId,
          runId,
          status: terminal.status,
          counters,
          artefactId,
          startedAtMs,
        });
        // FR-052 — retention runs only here, after the pointer has moved, so
        // the artefact it just published is already excluded by the time the
        // sweep reads the feed row.
        await this.deps.enforceRetention?.(feedId, artefactId);
        // FR-102 — and delivery, on this branch alone. Enqueue only: the upload
        // is somebody else's server, so it never runs inside the generation job
        // (Principle X), and a delivery failure therefore cannot reach the run
        // that has already published (FR-103).
        //
        // Deliberately swallowed: an unreachable Redis must not turn a published
        // run into a failed one. The operator sees a feed with no delivery
        // attempt, which is the truth.
        await this.deps
          .deliverArtefact?.({ feedId, runId, artefactId })
          .catch(() => undefined);
        return finished;
      }

      // Not publishable: keep the row and the file for diagnostics, but never
      // move the pointer (FR-038, FR-039).
      const unpublished = await this.deps.runs.finish({
        feedId,
        runId,
        status: terminal.status,
        counters,
        failureCode: terminal.failureCode,
        failureDetail:
          terminal.failureCode === 'skip_threshold_exceeded'
            ? `${counters.skippedCount} of ${counters.consideredCount} items were skipped.`
            : null,
        artefactId,
        startedAtMs,
      });
      if (unpublished.status === 'failed') {
        await this.deps.notifyFailedRun?.({
          feedId,
          runId,
          failureCode: terminal.failureCode,
          failureDetail: unpublished.failureDetail ?? null,
        });
      }
      return unpublished;
    } catch (err) {
      if (err instanceof ChannelUnavailableError) {
        failureCode = 'channel_unavailable';
        failureDetail = err.message;
      } else if (err instanceof UnknownSelectionFieldError) {
        failureCode = 'unknown_attribute';
        failureDetail = err.message;
      } else if (err instanceof StorageUnavailableError) {
        failureCode = 'storage_unavailable';
        failureDetail = err.message;
      } else if (err instanceof UnboundTemplateError) {
        failureCode = 'unbound_template_fields';
        failureDetail = err.message;
      } else if (err instanceof StorefrontUrlUnconfiguredError) {
        failureCode = 'storefront_url_unconfigured';
        failureDetail = err.message;
      } else {
        failureCode = 'internal_error';
        failureDetail = err instanceof Error ? err.message : String(err);
      }
      const failed = await this.deps.runs.finish({
        feedId,
        runId,
        status: 'failed',
        counters,
        failureCode,
        failureDetail,
        // A failed run never publishes, and never leaves a partial artefact
        // pointer behind (FR-036).
        artefactId: null,
        startedAtMs,
      });
      // FR-056 — the operator is told, once per transition into failure. The
      // notifier is deliberately awaited: it is a database write, and losing it
      // to process exit would be exactly the silence this exists to prevent.
      await this.deps.notifyFailedRun?.({ feedId, runId, failureCode, failureDetail });
      return failed;
    }
  }

  // -------------------------------------------------------------------------
  // Preparation
  // -------------------------------------------------------------------------

  private async prepare(feedId: string, options: GenerateOptions): Promise<PreparedRun> {
    const em = this.deps.emFactory();
    // `refresh` on purpose: the caller's identity map may still hold the feed
    // as it was before the edit that triggered this run, and a run against a
    // stale selection rule is the kind of bug that only shows up in production.
    const feed = await em.findOneOrFail(ProductFeed, { id: feedId }, { refresh: true });
    const template = await em.findOneOrFail(
      FeedTemplate,
      { id: feed.feedTemplateId },
      { refresh: true },
    );
    const fieldRows = await em.find(
      FeedTemplateField,
      { feedTemplateId: template.id },
      { orderBy: { sortOrder: 'asc' } },
    );
    const unbound = fieldRows.filter((f) => f.unbound).map((f) => f.outputName);
    if (unbound.length > 0) throw new UnboundTemplateError(unbound);

    const salesChannelId = options.overrideSalesChannelId ?? feed.salesChannelId;
    const channel = await em.findOne(SalesChannel, { id: salesChannelId });
    if (!channel || !channel.active) throw new ChannelUnavailableError(salesChannelId);

    // Compile the criteria here, not lazily inside the item stream: an
    // unresolvable attribute must be reported as the configuration error it is
    // (FR-029), and an error raised mid-stream is recorded as a storage failure.
    await this.deps.selection.validateRule(feed.selectionRule);

    const storefrontOrigin = await this.deps.settings.getStringForChannel(
      STOREFRONT_URL_SETTING,
      channel.id,
      process.env['STOREFRONT_BASE_URL'] ?? '',
    );

    // A required `link` field cannot resolve without an origin, so every single
    // item would be skipped as `missing_required_field` and the run would die
    // on the skip threshold — describing the symptom once per product instead
    // of naming the one value that has to change. This is a configuration
    // failure and is reported as one (FR-029).
    const originDependentRequired = fieldRows
      .filter((f) => f.sourceKind === 'link' && f.providerRequired)
      .map((f) => f.outputName);
    if (storefrontOrigin.trim() === '' && originDependentRequired.length > 0) {
      throw new StorefrontUrlUnconfiguredError(channel.code, originDependentRequired);
    }

    const languages = await this.deps.listActiveLanguages();
    const fallbacks = buildLanguageChain(feed.languageCode, languages);

    const context: FeedResolutionContext = {
      languageCode: feed.languageCode,
      languageFallbacks: fallbacks,
      currencyCode: feed.currencyCode,
      pricePresentation: feed.pricePresentation,
      taxCountry: feed.taxCountry ?? null,
      storefrontOrigin,
      salesChannelId: channel.id,
      priceListId: feed.priceListId ?? null,
    };

    // Only pay for the taxonomy read when the template actually binds one.
    const bindsProviderCategory = fieldRows.some(
      (f) => f.sourceKind === 'provider_category',
    );
    const providerCode =
      template.providerCode === 'google_merchant' || template.providerCode === 'meta'
        ? template.providerCode
        : null;
    const taxonomy =
      bindsProviderCategory && providerCode && this.deps.loadTaxonomyResolution
        ? await this.deps.loadTaxonomyResolution(providerCode)
        : null;

    return {
      feed,
      salesChannelId: channel.id,
      channelDefaultCurrency: channel.defaultCurrency,
      channelName: pickChannelName(channel, feed.languageCode),
      taxonomy,
      outputFormat: template.outputFormat,
      itemGranularity: template.itemGranularity,
      fields: fieldRows.map(toResolvableField),
      context,
    };
  }

  private async storeTemplateSnapshot(
    runId: string,
    fields: ResolvableTemplateField[],
  ): Promise<void> {
    const em = this.deps.emFactory();
    await em
      .getConnection()
      .execute(
        `update "product_feed_runs" set "template_snapshot" = ? where "id" = ?`,
        [JSON.stringify(fields), runId],
        'run',
        em.getTransactionContext(),
      );
  }

  private buildSerializer(prepared: PreparedRun): AnyFeedSerializer {
    const columns = prepared.fields.map((f) => f.outputName);
    switch (prepared.outputFormat) {
      case 'xml':
        return new XmlFeedSerializer({
          title: prepared.channelName,
          link: prepared.context.storefrontOrigin,
          description: prepared.feed.name,
        });
      case 'xlsx':
        return new XlsxFeedSerializer({ columns });
      case 'tsv':
        return new DelimitedFeedSerializer({ columns, delimiter: '\t', flavour: 'tsv' });
      case 'txt':
        // Tab-separated like TSV; only the extension and media type differ.
        return new DelimitedFeedSerializer({ columns, delimiter: '\t', flavour: 'txt' });
      case 'csv':
        return new DelimitedFeedSerializer({ columns, delimiter: ',', flavour: 'csv' });
    }
  }

  // -------------------------------------------------------------------------
  // The item source — one batch at a time, never the catalogue
  // -------------------------------------------------------------------------

  private async *itemSource(
    prepared: PreparedRun,
    runId: string,
    counters: RunCounters,
    recordIssue: IssueRecorder,
  ): AsyncGenerator<FeedItemField[]> {
    // command-coverage-ignore: per-item diagnostics (FR-054). The only rows this
    // writes are `product_feed_run_issues`, flushed once per batch; they are the
    // run's own observability data, not a domain change.
    const em = this.deps.emFactory();
    const idPages = this.deps.selection.iterateProductIds({
      salesChannelId: prepared.salesChannelId,
      selectionRule: prepared.feed.selectionRule,
      // A price criterion resolves against exactly the prices this run emits
      // (FR-025, FR-028) — same currency, same list, or none of it happens.
      currencyCode: prepared.context.currencyCode,
      priceListId: prepared.context.priceListId,
    });

    for await (const idPage of idPages) {
      for (let offset = 0; offset < idPage.length; offset += HYDRATE_BATCH_SIZE) {
        const batchIds = idPage.slice(offset, offset + HYDRATE_BATCH_SIZE);
        counters.consideredCount += batchIds.length;
        const sources = await this.hydrateItems(batchIds, prepared);
        await this.deps.runs.heartbeat(runId);

        for (const item of sources) {
          const resolved = this.deps.resolver.resolve({
            fields: prepared.fields,
            item,
            context: prepared.context,
          });
          for (const issue of resolved.issues) {
            if (issue.severity === 'warning') counters.warningCount += 1;
            recordIssue(
              em,
              issue.severity,
              issue.reason,
              { productId: item.productId, variantId: item.variantId, sku: item.sku },
              issue.outputName,
              issue.detail,
            );
          }
          if (resolved.skipped) {
            counters.skippedCount += 1;
            continue;
          }
          counters.emittedCount += 1;
          yield resolved.fields;
        }

        await em.flush();
        // The line that keeps this a streaming job rather than an in-memory one.
        em.clear();
      }
    }
  }

  /**
   * Hydrates one batch of products into resolver input.
   *
   * Public, and taking a {@link FeedItemHydrationScope} rather than a whole
   * prepared run, because the template preview must evaluate a draft against
   * **exactly** what generation would produce (FR-072). A second, preview-only
   * hydration path would drift from this one the first time either changed,
   * and the operator would be shown a value the file never carries.
   */
  async hydrateItems(
    productIds: string[],
    prepared: FeedItemHydrationScope,
  ): Promise<FeedItemSource[]> {
    // The ids arrive already scoped to this channel by `ProductSelectionService`;
    // binding the channel as a local keeps that visible where the reads happen
    // (Principle XII's accessor clause), and it is what availability resolves against.
    const { salesChannelId } = prepared;
    const products = await this.deps.catalogProducts.findByIds(productIds);
    if (products.length === 0) return [];

    // No `EntityManager` here any more: with the gallery select gone, every row
    // this method builds a feed line from belongs to another module and arrives
    // over that module's port.

    // Categories, localized root → leaf.
    //
    // `product_categories` is `catalog`'s bridge table and was joined here in
    // raw SQL — a boundary crossing that names no import specifier, two lines
    // above the `findByIds` that already asked the owner the next question
    // (feature 075, the `product_feeds` shard). The owner answers it now, on its
    // own `EntityManager`: a hydration batch writes nothing to `catalog`, so the
    // transaction context the statement used to carry had nothing of its own to
    // show it.
    //
    // No `activeOnly`. The floor a feed publishes against is
    // `catalogProductFilterPort`'s **sellable product** set, applied by the
    // owner during selection; narrowing the *category path* on top of it would
    // silently blank the `product_category` field of an item the feed is still
    // emitting, which reads as a mapping defect rather than as a filter.
    const categoryRows = await this.deps.catalogCategories.listAssignmentsForProducts(productIds);
    const categoryIds = [...new Set(categoryRows.map((r) => r.categoryId))];
    const categories = categoryIds.length
      ? await this.deps.catalogCategories.findByIds(categoryIds)
      : [];
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    // Images: gallery order is authoritative; only publicly reachable ones survive.
    //
    // `gallery_items` is `catalog`'s table and this was a raw `select` over it
    // — the last of the two reaches in this file, and invisible to
    // `check:module-boundary`'s import predicate for the same reason the
    // category join was: a statement names no specifier (feature 075 / D-87).
    // `listForProducts` is the owner's batch read, added because `list` costs
    // three round-trips per product and a run walks the whole sellable
    // catalogue. The edge binds, exactly as the two reads above it do: a feed
    // assembled out of a module the platform is not serving is worse than a run
    // that stops and records why.
    const galleryRows = await this.deps.catalogGallery.listForProducts(productIds);
    const publicUrls = await this.deps.resolvePublicImageUrls([
      ...new Set(galleryRows.map((r) => r.assetId)),
    ]);

    const availability = await this.deps.resolveAvailability(productIds, salesChannelId);

    const variants =
      prepared.itemGranularity === 'variant'
        ? await this.deps.catalogProducts.listVariantsByProductIds(productIds)
        : [];
    const variantsByProduct = new Map<string, CatalogProductVariantRecord[]>();
    for (const variant of variants) {
      const list = variantsByProduct.get(variant.parentProductId) ?? [];
      list.push(variant);
      variantsByProduct.set(variant.parentProductId, list);
    }

    const out: FeedItemSource[] = [];
    for (const product of products) {
      const productCategoryIds = categoryRows
        .filter((r) => r.productId === product.id)
        .map((r) => r.categoryId);
      const path = this.categoryPath(
        productCategoryIds,
        categoryById,
        prepared.context.languageCode,
      );
      // Deepest mapped ancestor wins, deterministically (FR-080, FR-084).
      const providerCategory = prepared.taxonomy
        ? resolveProviderCategory({
            productCategoryIds,
            categoriesById: prepared.taxonomy.categoriesById,
            mappingsByCategoryId: prepared.taxonomy.mappingsByCategoryId,
          })
        : null;
      const productGallery = galleryRows.filter((r) => r.productId === product.id);
      const images = productGallery
        .map((r) => publicUrls.get(r.assetId))
        .filter((url): url is string => typeof url === 'string');
      const privateImageCount = productGallery.length - images.length;
      const price = await this.resolvePrice(product, null, prepared);
      const stock = availability.get(product.id) ?? null;

      const base: Omit<FeedItemSource, 'variantId' | 'sku' | 'groupingId'> = {
        productId: product.id,
        slug: product.slug,
        productType: product.type,
        name: product.name,
        description: product.description,
        attributes: product.attributeValues,
        // One registry since feature 061 — the same map answers both.
        customFields: product.attributeValues,
        price,
        salePrice: null,
        inStock: stock ? stock.inStock : null,
        stockQuantity: null,
        imageUrls: images,
        privateImageCount,
        categoryPath: path,
        providerCategory: providerCategory?.nodeExternalId ?? null,
        providerCategoryMissReason: providerCategory ? providerCategory.missReason : null,
      };

      const productVariants = variantsByProduct.get(product.id) ?? [];
      if (prepared.itemGranularity === 'variant' && productVariants.length > 0) {
        for (const variant of productVariants) {
          out.push({
            ...base,
            variantId: variant.id,
            sku: variant.sku,
            groupingId: product.id,
          });
        }
        continue;
      }
      // A product with no variants IS the offer, whatever the granularity says.
      out.push({ ...base, variantId: null, sku: product.sku, groupingId: product.id });
    }
    return out;
  }

  /** Deepest assigned category's ancestry, localized. */
  private categoryPath(
    ids: string[],
    byId: Map<string, CatalogCategoryRecord>,
    languageCode: string,
  ): string[] {
    let best: string[] = [];
    for (const id of ids) {
      const chain: string[] = [];
      let current = byId.get(id);
      let guard = 0;
      while (current && guard < 20) {
        chain.unshift(pickLocalizedName(current.name, languageCode));
        current = current.parentCategoryId ? byId.get(current.parentCategoryId) : undefined;
        guard += 1;
      }
      if (chain.length > best.length) best = chain;
    }
    return best;
  }

  private async resolvePrice(
    product: CatalogProductRecord,
    variantId: string | null,
    prepared: FeedItemHydrationScope,
  ): Promise<FeedItemPrice | null> {
    const currencyCode = prepared.context.currencyCode;
    let net: number | null = null;

    if (prepared.context.priceListId) {
      // A named list is used verbatim (FR-020) — no rule evaluation, so the
      // operator gets exactly the prices they pointed at.
      net = await this.deps.resolveNamedListPrice({
        priceListId: prepared.context.priceListId,
        productId: product.id,
        currencyCode,
      });
    } else {
      const resolved = await this.deps.resolveAnonymousPrice({
        product,
        variantId,
        salesChannel: {
          id: prepared.salesChannelId,
          defaultCurrency: prepared.channelDefaultCurrency,
        },
        currencyCode,
      });
      net = resolved ? resolved.amount : null;
    }
    if (net === null) return null;

    if (prepared.context.pricePresentation === 'net') {
      return { net, gross: net, taxResolved: true };
    }
    const country = prepared.context.taxCountry;
    const rate = country
      ? await this.deps.resolveTaxRate({ countryCode: country, productType: product.type })
      : null;
    if (rate === null) {
      // Never a silent zero-VAT price on a gross feed (R12) — the resolver
      // raises `zero_tax_rate_on_gross_feed` from this flag.
      return { net, gross: net, taxResolved: false };
    }
    return { net, gross: round2(net * (1 + rate / 100)), taxResolved: true };
  }
}

class UnboundTemplateError extends Error {
  constructor(public readonly outputNames: string[]) {
    super(`Template fields are not bound to anything: ${outputNames.join(', ')}.`);
    this.name = 'UnboundTemplateError';
  }
}

/**
 * Raised before the catalogue is walked, so the operator gets the setting to
 * change rather than one skipped-item row per product.
 */
class StorefrontUrlUnconfiguredError extends Error {
  constructor(
    public readonly channelCode: string,
    public readonly outputNames: string[],
  ) {
    super(
      `Required ${outputNames.length === 1 ? 'field' : 'fields'} ${outputNames.join(', ')} ` +
        `${outputNames.length === 1 ? 'builds' : 'build'} a product link, but sales channel ` +
        `"${channelCode}" has no storefront URL. Set "${STOREFRONT_URL_SETTING}" for that ` +
        `channel, or the STOREFRONT_BASE_URL environment variable.`,
    );
    this.name = 'StorefrontUrlUnconfiguredError';
  }
}

export interface TaxonomyResolution {
  categoriesById: Map<string, TaxonomyCategoryNode>;
  mappingsByCategoryId: Map<string, TaxonomyMappingRow>;
}

/**
 * Everything {@link FeedGenerationService.hydrateItems} needs, and nothing a
 * *run* has that a *preview* does not — which is what lets the template editor
 * evaluate an unsaved draft through the same code path (FR-072).
 */
export interface FeedItemHydrationScope {
  salesChannelId: string;
  channelDefaultCurrency: string;
  /** Null when nothing binds a provider category, or none is installed. */
  taxonomy: TaxonomyResolution | null;
  itemGranularity: FeedTemplate['itemGranularity'];
  context: FeedResolutionContext;
}

interface PreparedRun extends FeedItemHydrationScope {
  feed: ProductFeed;
  channelName: string;
  outputFormat: FeedTemplate['outputFormat'];
  fields: ResolvableTemplateField[];
}

function toResolvableField(row: FeedTemplateField): ResolvableTemplateField {
  return {
    outputName: row.outputName,
    sourceKind: row.sourceKind,
    sourceKey: row.sourceKey ?? null,
    constantValue: row.constantValue ?? null,
    fallbackValue: row.fallbackValue ?? null,
    providerRequired: row.providerRequired,
    transform: row.transform ?? null,
    transformArg: row.transformArg ?? null,
  };
}

/**
 * The language chain a missing translation walks (FR-040): the language's own
 * configured fallback, then the platform default. Duplicates and self-references
 * are dropped so a misconfigured cycle cannot spin.
 */
export function buildLanguageChain(
  languageCode: string,
  languages: Array<{ code: string; fallbackCode: string | null; isDefault: boolean }>,
): string[] {
  const byCode = new Map(languages.map((l) => [l.code, l]));
  const chain: string[] = [];
  const seen = new Set<string>([languageCode]);
  let current = byCode.get(languageCode)?.fallbackCode ?? null;
  let guard = 0;
  while (current && !seen.has(current) && guard < 10) {
    chain.push(current);
    seen.add(current);
    current = byCode.get(current)?.fallbackCode ?? null;
    guard += 1;
  }
  const platformDefault = languages.find((l) => l.isDefault)?.code;
  if (platformDefault && !seen.has(platformDefault)) chain.push(platformDefault);
  return chain;
}

function pickLocalizedName(map: Record<string, string>, languageCode: string): string {
  const direct = map[languageCode];
  if (typeof direct === 'string' && direct !== '') return direct;
  const first = Object.values(map).find((v) => typeof v === 'string' && v !== '');
  return first ?? '';
}

function pickChannelName(channel: SalesChannel, languageCode: string): string {
  return pickLocalizedName(channel.name ?? {}, languageCode) || channel.code;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
