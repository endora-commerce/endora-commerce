import type { EntityManager } from '@mikro-orm/postgresql';
import { Meilisearch, type Index } from 'meilisearch';
import {
  resolveAttribute,
  type OverrideRow,
  type ResolverContext,
} from '@b2b/contracts';
import { Product } from '../../catalog/entities/product.entity.js';
import { ProductAttribute } from '../../catalog/entities/product-attribute.entity.js';
import { ProductValueOverride } from '../../catalog/entities/product-value-override.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { SYSTEM_ATTRIBUTE_SCOPES } from '../../catalog/services/system-attribute-scopes.js';

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
 * product into the channel index and reapplies the searchable / filterable
 * settings derived from the live `product_attributes` rows. Re-running it
 * after a schema change is the right way to reindex.
 */

const FALLBACK_LOCALE = 'en-US';

export interface SearchIndexerOptions {
  meilisearchHost?: string;
  meilisearchApiKey?: string;
  /** Override the indexed locale, defaults to en-US. */
  locale?: string;
}

export interface IndexedDocument {
  id: string;
  sku: string;
  name: string;
  description: string;
  type: string;
  status: string;
  visibility: string;
  slug: string;
  primaryAssetUrl: string | null;
  price: number | null;
  categoryIds: string[];
  categorySlugs: string[];
  // Flattened attribute values. Meilisearch's filtering is type-tolerant
  // for primitive values; complex types should be projected via the
  // service layer when they appear.
  attributes: Record<string, string | number | boolean | null>;
  /**
   * Feature 012 / FR-035 — for every `isSearchable = true` attribute of
   * a select-style type (`select` / `enum` / `multiselect`), this array
   * carries the resolved per-locale option label(s). The customer can
   * then search for the rendered text they see (e.g. "brass" matches a
   * product whose `material` option is keyed `brass_001` but rendered
   * as "Brass" in their locale). The array is part of Meilisearch's
   * `searchableAttributes` settings, so it participates in lexical +
   * (when enabled) semantic search alongside `name` / `description`.
   */
  searchableOptions: string[];
  updatedAt: number;
}

export class SearchIndexer {
  private readonly client: Meilisearch;
  private readonly locale: string;

  constructor(options: SearchIndexerOptions = {}) {
    const host =
      options.meilisearchHost ??
      process.env['MEILISEARCH_URL'] ??
      'http://localhost:7700';
    const apiKey =
      options.meilisearchApiKey ??
      process.env['MEILISEARCH_API_KEY'] ??
      undefined;
    this.client = new Meilisearch(apiKey ? { host, apiKey } : { host });
    this.locale = options.locale ?? FALLBACK_LOCALE;
  }

  /**
   * Drop + recreate the channel index, push every product visible in that
   * channel, then reapply the searchable + filterable attribute settings.
   * Returns counts so callers can log a summary.
   */
  async reindexChannel(em: EntityManager, channel: SalesChannel): Promise<{
    indexUid: string;
    documentCount: number;
    searchableAttributes: string[];
    filterableAttributes: string[];
  }> {
    const indexUid = indexUidFor(channel);
    const index = await this.ensureIndex(indexUid);

    const productIds = await this.productIdsInChannel(em, channel.id);
    const products = productIds.length === 0
      ? []
      : await em.find(Product, { id: { $in: productIds } });
    const categoryRows = await em
      .getConnection()
      .execute<Array<{ product_id: string; category_id: string; slug: string }>>(
        `select pc.product_id, pc.category_id, c.slug
           from product_categories pc
           join categories c on c.id = pc.category_id
          where pc.product_id in (${productIds.length === 0 ? 'null' : productIds.map(() => '?').join(',')})`,
        productIds,
      );
    const categoriesByProduct = new Map<string, Array<{ id: string; slug: string }>>();
    for (const row of categoryRows) {
      const list = categoriesByProduct.get(row.product_id) ?? [];
      list.push({ id: row.category_id, slug: row.slug });
      categoriesByProduct.set(row.product_id, list);
    }

    // Feature 012 / FR-035 — pre-load every searchable select-style
    // attribute and its option labels so buildDocument() can render the
    // per-locale text for each product's selected value(s).
    const optionLookup = await this.loadSearchableOptionLookup(em, this.locale);

    // Feature 022 — fetch every override row for this batch of products
    // in one query, then bucket by productId. Each document is built
    // with the channel's defaultLanguage so per-(channel, language)
    // overrides for system Name / Description flow through.
    const overrideRows =
      productIds.length === 0
        ? []
        : await em.find(ProductValueOverride, { productId: { $in: productIds } });
    const overridesByProduct = new Map<string, ProductValueOverride[]>();
    for (const row of overrideRows) {
      const list = overridesByProduct.get(row.productId) ?? [];
      list.push(row);
      overridesByProduct.set(row.productId, list);
    }

    const documents: IndexedDocument[] = products.map((p) =>
      buildDocument(p, categoriesByProduct.get(p.id) ?? [], this.locale, optionLookup, {
        overrides: overridesByProduct.get(p.id) ?? [],
        channelId: channel.id,
        languageCode: channel.defaultLanguage,
      }),
    );

    // Wipe the index first so removed-from-channel products disappear from
    // search. The offline reindex contract is "the index after this call
    // exactly mirrors Postgres for this channel". Event-driven incremental
    // reindex is a separate code path that can upsert without wiping.
    const wipeTask = await index.deleteAllDocuments();
    await this.client.tasks.waitForTask(wipeTask.taskUid);

    if (documents.length > 0) {
      const task = await index.addDocuments(documents, { primaryKey: 'id' });
      // Wait for the task to settle so the documents are queryable when
      // this method returns. Production callers (event-driven reindex)
      // could fire-and-forget; the offline reindex CLI + tests both want
      // the synchronous guarantee.
      await this.client.tasks.waitForTask(task.taskUid);
    }

    const attributes = await em.find(ProductAttribute, {});
    // Feature 012 — `searchableOptions` is the rendered per-locale option
    // label aggregator for every isSearchable select-style attribute. It
    // joins the customer's mental model ("brass") with the operator's
    // canonical option value ("brass_001" / "Mosiądz").
    const searchable = ['name', 'sku', 'description', 'searchableOptions'];
    const filterable: string[] = ['categoryIds', 'categorySlugs', 'visibility', 'status'];
    for (const attr of attributes) {
      const path = `attributes.${attr.key}`;
      if (attr.isSearchable) searchable.push(path);
      if (attr.isFilterable) filterable.push(path);
    }
    await index.updateSearchableAttributes(searchable);
    await index.updateFilterableAttributes(filterable);

    return {
      indexUid,
      documentCount: documents.length,
      searchableAttributes: searchable,
      filterableAttributes: filterable,
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
  async upsertProduct(em: EntityManager, productId: string): Promise<string[]> {
    const product = await em.findOne(Product, { id: productId });
    if (!product) return [];

    const channels = await em.find(SalesChannel, {});
    const linkRows = await em
      .getConnection()
      .execute<Array<{ sales_channel_id: string }>>(
        `select sales_channel_id from sales_channel_products where product_id = ?`,
        [productId],
      );
    const linkedChannelIds = new Set(linkRows.map((r) => r.sales_channel_id));

    const categoryRows = await em
      .getConnection()
      .execute<Array<{ category_id: string; slug: string }>>(
        `select pc.category_id, c.slug
           from product_categories pc
           join categories c on c.id = pc.category_id
          where pc.product_id = ?`,
        [productId],
      );
    const categories = categoryRows.map((r) => ({ id: r.category_id, slug: r.slug }));
    // Feature 012 / FR-035 — same per-locale option-label projection
    // used by the offline reindex. Per-product upsert is incremental,
    // so we only build the lookup once per call.
    const optionLookup = await this.loadSearchableOptionLookup(em, this.locale);
    // Feature 022 — per-channel overrides for system Name / Description.
    // Fetch once; the resolver then runs per (channel, channel.defaultLanguage).
    const overrides = await em.find(ProductValueOverride, { productId });

    const isPublishable =
      product.status === 'active' && !product.deletedAt && !product.archivedAt;

    const touched: string[] = [];
    for (const channel of channels) {
      const indexUid = indexUidFor(channel);
      const index = await this.ensureIndex(indexUid);
      if (linkedChannelIds.has(channel.id) && isPublishable) {
        const document = buildDocument(product, categories, this.locale, optionLookup, {
          overrides,
          channelId: channel.id,
          languageCode: channel.defaultLanguage,
        });
        const task = await index.addDocuments([document], { primaryKey: 'id' });
        await this.client.tasks.waitForTask(task.taskUid);
      } else {
        // Either unlinked or no longer publishable — make sure the doc is gone.
        const task = await index.deleteDocument(productId);
        await this.client.tasks.waitForTask(task.taskUid);
      }
      touched.push(channel.code);
    }
    return touched;
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
      await this.client.tasks.waitForTask(task.taskUid);
      touched.push(channel.code);
    }
    return touched;
  }

  /**
   * Re-apply searchable + filterable attribute settings on every channel
   * index, derived from the live `product_attributes` rows. Called on
   * `attribute.updated.v1` so a flipped `isFilterable` / `isSearchable`
   * propagates without a full reindex.
   */
  async refreshAttributeSettings(em: EntityManager): Promise<string[]> {
    const channels = await em.find(SalesChannel, {});
    const attributes = await em.find(ProductAttribute, {});
    // Feature 012 — keep `searchableOptions` in the searchable list so
    // toggling isSearchable on a select-style attribute takes effect
    // without a full reindex. The aggregated field stays in the index
    // documents from the previous reindex; settings refresh just opts
    // it back into the search rank.
    const searchable = ['name', 'sku', 'description', 'searchableOptions'];
    const filterable: string[] = ['categoryIds', 'categorySlugs', 'visibility', 'status'];
    for (const attr of attributes) {
      const path = `attributes.${attr.key}`;
      if (attr.isSearchable) searchable.push(path);
      if (attr.isFilterable) filterable.push(path);
    }
    const touched: string[] = [];
    for (const channel of channels) {
      const indexUid = indexUidFor(channel);
      const index = await this.ensureIndex(indexUid);
      const searchableTask = await index.updateSearchableAttributes(searchable);
      const filterableTask = await index.updateFilterableAttributes(filterable);
      // Settings updates are async tasks; wait so callers reading the
      // settings immediately after see the new values.
      await this.client.tasks.waitForTask(searchableTask.taskUid);
      await this.client.tasks.waitForTask(filterableTask.taskUid);
      touched.push(channel.code);
    }
    return touched;
  }

  async reindexAllChannels(em: EntityManager): Promise<
    Array<{ channelCode: string; indexUid: string; documentCount: number }>
  > {
    const channels = await em.find(SalesChannel, {});
    const results: Array<{ channelCode: string; indexUid: string; documentCount: number }> = [];
    for (const channel of channels) {
      const summary = await this.reindexChannel(em, channel);
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
    // Embedder operations can take longer than the JS client's default
    // 5 s task wait — Meilisearch may validate the embedder URL on the
    // server side. Bump to 30 s so the operator does not silently
    // observe stale index state on slow paths.
    await this.client.tasks.waitForTask(task.taskUid, { timeout: 30_000 });
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
    await this.client.tasks.waitForTask(task.taskUid, { timeout: 30_000 });
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
    em: EntityManager,
    locale: string,
  ): Promise<Map<string, Map<string, string>>> {
    const out = new Map<string, Map<string, string>>();
    const attrs = await em.find(ProductAttribute, {
      isSearchable: true,
      valueType: { $in: ['select', 'enum', 'multiselect'] as ProductAttribute['valueType'][] },
    });
    if (attrs.length === 0) return out;
    const conn = em.getConnection();
    const placeholders = attrs.map(() => '?').join(', ');
    const rows = (await conn.execute<
      Array<{
        attribute_id: string;
        value: string;
        label: Record<string, string>;
        label_default: string;
      }>
    >(
      `select "attribute_id", "value", "label", "label_default" from "attribute_options" where "attribute_id" in (${placeholders})`,
      attrs.map((a) => a.id),
    )) as Array<{
      attribute_id: string;
      value: string;
      label: Record<string, string>;
      label_default: string;
    }>;
    const attrKeyById = new Map(attrs.map((a) => [a.id, a.key]));
    for (const r of rows) {
      const key = attrKeyById.get(r.attribute_id);
      if (!key) continue;
      let bucket = out.get(key);
      if (!bucket) {
        bucket = new Map();
        out.set(key, bucket);
      }
      const labelMap = r.label ?? {};
      const rendered =
        labelMap[locale] ??
        labelMap[FALLBACK_LOCALE] ??
        Object.values(labelMap)[0] ??
        r.label_default ??
        r.value;
      bucket.set(r.value, rendered);
    }
    return out;
  }

  private async ensureIndex(uid: string): Promise<Index> {
    try {
      return await this.client.getIndex(uid);
    } catch {
      const task = await this.client.createIndex(uid, { primaryKey: 'id' });
      await this.client.tasks.waitForTask(task.taskUid);
      return this.client.getIndex(uid);
    }
  }

  private async productIdsInChannel(em: EntityManager, channelId: string): Promise<string[]> {
    const rows = await em
      .getConnection()
      .execute<Array<{ product_id: string }>>(
        `select scp.product_id
           from sales_channel_products scp
           join products p on p.id = scp.product_id
          where scp.sales_channel_id = ?
            and p.status = 'active'
            and p.deleted_at is null
            and p.archived_at is null`,
        [channelId],
      );
    return rows.map((r) => r.product_id);
  }
}

export function indexUidFor(channel: { code: string }): string {
  return `products_${channel.code.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
}

function buildDocument(
  product: Product,
  categories: Array<{ id: string; slug: string }>,
  locale: string,
  searchableOptionLookup: Map<string, Map<string, string>>,
  resolverInputs?: {
    overrides: ProductValueOverride[];
    channelId: string;
    languageCode: string;
  },
): IndexedDocument {
  // Feature 022 — when resolver inputs are supplied, route the system
  // Name / Description through the four-step fallback chain so
  // per-(channel, language) overrides are visible in search. When not
  // supplied (legacy callers), fall back to plain locale-pick.
  let name = pickLocale(product.name, locale);
  let description = pickLocale(product.description, locale);
  if (resolverInputs) {
    const overrideRows: OverrideRow[] = resolverInputs.overrides.map((o) => ({
      attributeKey: o.attributeKey,
      channelId: o.channelId,
      languageCode: o.languageCode ?? null,
      value: o.value,
    }));
    const ctx: ResolverContext = {
      channelId: resolverInputs.channelId,
      languageCode: resolverInputs.languageCode,
      primaryLanguage: resolverInputs.languageCode,
    };
    const resolvedName = resolveAttribute({
      attributeKey: 'name',
      baseline: product.name,
      overrides: overrideRows,
      scope: SYSTEM_ATTRIBUTE_SCOPES.name!,
      ctx,
    });
    const resolvedDesc = resolveAttribute({
      attributeKey: 'description',
      baseline: product.description,
      overrides: overrideRows,
      scope: SYSTEM_ATTRIBUTE_SCOPES.description!,
      ctx,
    });
    if (typeof resolvedName.value === 'string' && resolvedName.value.length > 0) {
      name = resolvedName.value;
    }
    if (typeof resolvedDesc.value === 'string' && resolvedDesc.value.length > 0) {
      description = resolvedDesc.value;
    }
  }
  const attrs: IndexedDocument['attributes'] = {};
  // Feature 012 — collect resolved per-locale option labels for every
  // searchable select-style attribute the product carries a value for.
  const searchableOptions: string[] = [];
  for (const [key, value] of Object.entries(product.attributeValues)) {
    if (value === null || value === undefined) {
      attrs[key] = null;
      continue;
    }
    const optionLabels = searchableOptionLookup.get(key);
    if (Array.isArray(value)) {
      // multiselect — array of option values.
      if (optionLabels) {
        for (const item of value) {
          const rendered = optionLabels.get(String(item));
          if (rendered) searchableOptions.push(rendered);
        }
      }
      // Persist the raw shape too so non-search filtering still works
      // (Meilisearch tolerates JSON-string fallback per the comment
      // in the original implementation).
      attrs[key] = JSON.stringify(value);
      continue;
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      attrs[key] = value;
      if (optionLabels && typeof value === 'string') {
        const rendered = optionLabels.get(value);
        if (rendered) searchableOptions.push(rendered);
      }
      continue;
    }
    // Fall through for unexpected shapes — coerce to JSON string so the
    // document still upserts. The query layer can ignore these.
    attrs[key] = JSON.stringify(value);
  }
  const price = typeof attrs['defaultPrice'] === 'number' ? attrs['defaultPrice'] : null;
  // We also surface `categorySlugs` so the typed contract layer can filter
  // by `categorySlug` without a join.
  return {
    id: product.id,
    sku: product.sku,
    name,
    description,
    type: product.type,
    status: product.status,
    visibility: product.visibility,
    slug: product.slug,
    primaryAssetUrl: null,
    price,
    categoryIds: categories.map((c) => c.id),
    categorySlugs: categories.map((c) => c.slug),
    attributes: attrs,
    searchableOptions,
    updatedAt: product.updatedAt.getTime(),
  };
}

function pickLocale(value: Record<string, string>, locale: string): string {
  return (
    value[locale] ?? value[FALLBACK_LOCALE] ?? Object.values(value)[0] ?? ''
  );
}
