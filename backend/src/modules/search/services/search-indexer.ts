import type { EntityManager } from '@mikro-orm/postgresql';
import { Meilisearch, type Index } from 'meilisearch';
import { Product } from '../../catalog/entities/product.entity.js';
import { ProductAttribute } from '../../catalog/entities/product-attribute.entity.js';
import { SalesChannel } from '../../catalog/entities/sales-channel.entity.js';

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

    const documents: IndexedDocument[] = products.map((p) =>
      buildDocument(p, categoriesByProduct.get(p.id) ?? [], this.locale),
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
    const searchable = ['name', 'sku', 'description'];
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
): IndexedDocument {
  const name = pickLocale(product.name, locale);
  const description = pickLocale(product.description, locale);
  const attrs: IndexedDocument['attributes'] = {};
  for (const [key, value] of Object.entries(product.attributeValues)) {
    if (value === null || value === undefined) {
      attrs[key] = null;
      continue;
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      attrs[key] = value;
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
    updatedAt: product.updatedAt.getTime(),
  };
}

function pickLocale(value: Record<string, string>, locale: string): string {
  return (
    value[locale] ?? value[FALLBACK_LOCALE] ?? Object.values(value)[0] ?? ''
  );
}
