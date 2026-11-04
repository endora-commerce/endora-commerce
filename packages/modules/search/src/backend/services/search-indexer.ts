import type { EntityManager } from '@mikro-orm/postgresql';
import { Meilisearch, type Index } from 'meilisearch';
import {
  type CatalogAttributeReadPort,
  type CatalogAttributeView,
  type CatalogCategoryReadPort,
  type CatalogProductReadPort,
  type CatalogProductAvailabilityPort,
  type CatalogProductRecord,
  type CatalogProductValueOverrideRecord,
  type ChannelAvailability,
  type OverrideRow,
} from '@endora-commerce/contracts';
import {
  AVAILABILITY_FILTERABLE_ATTRIBUTES,
  documentAvailabilityFields,
  pendingAvailabilitySettings,
} from './search-availability.js';
import {
  SEARCHABLE_ATTRIBUTES,
  documentAttributes,
  documentTexts,
  indexLanguagesOf,
  sortableAttributesFor,
  type DocumentTexts,
  type SearchableTextAttribute,
} from './search-document.js';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { DEFAULT_INDEX_TASK_TIMEOUT_SECONDS, SEARCH_SETTING_CODES } from '../../manifest.js';

/**
 * SearchIndexer (T067 — initial offline path).
 *
 * Pushes the public product surface into a Meilisearch index per Sales
 * Channel. Today the storefront catalog list still runs through Postgres
 * (`catalog-query.service.ts`); the index is consumed once T068
 * (`search-query.service.ts`) ships. Until then this indexer is the
 * groundwork — populating it on every catalog mutation keeps the index
 * fresh so the cut-over is a single-line change in the read path.
 *
 * The indexer is intentionally idempotent: each call upserts every
 * product into the channel index and reapplies the searchable / filterable /
 * sortable settings — the first two derived from the live `product_attributes`
 * rows, the third fixed by {@link SORTABLE_ATTRIBUTES}. Re-running it after a
 * shape change is the right way to reindex, and the only way to add a document
 * field that was not written before.
 */

/**
 * How many member ids one `listEntityIdsForChannel` page carries. The accessor
 * is paginated and defaults to 100; a full channel reindex wants the whole
 * assortment, so the pages are walked to `total` — the shape `seo`'s sitemap
 * generator settled on for the same read.
 */
const MEMBERSHIP_PAGE_SIZE = 500;

/**
 * The document fields a channel index may be sorted on — issue #287.
 *
 * Meilisearch refuses a sort on any field outside `sortableAttributes`, and
 * this indexer never called `updateSortableAttributes`, so the setting was `[]`
 * on all five live indexes and `name:asc` came back as `invalid_search_sort`.
 *
 * The declaration is single on purpose: `sortableAttributesFor` (`search-document.ts`) is what
 * the indexer applies to every index **and** the alphabet `buildSort` may emit (its return type
 * is built from {@link SortableAttribute}). Feature 172 — the name is sorted in the shopper's
 * language, `texts.<L>.name`, declared for every language the channel offers. `updatedAt` is
 * deliberately absent: no sort token names it.
 */
/** One sortable field of a channel index. */
export type SortableAttribute = 'createdAt' | `texts.${string}.name`;

export interface SearchIndexerOptions {
  meilisearchHost?: string;
  meilisearchApiKey?: string;
  /**
   * Retired by feature 172: a document carries every channel language's texts, so there is no
   * one indexed locale. Accepted and ignored, so a caller passing it keeps compiling.
   */
  locale?: string;
  /**
   * Feature 061 — the catalog's composed attribute read model (Principle I:
   * replaces the former direct `ProductAttribute` entity find + raw
   * `attribute_options` SQL). Required — the searchable/filterable settings
   * and the option-label aggregation are derived from it.
   *
   * Feature 075, Phase C — typed as the published port rather than `catalog`'s
   * service class, so this module names no file in `catalog`'s directory.
   */
  attributeRead: CatalogAttributeReadPort;
  /**
   * Feature 075, Phase C — the product rows an index document is built from.
   *
   * They used to be `em.find(Product, …)` / `em.findOne(Product, …)` against
   * `catalog`'s table from inside this module, which is the shape Principle
   * XVII cannot gate: deactivation drops no tables, so the indexer kept
   * rewriting Meilisearch documents out of a module an operator had switched
   * off. Through the port the same read answers 503 `MODULE_DISABLED`, which is
   * the binding `catalog` dependency this module's manifest declares.
   */
  products: CatalogProductReadPort;
  /**
   * Feature 075 / D-87 — the `product ↔ category` assignments and the category
   * subtree an index document projects.
   *
   * They were three raw joins over `catalog`'s `product_categories` and
   * `categories` from inside this file. Raw SQL names no import specifier, so
   * Phase C's port conversion walked straight past them and they kept
   * answering with `catalog` switched off, exactly as the entity reads had.
   */
  categories: CatalogCategoryReadPort;
  /**
   * The `sales_channel_products` bridge, through the accessor Principle XII
   * reserves it for. Two statements here read the table directly — the
   * membership of one product, and the assortment of one channel joined to
   * `products` — which is the clause `SalesChannelMembershipPort`'s own doc
   * comment states and the sweep found this module breaking.
   */
  channelMembership: SalesChannelMembershipPort;
  /**
   * Feature 163 — `catalog`'s availability projection per channel (R8): which
   * members are on in which channel language, with the effective window and
   * audience a document carries. Required: an index built without it would
   * publish products switched off where they are off.
   */
  availability: Pick<CatalogProductAvailabilityPort, 'describeChannelAvailability'>;
  /**
   * How long to wait for one Meilisearch task, in milliseconds, re-read per
   * wait so an operator raising `search.index_task_timeout_seconds` takes
   * effect without a restart — the property `search.reindex_interval_minutes`
   * already has, and for the same reason: the operator who needs to change it
   * is mid-incident.
   *
   * Optional, and this one genuinely is: absent, it answers the manifest
   * default, which is the same number the Setting defaults to. That is not the
   * "optional option that silently produced a lesser module" this module's
   * `backend/index.ts` records six of — there is no lesser behaviour to
   * produce, only the same number reached without a settings round trip. It is
   * what lets a test construct an indexer without composing the settings store.
   */
  resolveTaskTimeoutMs?: () => Promise<number>;
}

/**
 * A document carries **no price**, and the omission is deliberate (issue #287).
 *
 * It used to carry `price: number | null`, copied from the legacy
 * `attributes.defaultPrice` — a catalogue attribute, not any price list's
 * figure. Nothing on the query path read it: `listProducts` never asked for it
 * in `attributesToRetrieve`, and hydrates the viewer's price from
 * `price_lists` through the pricing port precisely so the index cannot decide
 * what a buyer pays. What the field did do was sit in every document, already
 * numeric and already called `price`, waiting for the first "sort by price"
 * implementation to reach for it and quietly order a negotiated-price buyer's
 * listing by a legacy attribute.
 *
 * A per-buyer price cannot live here in any case: there is one index per sales
 * channel and one document per product, so pricing the document would multiply
 * the corpus by the customer base. Feature 086 sorts by price without
 * Meilisearch for that reason. The legacy attribute itself is gone: feature 160
 * stripped `defaultPrice` and `price` from every product (FR-042), so a product
 * has no price of its own to index.
 */
export interface IndexedDocument {
  id: string;
  sku: string;
  type: string;
  status: string;
  visibility: string;
  slug: string;
  primaryAssetUrl: string | null;
  categoryIds: string[];
  categorySlugs: string[];
  // Flattened attribute values. Meilisearch's filtering is type-tolerant
  // for primitive values. A multiselect is the array of its options, each
  // rendered as `String` renders it: an equality filter on an array field
  // matches when any element equals the value (issue #684), which is what
  // `filter[attr.<key>]` means on the Postgres listing too. Any other
  // complex value is its JSON text, which no filter is built against.
  // Feature 172 — the values of searchable text attributes no filter names
  // are not here: they are searched in `texts.<L>.attributes`, at the
  // shopper's language.
  attributes: Record<string, string | number | boolean | string[] | null>;
  /**
   * Feature 172 (`contracts/search-index.md` §1, FR-033) — per language the channel offers, the
   * texts effective at (channel, L): name, description, searchable text attributes and the
   * option labels of searchable select attributes in L. A query in L searches `texts.<L>.*`.
   */
  texts: Record<string, DocumentTexts>;
  /**
   * Epoch milliseconds. Sortable — it is what `-createdAt` means, on both
   * backends of the listing route (issue #287).
   */
  createdAt: number;
  /** Epoch milliseconds. The freshness marker; no sort token names it. */
  updatedAt: number;
  /**
   * Feature 163 (R8, data-model §11) — the channel languages the product is
   * effectively on in, its effective window and its channel-effective audience
   * (`visibility` above is the channel-effective one too). Filter inputs; the
   * query never retrieves the allow-list. See `search-availability.ts`.
   */
  liveLanguages: string[];
  publishFromMs: number;
  publishUntilMs: number;
  allowedOrganizationIds: string[];
}

/**
 * The default wait, in milliseconds. Derived from the manifest so the constant
 * and the Setting's default cannot drift into two answers.
 */
export const DEFAULT_INDEX_TASK_TIMEOUT_MS = DEFAULT_INDEX_TASK_TIMEOUT_SECONDS * 1000;

/**
 * A Meilisearch task came back in a state that is not `succeeded`.
 *
 * This error exists because `waitForTask` **does not throw for a task that
 * failed** — it resolves, carrying `status: 'failed'` and Meilisearch's own
 * `error` object. Every one of this file's twelve waits discarded that value,
 * so a refused document batch, a rejected settings update and an applied one
 * were the same thing to the caller: `reindexChannel` went on to report a
 * document count for an index Meilisearch had written nothing into.
 */
export class SearchIndexTaskFailed extends Error {
  readonly taskUid: number;
  readonly what: string;
  readonly status: string;
  /** Meilisearch's own error code, e.g. `missing_document_id`. */
  readonly meilisearchCode: string | undefined;

  constructor(args: {
    taskUid: number;
    what: string;
    status: string;
    meilisearchCode?: string | undefined;
    detail?: string | undefined;
  }) {
    super(
      `Meilisearch ${args.what} (task ${args.taskUid}) came back "${args.status}"` +
        (args.meilisearchCode ? ` [${args.meilisearchCode}]` : '') +
        (args.detail ? `: ${args.detail}` : ''),
    );
    this.name = 'SearchIndexTaskFailed';
    this.taskUid = args.taskUid;
    this.what = args.what;
    this.status = args.status;
    this.meilisearchCode = args.meilisearchCode;
  }
}

/**
 * The wait expired. The task is **still running** — Meilisearch was never told
 * to stop, because giving up on a wait cancels nothing.
 *
 * It is a separate error from {@link SearchIndexTaskFailed} on purpose, and the
 * separation is the point of the repair rather than a nicety: the two arrive at
 * an operator with opposite remedies. This one says "the queue outlasted the
 * wait — raise `search.index_task_timeout_seconds`, or let the instance drain";
 * the other says "the write was refused, and here is what Meilisearch said".
 * Under the client's 5000 ms default these were one symptom, and it was the
 * benign one that was raised while the malignant one was silent.
 */
export class SearchIndexTaskStillRunning extends Error {
  readonly taskUid: number;
  readonly what: string;
  readonly timeoutMs: number;

  constructor(args: { taskUid: number; what: string; timeoutMs: number }) {
    super(
      `Meilisearch ${args.what} (task ${args.taskUid}) is still running after ` +
        `${args.timeoutMs} ms. The task was not cancelled and may yet succeed. If this ` +
        `instance is busy or the catalogue is large, raise ` +
        `"${SEARCH_SETTING_CODES.INDEX_TASK_TIMEOUT_SECONDS}".`,
    );
    this.name = 'SearchIndexTaskStillRunning';
    this.taskUid = args.taskUid;
    this.what = args.what;
    this.timeoutMs = args.timeoutMs;
  }
}

/** The slice of the Meilisearch task client this module waits through. */
interface TaskWaiter {
  waitForTask(
    taskUid: number,
    options: { timeout: number },
  ): Promise<{ status: string; error?: { message?: string; code?: string } | null }>;
}

/**
 * Wait for one Meilisearch task and give its three outcomes three names.
 *
 * This is the **only** place this module awaits a task, which is what makes the
 * timeout one number rather than eleven literals, and what makes the
 * failed-status check impossible to forget at the thirteenth call site.
 *
 * `tolerate` names Meilisearch error codes that are an expected, benign outcome
 * for **this** wait, and it is deliberately a per-call argument rather than a
 * blanket leniency: the one caller that needs it is `ensureIndex`, whose
 * `index_already_exists` is another process having created the index first —
 * which satisfies the postcondition rather than violating it.
 */
export async function awaitIndexTask(
  tasks: TaskWaiter,
  task: { taskUid: number },
  what: string,
  timeoutMs: number,
  tolerate: readonly string[] = [],
): Promise<void> {
  let settled: Awaited<ReturnType<TaskWaiter['waitForTask']>>;
  try {
    settled = await tasks.waitForTask(task.taskUid, { timeout: timeoutMs });
  } catch (error) {
    // Matched on `name` rather than on the class: this module holds no value
    // import of the client's error types, and the name is what the client sets.
    if (error instanceof Error && error.name === 'MeilisearchTaskTimeOutError') {
      throw new SearchIndexTaskStillRunning({
        taskUid: task.taskUid,
        what,
        timeoutMs,
      });
    }
    // Anything else — an unreachable host, an auth refusal — is not this
    // function's to interpret and is not swallowed.
    throw error;
  }

  if (settled.status === 'succeeded') return;
  const code = settled.error?.code;
  if (code !== undefined && tolerate.includes(code)) return;
  throw new SearchIndexTaskFailed({
    taskUid: task.taskUid,
    what,
    status: settled.status,
    meilisearchCode: code,
    detail: settled.error?.message,
  });
}

/**
 * Feature 172 (code review, note 5) — what one indexing run reads once and every channel batch
 * of the run shares: the searchable select attributes and, per language, their option labels.
 * A run is one {@link SearchIndexer.reindexAllChannels}, one {@link SearchIndexer.ensureQuerySettings},
 * one category-subtree reindex or one incremental upsert; the next run reads them again, so a
 * relabelled option reaches it.
 */
export interface IndexingRun {
  searchableOptionAttributes?: Promise<CatalogAttributeView[]>;
  readonly optionLabels: Map<string, Map<string, Map<string, string>>>;
}

export function newIndexingRun(): IndexingRun {
  return { optionLabels: new Map() };
}

export class SearchIndexer {
  private readonly client: Meilisearch;
  private readonly attributeRead: CatalogAttributeReadPort;
  private readonly products: CatalogProductReadPort;
  private readonly categories: CatalogCategoryReadPort;
  private readonly channelMembership: SalesChannelMembershipPort;
  private readonly availability: Pick<CatalogProductAvailabilityPort, 'describeChannelAvailability'>;
  private readonly resolveTaskTimeoutMs: () => Promise<number>;

  constructor(options: SearchIndexerOptions) {
    const host =
      options.meilisearchHost ??
      process.env['MEILISEARCH_URL'] ??
      'http://localhost:7700';
    const apiKey =
      options.meilisearchApiKey ??
      process.env['MEILISEARCH_API_KEY'] ??
      undefined;
    this.client = new Meilisearch(apiKey ? { host, apiKey } : { host });
    this.attributeRead = options.attributeRead;
    this.products = options.products;
    this.categories = options.categories;
    this.channelMembership = options.channelMembership;
    this.availability = options.availability;
    this.resolveTaskTimeoutMs =
      options.resolveTaskTimeoutMs ?? (async () => DEFAULT_INDEX_TASK_TIMEOUT_MS);
  }

  /**
   * Every Meilisearch task this module waits for goes through here — see
   * {@link awaitIndexTask} for why the wait has one home and three outcomes.
   */
  private async awaitTask(
    task: { taskUid: number },
    what: string,
    tolerate: readonly string[] = [],
  ): Promise<void> {
    await awaitIndexTask(
      this.client.tasks,
      task,
      what,
      await this.resolveTaskTimeoutMs(),
      tolerate,
    );
  }

  /**
   * Drop + recreate the channel index, reapply the searchable / filterable /
   * sortable settings, then push every product visible in that channel.
   * Returns counts so callers can log a summary.
   */
  async reindexChannel(em: EntityManager, channel: SalesChannel, run: IndexingRun = newIndexingRun()): Promise<{
    indexUid: string;
    documentCount: number;
    searchableAttributes: string[];
    filterableAttributes: string[];
    sortableAttributes: string[];
  }> {
    const indexUid = indexUidFor(channel);
    const index = await this.ensureIndex(indexUid);

    // The membership accessor answers which products the channel carries;
    // `catalog` answers which of them are on in at least one channel language
    // (feature 163, R8) — the one definition of publishable, shared with the
    // incremental upsert. No status is tested here.
    const memberIds = await this.channelMemberProductIds(channel.id);
    const availability = await this.availability.describeChannelAvailability(memberIds, channel.id);
    const products = (await this.products.findByIds(memberIds)).filter((p) =>
      isPublishableIn(availability.get(p.id)),
    );
    const productIds = products.map((p) => p.id);
    // Feature 068 — an inactive category must not survive in the indexed
    // `categorySlugs`, or it keeps working as a storefront PLP filter.
    const categoryRows = await this.categories.listAssignmentsForProducts(productIds, {
      activeOnly: true,
    });
    const categoriesByProduct = new Map<string, Array<{ id: string; slug: string }>>();
    for (const row of categoryRows) {
      const list = categoriesByProduct.get(row.productId) ?? [];
      list.push({ id: row.categoryId, slug: row.slug });
      categoriesByProduct.set(row.productId, list);
    }

    // Feature 172 (`contracts/search-index.md` §2) — the texts of every channel language, from
    // one read of this batch's override rows and of the searchable attributes.
    const languages = indexLanguagesOf(channel);
    const textInputs = await this.textInputs(em, languages, productIds, run);
    const documents: IndexedDocument[] = products.map((p) =>
      buildDocument(p, categoriesByProduct.get(p.id) ?? [], availability.get(p.id)!, {
        ...textInputs,
        channelId: channel.id,
        languages,
      }),
    );

    // Wipe the index first so removed-from-channel products disappear from
    // search. The offline reindex contract is "the index after this call
    // exactly mirrors Postgres for this channel". Event-driven incremental
    // reindex is a separate code path that can upsert without wiping.
    const wipeTask = await index.deleteAllDocuments();
    // O(the corpus being dropped). A wait that expires here is the worst of the
    // twelve: the documents are already gone and the push below never runs, so
    // an index that was merely slow is left empty.
    await this.awaitTask(wipeTask, `wipe of ${indexUid}`);

    // The settings go in while the index is empty, and that ordering is the
    // whole reason they moved here from after the document push (issue #287).
    // A settings update re-indexes the corpus it lands on, so on an empty
    // index it is instant and can be awaited without risking the task-wait
    // timeout a large channel would blow through — and awaiting it is what
    // makes this method's postcondition true on return. Applied afterwards,
    // every sorted query in the window between the document task settling and
    // the settings task settling was answered `invalid_search_sort` and
    // degraded to Postgres.
    const { searchable, filterable } = await this.attributeSettings();
    const sortable = sortableAttributesFor(languages);
    const settingsTasks = await Promise.all([
      index.updateSearchableAttributes(searchable),
      index.updateFilterableAttributes(filterable),
      index.updateSortableAttributes(sortable),
    ]);
    for (const task of settingsTasks) {
      // O(1) by construction — this is the ordering the comment above is about.
      // The wait is still not free: it queues behind whatever else the instance
      // is doing, which is the term no site here controls.
      await this.awaitTask(task, `index settings for ${indexUid}`);
    }

    if (documents.length > 0) {
      const task = await index.addDocuments(documents, { primaryKey: 'id' });
      // Wait for the task to settle so the documents are queryable when
      // this method returns. Production callers (event-driven reindex)
      // could fire-and-forget; the offline reindex CLI + tests both want
      // the synchronous guarantee.
      await this.awaitTask(task, `${documents.length}-document push to ${indexUid}`);
    }

    return {
      indexUid,
      documentCount: documents.length,
      searchableAttributes: searchable,
      filterableAttributes: filterable,
      sortableAttributes: sortable,
    };
  }

  /**
   * Incremental upsert of a single product into every channel index that
   * publishes it. Used by the event-driven subscriber. Performs no index
   * wipe and no setting changes — just a per-channel `addDocuments` (Meili
   * upsert semantics) for the channels the product currently belongs to,
   * plus a `deleteDocument` from any channel index it was removed from.
   *
   * Returns the channel codes that were touched so callers can log a
   * one-line summary.
   */
  async upsertProduct(em: EntityManager, productId: string, run: IndexingRun = newIndexingRun()): Promise<string[]> {
    const product = await this.products.findById(productId);
    if (!product) return [];

    const channels = await em.find(SalesChannel, {});
    const linkedChannelIds = new Set(
      (await this.channelMembership.listChannelsForEntity('product', productId)).map((c) => c.id),
    );

    // Feature 068 — same activation filter as the full reindex.
    const categoryRows = await this.categories.listAssignmentsForProducts([productId], {
      activeOnly: true,
    });
    const categories = categoryRows.map((r) => ({ id: r.categoryId, slug: r.slug }));
    // Feature 172 — the override rows and searchable attributes once; the texts per channel below.
    const allLanguages = [...new Set(channels.flatMap((channel) => indexLanguagesOf(channel)))];
    const textInputs = await this.textInputs(em, allLanguages, [productId], run);

    const touched: string[] = [];
    for (const channel of channels) {
      const indexUid = indexUidFor(channel);
      const index = await this.ensureIndex(indexUid);
      // Feature 163 — on in at least one language of this channel, as `catalog`
      // answers it; a non-member is absent from the answer.
      const availability = linkedChannelIds.has(channel.id)
        ? (await this.availability.describeChannelAvailability([productId], channel.id)).get(productId)
        : undefined;
      if (availability !== undefined && isPublishableIn(availability)) {
        const document = buildDocument(product, categories, availability, {
          ...textInputs,
          channelId: channel.id,
          languages: indexLanguagesOf(channel),
        });
        const task = await index.addDocuments([document], { primaryKey: 'id' });
        await this.awaitTask(task, `upsert of product ${productId} into ${indexUid}`);
      } else {
        // Either unlinked or no longer publishable — make sure the doc is gone.
        const task = await index.deleteDocument(productId);
        await this.awaitTask(task, `removal of product ${productId} from ${indexUid}`);
      }
      touched.push(channel.code);
    }
    return touched;
  }

  /**
   * Feature 068 — re-index every product assigned to a category or any of its
   * descendants. Called on `category.updated.v1`: a renamed or deactivated
   * category changes the `categorySlugs` projection of its products, and a
   * stale projection keeps a hidden category working as a PLP filter.
   *
   * The subtree walk and the de-duplication both belong to `catalog`, which
   * owns `categories` and `product_categories`; this module used to run the
   * recursive query itself. Returns the number of products re-indexed.
   */
  async reindexCategorySubtree(em: EntityManager, categoryId: string): Promise<number> {
    const productIds = await this.categories.listProductIdsInSubtree(categoryId);
    // One run for the whole subtree: the option labels are read once, not once per product.
    const run = newIndexingRun();
    for (const productId of productIds) {
      await this.upsertProduct(em, productId, run);
    }
    return productIds.length;
  }

  /**
   * Drop a product from every channel index. Called on
   * `product.archived.v1` and on hard delete.
   */
  async deleteProduct(em: EntityManager, productId: string): Promise<string[]> {
    const channels = await em.find(SalesChannel, {});
    const touched: string[] = [];
    for (const channel of channels) {
      const indexUid = indexUidFor(channel);
      const index = await this.ensureIndex(indexUid);
      const task = await index.deleteDocument(productId);
      await this.awaitTask(task, `deletion of product ${productId} from ${indexUid}`);
      touched.push(channel.code);
    }
    return touched;
  }

  /**
   * Re-apply searchable + filterable attribute settings on every channel
   * index, derived from the live `product_attributes` rows. Called on
   * `attribute.updated.v1` so a flipped `isFilterable` / `isSearchable`
   * propagates without a full reindex.
   *
   * It reapplies {@link SORTABLE_ATTRIBUTES} too, which is what lets an index
   * built before issue #287 regain `name` sorting without waiting for a full
   * reindex — the documents already carry the field. `createdAt` does not: a
   * field that was never written has to be reindexed in.
   */
  async refreshAttributeSettings(em: EntityManager): Promise<string[]> {
    const channels = await em.find(SalesChannel, {});
    // Feature 172 — the searchable set is fixed (`texts`, `sku`, `attributes`); which attribute
    // a query searches is the query's `attributesToSearchOn`, so a flipped `isSearchable` on a
    // text or select attribute takes effect at the next reindex of its documents' texts.
    const { searchable, filterable } = await this.attributeSettings();
    const touched: string[] = [];
    for (const channel of channels) {
      const indexUid = indexUidFor(channel);
      const index = await this.ensureIndex(indexUid);
      const searchableTask = await index.updateSearchableAttributes(searchable);
      const filterableTask = await index.updateFilterableAttributes(filterable);
      const sortableTask = await index.updateSortableAttributes(sortableAttributesFor(indexLanguagesOf(channel)));
      // Settings updates are async tasks; wait so callers reading the
      // settings immediately after see the new values.
      // Unlike the identical-looking three in `reindexChannel`, these land on
      // a **populated** index, and a settings update re-indexes the corpus it
      // lands on — so these are O(corpus) where those are O(1). It is the
      // sharpest illustration of why the old per-site literals were not a
      // considered set: the three cheapest waits and the three most expensive
      // ones both took the client default by omission.
      await this.awaitTask(searchableTask, `searchable attributes for ${indexUid}`);
      await this.awaitTask(filterableTask, `filterable attributes for ${indexUid}`);
      await this.awaitTask(sortableTask, `sortable attributes for ${indexUid}`);
      touched.push(channel.code);
    }
    return touched;
  }

  /**
   * Feature 163 (code review W1) — bring every **existing** channel index up to
   * the settings this release's queries need, without a reindex: the
   * availability fields filterable and the language-keyed `texts` searched. Run once at
   * boot. An index already carrying them is only read (one settings read per
   * channel); one built before the upgrade gets the missing settings once, so
   * its queries stop falling back to Postgres. Documents indexed before the
   * upgrade carry none of the fields and are served as before (R8) until the
   * reindex the release note asks for. A channel with no index yet is left to
   * its first reindex, which writes every setting.
   */
  async ensureQuerySettings(em: EntityManager): Promise<string[]> {
    const channels = await em.find(SalesChannel, {});
    const wanted = await this.attributeSettings();
    const run = newIndexingRun();
    const touched: string[] = [];
    for (const channel of channels) {
      const indexUid = indexUidFor(channel);
      let index: Index;
      try {
        index = await this.client.getIndex(indexUid);
      } catch {
        continue;
      }
      const [filterable, searchable] = await Promise.all([
        index.getFilterableAttributes(),
        index.getSearchableAttributes(),
      ]);
      const pending = pendingAvailabilitySettings(
        {
          filterable: (filterable ?? []).flatMap((f) => (typeof f === 'string' ? [f] : f.attributePatterns)),
          searchable: searchable ?? ['*'],
        },
        wanted,
      );
      // Feature 172 (`contracts/search-index.md` §2) — a pre-172 index has no `texts` in its
      // documents: reindex the channel, which writes every setting with the documents.
      if (pending.reindex) {
        await this.reindexChannel(em, channel, run);
        touched.push(channel.code);
        continue;
      }
      if (pending.filterable) {
        const task = await index.updateFilterableAttributes(pending.filterable);
        await this.awaitTask(task, `filterable attributes for ${indexUid}`);
        touched.push(channel.code);
      }
    }
    return touched;
  }

  async reindexAllChannels(em: EntityManager): Promise<
    Array<{ channelCode: string; indexUid: string; documentCount: number }>
  > {
    const channels = await em.find(SalesChannel, {});
    const results: Array<{ channelCode: string; indexUid: string; documentCount: number }> = [];
    // One run for every channel: the option labels are read once, not per channel per language.
    const run = newIndexingRun();
    for (const channel of channels) {
      const summary = await this.reindexChannel(em, channel, run);
      results.push({
        channelCode: channel.code,
        indexUid: summary.indexUid,
        documentCount: summary.documentCount,
      });
    }
    return results;
  }

  /**
   * Attach a Meilisearch embedder to a single channel index — feature 006 / T026.
   *
   * Wires Meilisearch's hybrid lexical + semantic search ("AI-augmented
   * search"). Once attached, queries automatically blend keyword and
   * vector scoring; the storefront does not change behaviour beyond
   * ranking. We register the embedder under the well-known name
   * `default` so callers do not have to thread the name through.
   *
   * Uses the `openAi` embedder source — accepts a custom `url`, so it
   * works against any OpenAI-compatible endpoint (OpenAI itself, Azure
   * OpenAI, Ollama's OpenAI shim, etc.). When the operator needs a
   * non-OpenAI-shaped provider, the manifest can later expose
   * `search.llm.embedder_source` with a discriminated union; out of
   * scope for the MVP toggle.
   */
  async attachEmbedderForChannel(
    channelCode: string,
    config: { url: string; apiKey: string; model: string },
  ): Promise<void> {
    const indexUid = indexUidFor({ code: channelCode });
    const index = await this.ensureIndex(indexUid);
    const task = await index.updateEmbedders({
      default: {
        source: 'openAi',
        url: config.url,
        apiKey: config.apiKey,
        model: config.model,
      },
    });
    // This site and `detachEmbedderForChannel` were the two that already
    // carried a literal, `{ timeout: 30_000 }`, for the stated reason that
    // Meilisearch may validate the embedder URL server-side. The reason was
    // right and the remedy was local: nine sibling waits kept the 5 s default
    // for no reason at all. Both now take the module-wide value, which is
    // larger than the 30 s they asked for, so neither loses anything.
    await this.awaitTask(task, `embedder attach on ${indexUid}`);
  }

  /**
   * Detach the embedder from a single channel index — feature 006 / T026.
   * Reverses {@link attachEmbedderForChannel} so the channel falls back
   * to plain lexical ranking.
   */
  async detachEmbedderForChannel(channelCode: string): Promise<void> {
    const indexUid = indexUidFor({ code: channelCode });
    const index = await this.ensureIndex(indexUid);
    const task = await index.resetEmbedders();
    await this.awaitTask(task, `embedder detach on ${indexUid}`);
  }

  /**
   * Feature 012 / FR-035 — build a per-call lookup of (attributeKey,
   * value) → resolved per-locale option label, restricted to attributes
   * that are isSearchable AND of a select-style type. Used by
   * buildDocument() to fill the `searchableOptions` array on each
   * indexed document so storefront search hits the customer-visible
   * label, not the raw option value.
   *
   * The lookup is constructed in two queries (attribute set + option
   * set) so the per-product loop stays O(1).
   */
  async loadSearchableOptionLookup(
    _em: EntityManager,
    locale: string,
  ): Promise<Map<string, Map<string, string>>> {
    return optionLookupIn(await this.searchableOptionAttributes(), locale);
  }

  /**
   * Feature 061 — the option labels come from the composed view (backed by
   * `custom_field_options`), restricted to isSearchable select-style
   * attributes; no raw SQL against catalog storage.
   */
  private async searchableOptionAttributes(): Promise<CatalogAttributeView[]> {
    return (await this.attributeRead.listByFlag('isSearchable')).filter(
      (a) =>
        a.valueType === 'select' || a.valueType === 'enum' || a.valueType === 'multiselect',
    );
  }

  /**
   * Feature 061 — derive per-index searchable/filterable settings from the view. Feature 172
   * (`contracts/search-index.md` §2) — the searchable set is the language-keyed `texts`, the SKU
   * and the attribute values; which of them a query reads is its `attributesToSearchOn`.
   */
  private async attributeSettings(): Promise<{
    searchable: string[];
    filterable: string[];
  }> {
    const attributes = await this.attributeRead.listAll();
    const filterable: string[] = [
      'categoryIds',
      'categorySlugs',
      'status',
      // Feature 163 — `visibility` among them (R8).
      ...AVAILABILITY_FILTERABLE_ATTRIBUTES,
    ];
    for (const attr of attributes) {
      if (attr.isFilterable) filterable.push(`attributes.${attr.key}`);
    }
    return { searchable: [...SEARCHABLE_ATTRIBUTES], filterable };
  }

  /**
   * Feature 172 — what every document of a batch needs for its `texts`: each product's override
   * rows (every channel; {@link documentTexts} reads the document's own), the searchable text
   * attributes with their scope sets, the option labels of the searchable select attributes per
   * language (read once per `run`), and the text keys `attributes` leaves out (searchable, filtered by nothing).
   */
  private async textInputs(
    _em: EntityManager,
    languages: readonly string[],
    productIds: readonly string[],
    run: IndexingRun,
  ): Promise<{
    overridesByProduct: Map<string, OverrideRow[]>;
    textAttributes: SearchableTextAttribute[];
    optionLabels: Map<string, Map<string, Map<string, string>>>;
    textKeys: Set<string>;
  }> {
    const [rows, attributes] = await Promise.all([
      productIds.length > 0 ? this.products.listValueOverridesByProductIds([...productIds]) : Promise.resolve([]),
      this.attributeRead.listAll(),
    ]);
    const textAttributes = attributes
      .filter((a) => a.isSearchable && a.valueType === 'string')
      .map((a) => ({ key: a.key, scopeLevels: a.scopeLevels }));
    const optionLabels = new Map<string, Map<string, Map<string, string>>>();
    for (const language of languages) {
      let lookup = run.optionLabels.get(language);
      if (!lookup) {
        run.searchableOptionAttributes ??= this.searchableOptionAttributes();
        lookup = optionLookupIn(await run.searchableOptionAttributes, language);
        run.optionLabels.set(language, lookup);
      }
      optionLabels.set(language, lookup);
    }
    const overridesByProduct = new Map<string, OverrideRow[]>();
    for (const o of rows as CatalogProductValueOverrideRecord[]) {
      const list = overridesByProduct.get(o.productId) ?? [];
      list.push({ attributeKey: o.attributeKey, channelId: o.channelId, languageCode: o.languageCode ?? null, value: o.value });
      overridesByProduct.set(o.productId, list);
    }
    return {
      overridesByProduct,
      textAttributes,
      optionLabels,
      textKeys: new Set(
        attributes.filter((a) => a.isSearchable && a.valueType === 'string' && !a.isFilterable).map((a) => a.key),
      ),
    };
  }

  private async ensureIndex(uid: string): Promise<Index> {
    try {
      return await this.client.getIndex(uid);
    } catch {
      const task = await this.client.createIndex(uid, { primaryKey: 'id' });
      // `index_already_exists` is tolerated, and it is the one site in this
      // file where a failed task is an expected outcome rather than a defect:
      // this method is a check-then-create with no lock, so two processes
      // indexing the same channel both miss `getIndex` and both create. The
      // loser's task fails and the index is there, which is the whole
      // postcondition. Measured: a second `createIndex` returns a task with
      // `status: 'failed'`, `code: 'index_already_exists'`.
      await this.awaitTask(task, `index create for ${uid}`, ['index_already_exists']);
      return this.client.getIndex(uid);
    }
  }

  /**
   * Every product id the channel carries, not the first page of them.
   * `listEntityIdsForChannel` is paginated and a full reindex wants the whole
   * assortment, so the pages are walked to `total`. `total` is re-read on each
   * call and the loop is bounded by it, so a concurrent membership write cannot
   * spin it — the shape `seo`'s sitemap generator settled on for this read.
   */
  private async channelMemberProductIds(channelId: string): Promise<string[]> {
    const ids = new Set<string>();
    for (let page = 0; ; page += 1) {
      const { entityIds, total } = await this.channelMembership.listEntityIdsForChannel(
        channelId,
        'product',
        page,
        MEMBERSHIP_PAGE_SIZE,
      );
      for (const id of entityIds) ids.add(id);
      if (entityIds.length === 0 || ids.size >= total) return [...ids];
    }
  }
}

/**
 * What a channel index carries (feature 163, R8): a channel member that is
 * effectively on in at least one channel language. `catalog` answers it —
 * archived and soft-deleted products are on in no language — and the query's
 * filter narrows to the request's language, window and audience.
 */
function isPublishableIn(availability: ChannelAvailability | undefined): boolean {
  return availability !== undefined && availability.liveLanguages.length > 0;
}

/**
 * Feature 012 / FR-035 — (attributeKey, value) → the option label in `locale`. Feature 172
 * (FR-033) — the label in `locale` itself, else the option's default label: never another
 * language's label, which a shopper of this language would match by.
 */
function optionLookupIn(
  attrs: readonly CatalogAttributeView[],
  locale: string,
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const attr of attrs) {
    let bucket = out.get(attr.key);
    if (!bucket) {
      bucket = new Map();
      out.set(attr.key, bucket);
    }
    for (const o of attr.options) {
      const labelMap = o.label ?? {};
      bucket.set(o.value, labelMap[locale] ?? o.labelDefault ?? o.value);
    }
  }
  return out;
}

export function indexUidFor(channel: { code: string }): string {
  return `products_${channel.code.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
}

function buildDocument(
  product: CatalogProductRecord,
  categories: Array<{ id: string; slug: string }>,
  availability: ChannelAvailability,
  texts: {
    channelId: string;
    languages: readonly string[];
    overridesByProduct: ReadonlyMap<string, readonly OverrideRow[]>;
    textAttributes: readonly SearchableTextAttribute[];
    optionLabels: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, string>>>;
    textKeys: ReadonlySet<string>;
  },
): IndexedDocument {
  // We also surface `categorySlugs` so the typed contract layer can filter
  // by `categorySlug` without a join.
  return {
    id: product.id,
    sku: product.sku,
    type: product.type,
    status: product.status,
    slug: product.slug,
    primaryAssetUrl: null,
    categoryIds: categories.map((c) => c.id),
    categorySlugs: categories.map((c) => c.slug),
    attributes: documentAttributes(product.attributeValues, texts.textKeys),
    // Feature 172 (`contracts/search-index.md` §1) — every channel language's effective texts.
    texts: documentTexts(product, { ...texts, overrides: texts.overridesByProduct.get(product.id) ?? [] }),
    createdAt: product.createdAt.getTime(),
    updatedAt: product.updatedAt.getTime(),
    // Feature 163 — `visibility` and the allow-list are the channel-effective rule.
    ...documentAvailabilityFields(availability),
  };
}
