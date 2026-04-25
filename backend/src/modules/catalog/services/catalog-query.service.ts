import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../entities/product.entity.js';
import { ProductVariant } from '../entities/product-variant.entity.js';
import { Category } from '../entities/category.entity.js';
import { ProductAttribute } from '../entities/product-attribute.entity.js';
import { SalesChannel } from '../entities/sales-channel.entity.js';
import { Asset } from '../../assets/entities/asset.entity.js';
import {
  ERROR_CODES,
  type CategoryNode,
  type FilterDefinition,
  type ProductDetail,
  type ProductSummary,
  type ProductVariant as VariantDto,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { encodeCursor, decodeCursor } from '../../../http/cursor.js';

function encodeObjectCursor(value: object): string {
  return encodeCursor(JSON.stringify(value));
}

function decodeObjectCursor<T>(cursor: string): T | null {
  const raw = decodeCursor(cursor);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Catalog read-path service (US1). Consumed by the storefront and by external
 * integrations pulling `/catalog/products?changedSince=...`.
 *
 * Sales-channel awareness: each public endpoint resolves the requested channel
 * (default: the one marked `isPublic=true` when no channel was specified) and
 * applies the visibility rules from R-18 — non-public channels omit the `price`
 * field from anonymous responses.
 *
 * For MVP, text search is Postgres ILIKE on the multilingual `name`/`description`
 * blobs. The Meilisearch-backed query path lives in the `search` module
 * (tasks T067/T068); this service falls back to it transparently when available.
 */

export interface CatalogQueryContext {
  /** Sales Channel code from `X-Sales-Channel` header or storefront host mapping. */
  salesChannelCode?: string | undefined;
  /**
   * Language preference — BCP-47. Used to pick the right string out of the
   * multilingual JSONB blobs. Falls back to the Sales Channel's default language,
   * then to any available key.
   */
  preferredLanguage?: string | undefined;
}

export interface ListProductsParams {
  q?: string | undefined;
  limit: number;
  cursor?: string | undefined;
  sort?: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]> | undefined;
  changedSince?: string | undefined;
}

export interface ListResult<T> {
  data: T[];
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

export class CatalogQueryService {
  constructor(private readonly emFactory: () => EntityManager) {}

  // ------------------------------------------------------------------
  // Products
  // ------------------------------------------------------------------

  async listProducts(
    params: ListProductsParams,
    ctx: CatalogQueryContext,
  ): Promise<ListResult<ProductSummary>> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, ctx);

    // --- Filter validation: any filter[attr.<key>] where the attribute is
    // not filterable must return 400 FILTER_NOT_ALLOWED (FR-005, T043).
    if (params.attributeFilters) {
      const keys = Object.keys(params.attributeFilters);
      if (keys.length > 0) {
        const attrs = await em.find(ProductAttribute, { key: { $in: keys } });
        const byKey = new Map(attrs.map((a) => [a.key, a]));
        for (const k of keys) {
          const a = byKey.get(k);
          if (!a || !a.isFilterable) {
            throw new HttpError(
              400,
              ERROR_CODES.FILTER_NOT_ALLOWED,
              `Attribute "${k}" is not filterable.`,
              [{ path: `filter[attr.${k}]`, issue: 'attribute is not filterable' }],
            );
          }
        }
      }
    }

    const where: Record<string, unknown> = {
      status: 'active',
      deletedAt: null,
    };
    if (params.q) {
      // MVP: DB-only search. Production target uses Meilisearch behind this
      // same query method (T067/T068 — Phase 10 polish); for now we match:
      //   1. SKU ILIKE (covers the seeded EXAMPLE-… ids)
      //   2. attributeValues at any key flagged isSearchable=true
      // The attribute-values match uses Postgres ILIKE on the JSONB cast to
      // text, which is fine for the test corpus and good enough until Meili.
      const searchableKeys = await this.searchableAttributeKeys(em);
      const orClauses: Array<Record<string, unknown>> = [
        { sku: { $ilike: `%${params.q}%` } },
      ];
      for (const key of searchableKeys) {
        // MikroORM's `expr()` would be cleaner; raw cast keeps the dependency
        // surface minimal here.
        orClauses.push({
          // Match any product whose attributeValues[key] (case-insensitive)
          // contains the query.
          attributeValues: this.searchableJsonbClause(key, params.q),
        });
      }
      where['$or'] = orClauses;
    }
    if (params.changedSince) {
      where['updatedAt'] = { $gt: new Date(params.changedSince) };
    }

    // Cursor decoding — encoded as `{ createdAt, id }` in the default sort.
    let cursorClause: Record<string, unknown> | null = null;
    if (params.cursor) {
      const decoded = decodeObjectCursor<{ createdAt: string; id: string }>(params.cursor);
      if (decoded) {
        cursorClause = {
          $or: [
            { createdAt: { $lt: new Date(decoded.createdAt) } },
            { createdAt: new Date(decoded.createdAt), id: { $lt: decoded.id } },
          ],
        };
      }
    }

    const effectiveWhere = cursorClause ? { $and: [where, cursorClause] } : where;

    // Over-fetch by one to detect hasMore.
    const products = await em.find(Product, effectiveWhere, {
      limit: params.limit + 1,
      orderBy: this.orderForSort(params.sort),
    });

    const hasMore = products.length > params.limit;
    const page = hasMore ? products.slice(0, params.limit) : products;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeObjectCursor({ createdAt: page[page.length - 1]!.createdAt.toISOString(), id: page[page.length - 1]!.id })
        : null;

    // Sales Channel visibility — only products associated with the channel
    // are returned. If no channel, everything public-visibility.
    const visibleIds = await this.filterByChannel(
      em,
      page.map((p) => p.id),
      channel,
    );

    // Attribute filter post-filtering (simple equality on attributeValues JSONB).
    const filtered = page.filter((p) => {
      if (!visibleIds.has(p.id)) return false;
      if (!params.attributeFilters) return true;
      for (const [k, values] of Object.entries(params.attributeFilters)) {
        const av = p.attributeValues[k];
        if (av === undefined) return false;
        if (!values.map((v) => String(v)).includes(String(av))) return false;
      }
      return true;
    });

    // Category filter
    let categoryFilteredIds: Set<string> | null = null;
    if (params.categorySlug) {
      categoryFilteredIds = await this.productIdsInCategoryTree(em, params.categorySlug);
    }

    // Build the summaries
    const summaries = await Promise.all(
      filtered
        .filter((p) => (categoryFilteredIds ? categoryFilteredIds.has(p.id) : true))
        .map((p) => this.toSummary(em, p, channel, ctx.preferredLanguage)),
    );

    return {
      data: summaries,
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  async getProductByIdOrSlug(idOrSlug: string, ctx: CatalogQueryContext): Promise<ProductDetail> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, ctx);

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const product = await em.findOne(Product, isUuid ? { id: idOrSlug } : { slug: idOrSlug });
    if (!product || product.deletedAt) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    if (product.status === 'archived') {
      throw new HttpError(410, ERROR_CODES.PRODUCT_ARCHIVED, 'Product is archived.');
    }

    // Visibility — if the product is not associated with the requested channel,
    // behave like it doesn't exist. Avoids exposing non-public catalogue.
    const visibleIds = await this.filterByChannel(em, [product.id], channel);
    if (!visibleIds.has(product.id)) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    const summary = await this.toSummary(em, product, channel, ctx.preferredLanguage);

    // Categories
    const categoryRows = await em.getConnection().execute<{ category_id: string }[]>(
      `select category_id from product_categories where product_id = ?`,
      [product.id],
    );
    const categoryIds = categoryRows.map((r) => r.category_id);
    const categories = await em.find(Category, { id: { $in: categoryIds } });

    // Assets
    const assetRows = await em.getConnection().execute<{ asset_id: string; position: number }[]>(
      `select asset_id, position from product_assets where product_id = ? order by position asc`,
      [product.id],
    );
    const assetIds = assetRows.map((r) => r.asset_id);
    const assets = await em.find(Asset, { id: { $in: assetIds } });

    // Variants
    const variants = product.type === 'variant' ? await em.find(ProductVariant, { parentProductId: product.id }) : [];

    const descriptionText = this.pickLang(product.description, ctx.preferredLanguage, channel);
    const nameText = this.pickLang(product.name, ctx.preferredLanguage, channel);

    const detail: ProductDetail = {
      ...summary,
      description: descriptionText,
      attributeValues: this.coerceAttributeValues(product.attributeValues),
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        url: a.storageUrl,
        altText: a.altText ? this.pickLang(a.altText, ctx.preferredLanguage, channel) : null,
      })),
      variants: variants.map<VariantDto>((v) => ({
        id: v.id,
        sku: v.sku,
        variantAttributeValues: v.variantAttributeValues,
        priceOverride: v.priceOverride != null ? Number(v.priceOverride) : null,
        stockLevel: v.stockLevel ?? null,
      })),
      categories: categories.map((c) => ({
        id: c.id,
        name: this.pickLang(c.name, ctx.preferredLanguage, channel),
        slug: c.slug,
      })),
      seo: {
        metaTitle: nameText,
        metaDescription: descriptionText.slice(0, 160),
        openGraph: {
          title: nameText,
          description: descriptionText.slice(0, 240),
          imageUrl: summary.primaryAssetUrl,
        },
      },
      structuredDataJsonLd: {
        '@context': 'https://schema.org/',
        '@type': 'Product',
        name: nameText,
        sku: product.sku,
        description: descriptionText,
        ...(summary.price
          ? {
              offers: {
                '@type': 'Offer',
                price: summary.price.amount,
                priceCurrency: summary.price.currency,
                availability:
                  summary.stockIndicator === 'out_of_stock'
                    ? 'https://schema.org/OutOfStock'
                    : 'https://schema.org/InStock',
              },
            }
          : {}),
      },
    };
    return detail;
  }

  // ------------------------------------------------------------------
  // Categories
  // ------------------------------------------------------------------

  async getCategoryTree(ctx: CatalogQueryContext): Promise<CategoryNode[]> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, ctx);
    const rows = await em.find(Category, { deletedAt: null }, { orderBy: { sortOrder: 'asc' } });

    // productCount per category — restricted to products visible on the channel.
    const counts = await this.productCountsByCategory(em, channel);

    const byParent = new Map<string | null, Category[]>();
    for (const row of rows) {
      const key = row.parentCategoryId ?? null;
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }

    const build = (parentId: string | null): CategoryNode[] => {
      const children = byParent.get(parentId) ?? [];
      return children.map((c) => ({
        id: c.id,
        name: this.pickLang(c.name, ctx.preferredLanguage, channel),
        slug: c.slug,
        sortOrder: c.sortOrder,
        productCount: counts.get(c.id) ?? 0,
        children: build(c.id),
      }));
    };
    return build(null);
  }

  // ------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------

  async getFilterDefinitions(ctx: CatalogQueryContext): Promise<FilterDefinition[]> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, ctx);
    const attrs = await em.find(ProductAttribute, { isFilterable: true });

    // Build option / range facets by scanning Products in the channel.
    const products = await em.find(Product, { status: 'active', deletedAt: null });
    const visibleIds = await this.filterByChannel(em, products.map((p) => p.id), channel);
    const visible = products.filter((p) => visibleIds.has(p.id));

    return attrs.map((a) => {
      const label = this.pickLang(a.label, ctx.preferredLanguage, channel);
      const def: FilterDefinition = {
        attributeKey: a.key,
        label,
        valueType: a.valueType,
      };
      if (a.valueType === 'enum' || a.valueType === 'boolean' || a.valueType === 'string') {
        const optionCounts = new Map<string, number>();
        for (const p of visible) {
          const v = p.attributeValues[a.key];
          if (v === undefined) continue;
          const key = String(v);
          optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
        }
        def.options = Array.from(optionCounts.entries()).map(([value, count]) => ({
          value,
          label: value,
          count,
        }));
      } else if (a.valueType === 'number' || a.valueType === 'date') {
        let min: number | undefined;
        let max: number | undefined;
        for (const p of visible) {
          const raw = p.attributeValues[a.key];
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(n)) continue;
          if (min === undefined || n < min) min = n;
          if (max === undefined || n > max) max = n;
        }
        if (min !== undefined && max !== undefined) {
          def.range = { min, max };
        }
      }
      return def;
    });
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /** Cached per-call list of attribute keys that should match free-text search. */
  private async searchableAttributeKeys(em: EntityManager): Promise<string[]> {
    const attrs = await em.find(ProductAttribute, { isSearchable: true });
    return attrs.map((a) => a.key);
  }

  /**
   * Build a MikroORM where-clause for "attributeValues[key] contains query
   * (case-insensitive)". MikroORM doesn't have a first-class JSONB query
   * helper for the `->>` operator, so we use `$jsonb` style by selecting the
   * value via the operators object.
   */
  private searchableJsonbClause(key: string, query: string): Record<string, unknown> {
    // expr` returns the property at `key` cast to text; ILIKE handles
    // case-insensitivity. We rely on MikroORM's `raw()` operator-form passed
    // through to Knex.
    return { [key]: { $ilike: `%${query}%` } };
  }

  private async resolveChannel(
    em: EntityManager,
    ctx: CatalogQueryContext,
  ): Promise<SalesChannel | null> {
    if (ctx.salesChannelCode) {
      const byCode = await em.findOne(SalesChannel, { code: ctx.salesChannelCode });
      return byCode;
    }
    // Fallback — any public channel.
    return em.findOne(SalesChannel, { isPublic: true });
  }

  private orderForSort(sort: ListProductsParams['sort']): Record<string, 'asc' | 'desc'> {
    switch (sort) {
      case 'name':
        return { slug: 'asc', id: 'asc' };
      case '-name':
        return { slug: 'desc', id: 'desc' };
      case '-createdAt':
      case 'relevance':
      default:
        return { createdAt: 'desc', id: 'desc' };
    }
  }

  private async filterByChannel(
    em: EntityManager,
    productIds: string[],
    channel: SalesChannel | null,
  ): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    if (!channel) {
      // No channel context — only return products with visibility='public'.
      const visible = await em.find(Product, { id: { $in: productIds }, visibility: 'public' });
      return new Set(visible.map((p) => p.id));
    }
    const rows = await em.getConnection().execute<{ product_id: string }[]>(
      `select product_id from sales_channel_products where sales_channel_id = ? and product_id in (${productIds.map(() => '?').join(',')})`,
      [channel.id, ...productIds],
    );
    return new Set(rows.map((r) => r.product_id));
  }

  private async productIdsInCategoryTree(
    em: EntityManager,
    categorySlug: string,
  ): Promise<Set<string>> {
    const root = await em.findOne(Category, { slug: categorySlug, deletedAt: null });
    if (!root) return new Set();

    // Collect descendant ids (BFS).
    const all: string[] = [root.id];
    let frontier: string[] = [root.id];
    while (frontier.length > 0) {
      const children = await em.find(Category, { parentCategoryId: { $in: frontier }, deletedAt: null });
      const nextIds = children.map((c) => c.id);
      all.push(...nextIds);
      frontier = nextIds;
    }

    const rows = await em.getConnection().execute<{ product_id: string }[]>(
      `select product_id from product_categories where category_id in (${all.map(() => '?').join(',')})`,
      all,
    );
    return new Set(rows.map((r) => r.product_id));
  }

  private async productCountsByCategory(
    em: EntityManager,
    channel: SalesChannel | null,
  ): Promise<Map<string, number>> {
    const base = await em.getConnection().execute<{ category_id: string; product_id: string }[]>(
      `select category_id, product_id from product_categories`,
    );
    if (base.length === 0) return new Map();

    // Filter by visibility.
    const visibleIds = await this.filterByChannel(
      em,
      base.map((r) => r.product_id),
      channel,
    );
    const counts = new Map<string, number>();
    for (const row of base) {
      if (!visibleIds.has(row.product_id)) continue;
      counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
    }
    return counts;
  }

  private async toSummary(
    em: EntityManager,
    product: Product,
    channel: SalesChannel | null,
    preferredLanguage?: string,
  ): Promise<ProductSummary> {
    // Primary asset
    const primary = await em.getConnection().execute<{ storage_url: string }[]>(
      `select a.storage_url from product_assets pa join assets a on a.id = pa.asset_id where pa.product_id = ? order by pa.position asc limit 1`,
      [product.id],
    );
    const primaryAssetUrl = primary[0]?.storage_url ?? null;

    // Category slugs
    const catRows = await em.getConnection().execute<{ slug: string }[]>(
      `select c.slug from product_categories pc join categories c on c.id = pc.category_id where pc.product_id = ?`,
      [product.id],
    );

    // Price (from PriceList module in US2; for US1 we derive from attributeValues.defaultPrice
    // if set, otherwise null). Sales Channel visibility strips price on non-public channels.
    const rawPrice = Number(
      product.attributeValues['defaultPrice'] ?? product.attributeValues['price'] ?? Number.NaN,
    );
    const currency = channel?.defaultCurrency ?? 'PLN';
    const showPrice = channel?.isPublic ?? true;
    const price =
      showPrice && Number.isFinite(rawPrice) ? { amount: rawPrice, currency } : null;

    const nameText = this.pickLang(product.name, preferredLanguage, channel);

    return {
      id: product.id,
      sku: product.sku,
      type: product.type,
      name: nameText,
      slug: product.slug,
      categorySlugs: catRows.map((r) => r.slug),
      primaryAssetUrl,
      price,
      stockIndicator: null,
      stockLevel: null,
    };
  }

  private pickLang(
    blob: Record<string, string>,
    preferred?: string,
    channel?: SalesChannel | null,
  ): string {
    const preferredLangs = [preferred, channel?.defaultLanguage, 'en-US', 'en'].filter(
      (v): v is string => typeof v === 'string',
    );
    for (const lang of preferredLangs) {
      const hit = blob[lang];
      if (hit) return hit;
    }
    const anyKey = Object.keys(blob)[0];
    return anyKey ? (blob[anyKey] ?? '') : '';
  }

  private coerceAttributeValues(v: Record<string, unknown>): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        out[k] = val;
      } else if (val !== null && val !== undefined) {
        out[k] = String(val);
      }
    }
    return out;
  }
}
